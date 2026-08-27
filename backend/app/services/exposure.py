from dataclasses import dataclass

import numpy as np
from shapely.geometry import Point, shape

from ..camera import generate_camera_rays_batch
from ..config import load_backend_config
from ..geo import EnuPoint, GeoPoint, enu_to_geodetic
from ..models import CompareRequest, ExposureRequest
from ..prepared_scene import get_prepared_scene
from ..surface_cells import SurfaceCell, build_surface_cells
from ..trajectory import route_length_m, sample_route


@dataclass
class ExposureStats:
    """Accumulated visibility statistics for one surface cell."""

    exposure: float = 0.0
    visible_count: int = 0
    distance_sum: float = 0.0
    incidence_sum: float = 0.0

    def update(
        self,
        distance: float,
        incidence: float,
        time_weight: float,
        sensitivity: float,
        recognizability_d0_m: float,
    ) -> None:
        """Add one first-hit ray contribution to this surface.

        The score is intentionally a proxy: closer, more frontal views and more
        sensitive semantics contribute more. It is not a legal/privacy judgment.
        """

        distance_weight = min(1.0, recognizability_d0_m / max(distance, 1e-6))
        incidence_weight = max(0.0, min(1.0, incidence))
        self.exposure += distance_weight * incidence_weight * time_weight * sensitivity
        self.visible_count += 1
        self.distance_sum += distance
        self.incidence_sum += incidence_weight

    @property
    def mean_distance(self) -> float:
        if self.visible_count == 0:
            return 0.0
        return self.distance_sum / self.visible_count

    @property
    def mean_incidence(self) -> float:
        if self.visible_count == 0:
            return 0.0
        return self.incidence_sum / self.visible_count


def compute_exposure(request: ExposureRequest) -> dict:
    """Compute estimated visual exposure for one route and camera setting."""

    exposure_config = load_backend_config().exposure
    prepared_scene = get_prepared_scene(request.scenario_id)
    scenario = prepared_scene.scenario
    origin = GeoPoint(**scenario["origin"])
    # Surface cells are the aggregation units. User preferences can raise their
    # sensitivity before raycasting, but geometry remains unchanged.
    base_surface_cells = list(prepared_scene.surface_cells)
    surface_cells = _apply_user_preferences(base_surface_cells, request)

    # Convert the planned route into discrete camera poses, then cast a
    # low-resolution camera ray grid from each pose.
    poses = sample_route(request.route, origin, step_m=exposure_config.route_sample_step_m)
    min_range_m = (
        request.camera.min_depth_m
        if request.camera.min_depth_m is not None
        else exposure_config.min_range_m
    )
    max_range_m = (
        request.camera.max_depth_m
        if request.camera.max_depth_m is not None
        else exposure_config.max_range_m
    )

    rays = generate_camera_rays_batch(poses, request.camera)
    hits = prepared_scene.visibility_scene.cast_arrays(
        rays,
        max_range_m=max_range_m,
        min_range_m=min_range_m,
    )
    stats = _aggregate_hits(
        hits.primitive_ids,
        hits.distances,
        hits.incidence,
        prepared_scene.primitive_to_surface_index,
        surface_cells,
        exposure_config.recognizability_d0_m,
        exposure_config.reference_rays_per_pose
        / (request.camera.ray_width * request.camera.ray_height),
    )
    pose_evidence = _build_pose_evidence(
        poses=poses,
        origin=origin,
        camera=request.camera,
        ray_indices=hits.ray_indices,
        primitive_ids=hits.primitive_ids,
        distances=hits.distances,
        incidence=hits.incidence,
        primitive_to_surface_index=prepared_scene.primitive_to_surface_index,
        surface_cells=surface_cells,
        recognizability_d0_m=exposure_config.recognizability_d0_m,
        ray_density_weight=(
            exposure_config.reference_rays_per_pose
            / (request.camera.ray_width * request.camera.ray_height)
        ),
    )

    exposure_surfaces = {"type": "FeatureCollection", "features": []}
    exposure_points = []
    total_exposure = 0.0
    sensitive_exposure = 0.0
    max_area = None
    max_exposure = -1.0

    for surface in surface_cells:
        surface_stats = stats[surface.surface_id]
        exposure = round(surface_stats.exposure, 4)
        # GeoJSON properties are designed for direct deck.gl styling and
        # explanation panels. Geometry stays in lon/lat for frontend rendering.
        properties = {
            "surface_id": surface.surface_id,
            "surface_type": surface.surface_type,
            "semantic_type": surface.semantic_type,
            "sensitivity": surface.sensitivity,
            "source_id": surface.source_id,
            "exposure": exposure,
            "visible_count": surface_stats.visible_count,
            "mean_distance_m": round(surface_stats.mean_distance, 2),
            "mean_incidence_angle": round(surface_stats.mean_incidence, 4),
        }
        exposure_surfaces["features"].append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": surface.geometry_geojson,
            }
        )

        total_exposure += surface_stats.exposure
        # Sensitive exposure is reported separately because it is the most
        # important summary value for the privacy-task trade-off UI.
        if surface.sensitivity >= 0.8:
            sensitive_exposure += surface_stats.exposure
        if surface_stats.exposure > max_exposure:
            max_exposure = surface_stats.exposure
            max_area = surface.semantic_type

        lon, lat = _geometry_centroid(surface.geometry_geojson)
        # Point summaries are convenient for labels, pins, and quick heatmap
        # previews; polygon/line geometries remain available in exposure_surfaces.
        exposure_points.append(
            {
                "lon": lon,
                "lat": lat,
                "exposure": exposure,
                "surface_id": surface.surface_id,
                "surface_type": surface.surface_type,
                "semantic_type": surface.semantic_type,
            }
        )

    return {
        "exposure_surfaces": exposure_surfaces,
        "exposure_points": exposure_points,
        "pose_evidence": pose_evidence,
        "summary": {
            "total_exposure": round(total_exposure, 4),
            "sensitive_exposure": round(sensitive_exposure, 4),
            "max_exposure_area": max_area,
            "route_length_m": round(route_length_m(request.route, origin), 2),
            "sampled_pose_count": len(poses),
            "ray_count": len(poses) * request.camera.ray_width * request.camera.ray_height,
            "estimated_task_coverage": _estimate_task_coverage(stats, surface_cells),
            "engine": "open3d_raycasting",
            # Echo the active engine settings so experiment runs can be
            # reproduced from logs without guessing which YAML was used.
            "config": {
                "min_range_m": min_range_m,
                "max_range_m": max_range_m,
                "recognizability_d0_m": exposure_config.recognizability_d0_m,
                "route_sample_step_m": exposure_config.route_sample_step_m,
                "reference_rays_per_pose": exposure_config.reference_rays_per_pose,
            },
        },
    }


