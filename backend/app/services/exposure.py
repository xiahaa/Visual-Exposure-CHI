from dataclasses import dataclass

import numpy as np
from shapely.geometry import Point, shape

from ..camera import generate_camera_rays_batch
from ..config import load_backend_config
from ..geo import GeoPoint
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
            },
        },
    }


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
) -> dict[str, ExposureStats]:
    """Aggregate vectorized ray hits into per-surface stats."""

    surface_count = len(surface_cells)
    if primitive_ids.size == 0:
        return {surface.surface_id: ExposureStats() for surface in surface_cells}

    surface_indices = primitive_to_surface_index[primitive_ids]
    sensitivities = np.array([surface.sensitivity for surface in surface_cells], dtype=np.float32)
    distance_weight = np.minimum(1.0, recognizability_d0_m / np.maximum(distances, 1e-6))
    incidence_weight = np.clip(incidence, 0.0, 1.0)
    exposure_weight = distance_weight * incidence_weight * sensitivities[surface_indices]

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