def _build_pose_evidence(
    *,
    poses: list,
    origin: GeoPoint,
    camera,
    ray_indices: np.ndarray,
    primitive_ids: np.ndarray,
    distances: np.ndarray,
    incidence: np.ndarray,
    primitive_to_surface_index: np.ndarray,
    surface_cells: list[SurfaceCell],
    recognizability_d0_m: float,
    ray_density_weight: float,
) -> list[dict]:
    """Build a compact exposure profile aligned with sampled route poses.

    The ray batch is flattened as ``pose -> image rows -> image columns``.
    Dividing each retained ray index by the number of pixels therefore recovers
    the source pose. Per-pose scores reuse the exact same contribution formula
    as the surface summary, keeping the timeline numerically interpretable.
    """

    pose_count = len(poses)
    if pose_count == 0:
        return []

    rays_per_pose = camera.ray_width * camera.ray_height
    surface_count = len(surface_cells)
    sensitivities = np.array(
        [surface.sensitivity for surface in surface_cells], dtype=np.float32
    )

    if ray_indices.size:
        pose_indices = ray_indices // rays_per_pose
        surface_indices = primitive_to_surface_index[primitive_ids]
        distance_weight = np.minimum(
            1.0, recognizability_d0_m / np.maximum(distances, 1e-6)
        )
        incidence_weight = np.clip(incidence, 0.0, 1.0)
        contributions = (
            distance_weight
            * incidence_weight
            * sensitivities[surface_indices]
            * ray_density_weight
        )
        total_by_pose = np.bincount(
            pose_indices, weights=contributions, minlength=pose_count
        )
        sensitive_by_pose = np.bincount(
            pose_indices,
            weights=contributions * (sensitivities[surface_indices] >= 0.8),
            minlength=pose_count,
        )

        # Aggregate sparse pose/surface pairs. This avoids allocating a dense
        # pose-by-surface matrix for city scenes with thousands of surfaces.
        pair_ids = pose_indices * surface_count + surface_indices
        unique_pairs, pair_inverse = np.unique(pair_ids, return_inverse=True)
        pair_contributions = np.bincount(pair_inverse, weights=contributions)
        pair_pose_indices = unique_pairs // surface_count
        pair_surface_indices = unique_pairs % surface_count
        visible_surface_count = np.bincount(
            pair_pose_indices, minlength=pose_count
        )
    else:
        total_by_pose = np.zeros(pose_count, dtype=np.float64)
        sensitive_by_pose = np.zeros(pose_count, dtype=np.float64)
        pair_contributions = np.empty(0, dtype=np.float64)
        pair_pose_indices = np.empty(0, dtype=np.int64)
        pair_surface_indices = np.empty(0, dtype=np.int64)
        visible_surface_count = np.zeros(pose_count, dtype=np.int64)

    cumulative_distance = np.zeros(pose_count, dtype=np.float64)
    for index in range(1, pose_count):
        start = poses[index - 1]
        end = poses[index]
        cumulative_distance[index] = cumulative_distance[index - 1] + float(
            np.linalg.norm(end.eye - start.eye)
        )
    total_distance = float(cumulative_distance[-1])

    evidence = []
    for index, pose in enumerate(poses):
        pair_start = int(np.searchsorted(pair_pose_indices, index, side="left"))
        pair_end = int(np.searchsorted(pair_pose_indices, index, side="right"))
        if pair_end > pair_start:
            local_weights = pair_contributions[pair_start:pair_end]
            local_surfaces = pair_surface_indices[pair_start:pair_end]
            top_count = min(5, len(local_weights))
            top_order = np.argsort(local_weights)[-top_count:][::-1]
            top_surface_ids = [
                surface_cells[int(local_surfaces[position])].surface_id
                for position in top_order
            ]
        else:
            top_surface_ids = []

        geodetic = enu_to_geodetic(
            EnuPoint(x=pose.x, y=pose.y, z=pose.z), origin
        )
        evidence.append(
            {
                "pose_index": index,
                "distance_along_route_m": round(float(cumulative_distance[index]), 2),
                "route_fraction": round(
                    float(cumulative_distance[index] / total_distance)
                    if total_distance > 0.0
                    else 0.0,
                    6,
                ),
                "lon": round(geodetic.lon, 7),
                "lat": round(geodetic.lat, 7),
                "alt": round(geodetic.alt, 2),
                "yaw": round(float(pose.yaw), 3),
                "gimbal_pitch_deg": round(float(camera.gimbal_pitch_deg), 3),
                "total_exposure": round(float(total_by_pose[index]), 4),
                "sensitive_exposure": round(float(sensitive_by_pose[index]), 4),
                "visible_surface_count": int(visible_surface_count[index]),
                "top_surface_ids": top_surface_ids,
            }
        )
    return evidence


def compare_exposure(request: CompareRequest) -> dict:
    """Compute before/after summaries and derived trade-off deltas."""

    before = compute_exposure(request.before)["summary"]
    after = compute_exposure(request.after)["summary"]

    return {
        "before": before,
        "after": after,
        "delta": {
            "exposure_reduction_percent": _percent_reduction(
                before["sensitive_exposure"], after["sensitive_exposure"]
            ),
            "route_length_increase_percent": _percent_increase(
                before["route_length_m"], after["route_length_m"]
            ),
            "coverage_loss_percent": _percent_reduction(
                before["estimated_task_coverage"], after["estimated_task_coverage"]
            ),
        },
        "explanation": _comparison_explanation(before, after),
    }


def _aggregate_hits(
    primitive_ids: np.ndarray,
    distances: np.ndarray,
    incidence: np.ndarray,
    primitive_to_surface_index: np.ndarray,
    surface_cells: list[SurfaceCell],
    recognizability_d0_m: float,
    ray_density_weight: float = 1.0,
) -> dict[str, ExposureStats]:
    """Aggregate vectorized ray hits into per-surface stats.

    ``ray_density_weight`` normalizes contributions to a fixed reference grid.
    Without it, increasing ray_width/ray_height would mechanically increase the
    reported exposure even when route, geometry, and camera optics are unchanged.
    """

    surface_count = len(surface_cells)
    if primitive_ids.size == 0:
        return {surface.surface_id: ExposureStats() for surface in surface_cells}

    surface_indices = primitive_to_surface_index[primitive_ids]
    sensitivities = np.array([surface.sensitivity for surface in surface_cells], dtype=np.float32)
    distance_weight = np.minimum(1.0, recognizability_d0_m / np.maximum(distances, 1e-6))
    incidence_weight = np.clip(incidence, 0.0, 1.0)
    exposure_weight = (
        distance_weight
        * incidence_weight
        * sensitivities[surface_indices]
        * ray_density_weight
    )

    exposure_sum = np.bincount(surface_indices, weights=exposure_weight, minlength=surface_count)
    visible_count = np.bincount(surface_indices, minlength=surface_count)
    distance_sum = np.bincount(surface_indices, weights=distances, minlength=surface_count)
    incidence_sum = np.bincount(surface_indices, weights=incidence_weight, minlength=surface_count)

    return {
        surface.surface_id: ExposureStats(
            exposure=float(exposure_sum[index]),
            visible_count=int(visible_count[index]),
            distance_sum=float(distance_sum[index]),
            incidence_sum=float(incidence_sum[index]),
        )
        for index, surface in enumerate(surface_cells)
    }


def _apply_user_preferences(
    surface_cells: list[SurfaceCell], request: ExposureRequest
) -> list[SurfaceCell]:
    """Apply user-drawn preference polygons as sensitivity modifiers.

    Preferences do not delete surfaces or perform path planning. They change how
    visible hits are weighted, preserving the system boundary: the backend
    estimates exposure, while users express what matters.
    """

    sensitive_shapes = _geojson_shapes(request.user_preferences.sensitive_areas)
    do_not_capture_shapes = _geojson_shapes(request.user_preferences.do_not_capture)

    adjusted = []
    for surface in surface_cells:
        # Use the surface's map-space centroid for preference overlap. This is a
        # stable MVP approximation; later versions could use full polygon
        # intersection in projected coordinates.
        lon, lat = _geometry_centroid(surface.geometry_geojson)
        point = Point(lon, lat)
        sensitivity = surface.sensitivity
        semantic_type = surface.semantic_type

        if any(polygon.contains(point) or polygon.touches(point) for polygon in sensitive_shapes):
            # User-marked sensitive regions should be at least as important as
            # the strongest built-in semantic regions.
            sensitivity = max(sensitivity, 0.95)
            semantic_type = f"{semantic_type}_user_sensitive"

        if any(polygon.contains(point) or polygon.touches(point) for polygon in do_not_capture_shapes):
            # Do-not-capture is the strongest spatial preference in the MVP.
            sensitivity = max(sensitivity, 1.0)
            semantic_type = f"{semantic_type}_do_not_capture"

        adjusted.append(
            SurfaceCell(
                surface_id=surface.surface_id,
                surface_type=surface.surface_type,
                semantic_type=semantic_type,
                sensitivity=sensitivity,
                geometry_enu=surface.geometry_enu,
                geometry_geojson=surface.geometry_geojson,
                source_id=surface.source_id,
            )
        )
    return adjusted


def _geojson_shapes(geojson: dict | None) -> list:
    """Parse supported GeoJSON inputs into Shapely geometries."""

    if not geojson:
        return []
    try:
        if geojson.get("type") == "FeatureCollection":
            return [shape(feature["geometry"]) for feature in geojson.get("features", [])]
        if geojson.get("type") == "Feature":
            return [shape(geojson["geometry"])]
        return [shape(geojson)]
    except Exception as exc:
        raise ValueError("Invalid user preference GeoJSON.") from exc


def _estimate_task_coverage(stats: dict[str, ExposureStats], surface_cells: list[SurfaceCell]) -> float:
    """Estimate task coverage as the fraction of roof cells observed at least once."""

    roof_cells = [surface for surface in surface_cells if surface.surface_type == "roof"]
    if not roof_cells:
        return 0.0
    visible_roofs = sum(1 for surface in roof_cells if stats[surface.surface_id].visible_count > 0)
    return round(visible_roofs / len(roof_cells), 4)


def _comparison_explanation(before: dict, after: dict) -> str:
    """Return a concise explanation suitable for the comparison panel."""

    if after["sensitive_exposure"] < before["sensitive_exposure"]:
        return "The modified condition reduces estimated sensitive visual exposure based on first-hit raycasting."
    if after["sensitive_exposure"] > before["sensitive_exposure"]:
        return "The modified condition increases estimated sensitive visual exposure based on first-hit raycasting."
    return "The modified condition produces no measurable sensitive exposure change under the current sampling settings."


def _percent_reduction(before: float, after: float) -> float:
    """Return percentage decrease from before to after."""

    if before == 0.0:
        return 0.0
    return round(((before - after) / before) * 100.0, 2)


def _percent_increase(before: float, after: float) -> float:
    """Return percentage increase from before to after."""

    if before == 0.0:
        return 0.0
    return round(((after - before) / before) * 100.0, 2)


def _geometry_centroid(geometry: dict) -> tuple[float, float]:
    """Compute a lightweight centroid for Polygon or LineString GeoJSON."""

    if geometry["type"] == "Polygon":
        return _points_centroid(geometry["coordinates"][0])
    if geometry["type"] == "LineString":
        return _points_centroid(geometry["coordinates"])
    raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def _points_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Average coordinate points for a simple centroid approximation."""

    points = ring[:-1] if ring[0] == ring[-1] else ring
    lon = sum(point[0] for point in points) / len(points)
    lat = sum(point[1] for point in points) / len(points)
    return round(lon, 7), round(lat, 7)
