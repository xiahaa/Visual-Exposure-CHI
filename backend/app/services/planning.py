import math
from dataclasses import dataclass
from typing import Iterable

from shapely.geometry import Point, shape
from shapely.ops import nearest_points

from ..geo import EnuPoint, GeoPoint, enu_to_geodetic, geodetic_to_enu
from ..models import CameraConfig, ExposureRequest, PlanningRequest, RoutePoint
from ..scenario_store import load_scenario
from ..trajectory import route_to_enu
from .exposure import compute_exposure


@dataclass(frozen=True)
class PreferenceTarget:
    """A user-marked privacy region represented in backend ENU meters."""

    geometry: object
    weight: float


@dataclass(frozen=True)
class Candidate:
    """One deterministic route/camera adaptation to be evaluated by raycasting."""

    candidate_id: str
    route: list[RoutePoint]
    camera: CameraConfig
    strategy: str
    explanation: str


def optimize_planning(request: PlanningRequest) -> dict:
    """Return privacy-aware route/camera alternatives ranked by exposure trade-off."""

    if len(request.route) < 2:
        raise ValueError("Planning requires at least two route waypoints.")

    scenario = load_scenario(request.scenario_id)
    origin = GeoPoint(**scenario["origin"])
    targets = _preference_targets(request, origin)
    evaluation_camera = _evaluation_camera(request)

    baseline_request = ExposureRequest(
        scenario_id=request.scenario_id,
        route=request.route,
        camera=evaluation_camera,
        user_preferences=request.user_preferences,
    )
    baseline = compute_exposure(baseline_request)["summary"]

    if not targets:
        return {
            "baseline_summary": baseline,
            "options": [
                _option_payload(
                    candidate=Candidate(
                        candidate_id="no_preferences_current_route",
                        route=request.route,
                        camera=request.camera,
                        strategy="current",
                        explanation="No user-marked privacy area was provided, so the current route is returned as the safe baseline.",
                    ),
                    summary=baseline,
                    baseline=baseline,
                    objective_terms={
                        "privacy": baseline["sensitive_exposure"],
                        "route_length": 0.0,
                        "smoothness": 0.0,
                        "altitude": 0.0,
                        "gimbal": 0.0,
                        "task": baseline["estimated_task_coverage"],
                        "objective": 0.0,
                    },
                    label="Current route",
                )
            ],
        }

    candidates = _generate_candidates(request, origin, targets)
    evaluated = []
    for candidate in candidates[: request.planner_config.max_candidates]:
        response = compute_exposure(
            ExposureRequest(
                scenario_id=request.scenario_id,
                route=candidate.route,
                camera=_evaluation_camera(request, candidate.camera),
                user_preferences=request.user_preferences,
            )
        )
        summary = response["summary"]
        if not _passes_constraints(summary, baseline, request):
            continue
        evaluated.append(
            {
                "candidate": candidate,
                "summary": summary,
                "objective_terms": _objective_terms(candidate, request, baseline, summary),
            }
        )

    if not evaluated:
        evaluated = [
            {
                "candidate": Candidate(
                    candidate_id="current_route_fallback",
                    route=request.route,
                    camera=request.camera,
                    strategy="current",
                    explanation="No generated option satisfied the configured constraints, so the current route is returned.",
                ),
                "summary": baseline,
                "objective_terms": {
                    "privacy": baseline["sensitive_exposure"],
                    "route_length": 0.0,
                    "smoothness": 0.0,
                    "altitude": 0.0,
                    "gimbal": 0.0,
                    "task": baseline["estimated_task_coverage"],
                    "objective": 0.0,
                },
            }
        ]

    selected = _select_pareto_options(evaluated, baseline, request.planner_config.max_options)
    labels = ["Privacy-first", "Balanced", "Task-preserving", "Alternative", "Conservative"]

    return {
        "baseline_summary": baseline,
        "options": [
            _option_payload(
                candidate=item["candidate"],
                summary=item["summary"],
                baseline=baseline,
                objective_terms=item["objective_terms"],
                label=labels[index],
            )
            for index, item in enumerate(selected)
        ],
    }


def _generate_candidates(
    request: PlanningRequest,
    origin: GeoPoint,
    targets: list[PreferenceTarget],
) -> list[Candidate]:
    """Build a bounded deterministic candidate set from classical operators."""

    radius = request.planner_config.influence_radius_m
    camera = request.camera
    candidates: list[Candidate] = []

    specs = [
        ("altitude_20", "altitude", 20.0, 0.0, False, camera.gimbal_pitch_deg, camera.max_depth_m),
        ("altitude_40", "altitude", 40.0, 0.0, False, camera.gimbal_pitch_deg, camera.max_depth_m),
        ("detour_25", "lateral", 0.0, 25.0, False, camera.gimbal_pitch_deg, camera.max_depth_m),
        ("detour_45", "lateral", 0.0, 45.0, False, camera.gimbal_pitch_deg, camera.max_depth_m),
        ("depth_limited_camera", "depth_limited_camera", 0.0, 0.0, False, min(camera.gimbal_pitch_deg - 15.0, -60.0), _scaled_depth(camera, 0.8)),
        ("focused_depth", "depth_limited_camera", 0.0, 0.0, False, min(camera.gimbal_pitch_deg - 20.0, -65.0), _scaled_depth(camera, 0.6)),
        ("balanced_combo", "combined", 20.0, 25.0, True, min(camera.gimbal_pitch_deg - 12.0, -58.0), _scaled_depth(camera, 0.85)),
        ("privacy_combo", "combined", 40.0, 45.0, True, min(camera.gimbal_pitch_deg - 20.0, -68.0), _scaled_depth(camera, 0.65)),
    ]

    for candidate_id, strategy, altitude_raise, lateral_offset, yaw_away, pitch, max_depth in specs:
        route = _adjust_route(
            request.route,
            origin,
            targets,
            influence_radius_m=radius,
            altitude_raise_m=altitude_raise,
            lateral_offset_m=lateral_offset,
            yaw_away=yaw_away,
        )
        adjusted_camera = camera.model_copy(update={"gimbal_pitch_deg": pitch, "max_depth_m": max_depth})
        candidates.append(
            Candidate(
                candidate_id=candidate_id,
                route=route,
                camera=adjusted_camera,
                strategy=strategy,
                explanation=_candidate_explanation(strategy),
            )
        )

    return candidates


def _evaluation_camera(request: PlanningRequest, camera: CameraConfig | None = None) -> CameraConfig:
    """Use a bounded ray grid for responsive planning evaluation.

    The returned planning options still carry the user's camera fidelity. This
    lower-resolution copy is only used for ranking candidates interactively.
    """

    source = camera or request.camera
    return source.model_copy(
        update={
            "ray_width": min(source.ray_width, request.planner_config.evaluation_ray_width),
            "ray_height": min(source.ray_height, request.planner_config.evaluation_ray_height),
        }
    )


def _adjust_route(
    route: list[RoutePoint],
    origin: GeoPoint,
    targets: list[PreferenceTarget],
    influence_radius_m: float,
    altitude_raise_m: float,
    lateral_offset_m: float,
    yaw_away: bool,
) -> list[RoutePoint]:
    """Move a densified route away from preference regions with distance falloff."""

    adjusted: list[RoutePoint] = []
    dense_route = densify_route(route, origin, step_m=20.0)
    for waypoint, enu in zip(dense_route, route_to_enu(dense_route, origin)):
        target, nearest = _nearest_target(enu, targets)
        dx = enu.x - nearest.x
        dy = enu.y - nearest.y
        distance = max(Point(enu.x, enu.y).distance(target.geometry), 1e-6)
        falloff = max(0.0, 1.0 - distance / influence_radius_m)

        if falloff <= 0:
            adjusted.append(waypoint)
            continue

        ux = dx / distance
        uy = dy / distance
        next_enu = EnuPoint(
            x=enu.x + ux * lateral_offset_m * falloff,
            y=enu.y + uy * lateral_offset_m * falloff,
            z=enu.z + altitude_raise_m * falloff,
        )
        next_geo = enu_to_geodetic(next_enu, origin)
        next_yaw = waypoint.yaw
        if yaw_away:
            next_yaw = (math.degrees(math.atan2(ux, uy)) + 360.0) % 360.0

        adjusted.append(
            RoutePoint(
                lon=next_geo.lon,
                lat=next_geo.lat,
                alt=max(0.0, next_geo.alt),
                yaw=next_yaw,
            )
        )

    return _repair_route_yaw(adjusted)


def _repair_route_yaw(route: list[RoutePoint]) -> list[RoutePoint]:
    """Fill unchanged yaw values from segment bearings for smoother previews."""

    if len(route) < 2:
        return route

    repaired = [point.model_copy() for point in route]
    for index in range(len(repaired) - 1):
        if repaired[index].yaw == route[index].yaw:
            repaired[index].yaw = _bearing(repaired[index], repaired[index + 1])
    repaired[-1].yaw = repaired[-2].yaw
    return repaired


def densify_route(route: list[RoutePoint], origin: GeoPoint, step_m: float = 20.0) -> list[RoutePoint]:
    """Insert intermediate waypoints so route response acts on long segments."""

    if len(route) < 2:
        return route

    route_enu = route_to_enu(route, origin)
    dense: list[RoutePoint] = []
    for index, (start, end) in enumerate(zip(route_enu, route_enu[1:])):
        dx = end.x - start.x
        dy = end.y - start.y
        dz = end.z - start.z
        segment_length = math.sqrt(dx * dx + dy * dy + dz * dz)
        sample_count = max(1, math.ceil(segment_length / step_m))

        for sample_index in range(sample_count):
            if dense and sample_index == 0:
                continue
            fraction = sample_index / sample_count
            dense.append(
                RoutePoint(
                    lon=_lerp(route[index].lon, route[index + 1].lon, fraction),
                    lat=_lerp(route[index].lat, route[index + 1].lat, fraction),
                    alt=_lerp(route[index].alt, route[index + 1].alt, fraction),
                    yaw=_lerp_angle(route[index].yaw, route[index + 1].yaw, fraction),
                )
            )
    dense.append(route[-1])
    return dense


def _preference_targets(request: PlanningRequest, origin: GeoPoint) -> list[PreferenceTarget]:
    """Convert user preference polygons into weighted ENU planning regions."""

    targets: list[PreferenceTarget] = []
    for geojson, weight in (
        (request.user_preferences.sensitive_areas, 0.95),
        (request.user_preferences.do_not_capture, 1.25),
    ):
        for geometry in _geojson_shapes(geojson):
            targets.append(PreferenceTarget(geometry=_geometry_to_enu(geometry, origin), weight=weight))
    return targets


def _geojson_shapes(geojson: dict | None) -> Iterable:
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


def _nearest_target(point: EnuPoint, targets: list[PreferenceTarget]) -> tuple[PreferenceTarget, Point]:
    route_point = Point(point.x, point.y)
    target = min(targets, key=lambda item: route_point.distance(item.geometry) / item.weight)
    nearest = nearest_points(route_point, target.geometry)[1]
    return target, nearest


def _geometry_to_enu(geometry, origin: GeoPoint):
    """Project a supported Shapely polygon geometry into local ENU meters."""

    def convert_position(position):
        enu = geodetic_to_enu(GeoPoint(lon=position[0], lat=position[1], alt=0.0), origin)
        return (enu.x, enu.y)

    return shape(
        {
            "type": geometry.geom_type,
            "coordinates": _convert_coordinates(geometry.__geo_interface__["coordinates"], convert_position),
        }
    )


def _convert_coordinates(coordinates, convert_position):
    if not coordinates:
        return coordinates
    first = coordinates[0]
    if isinstance(first, (float, int)):
        return convert_position(coordinates)
    return [_convert_coordinates(child, convert_position) for child in coordinates]


def _scaled_depth(camera: CameraConfig, factor: float) -> float | None:
    if camera.max_depth_m is None:
        return None
    return max(10.0, camera.max_depth_m * factor)


def _passes_constraints(summary: dict, baseline: dict, request: PlanningRequest) -> bool:
    if summary["estimated_task_coverage"] < request.planner_config.min_task_coverage:
        return False
    max_increase = request.planner_config.max_route_length_increase_percent
    if max_increase is None:
        return True
    if baseline["route_length_m"] == 0:
        return True
    increase = ((summary["route_length_m"] - baseline["route_length_m"]) / baseline["route_length_m"]) * 100.0
    return increase <= max_increase


def _objective_terms(
    candidate: Candidate,
    request: PlanningRequest,
    baseline: dict,
    summary: dict,
) -> dict:
    weights = request.planner_config.weights
    route_increase = max(0.0, summary["route_length_m"] - baseline["route_length_m"])
    smoothness = _route_smoothness(candidate.route)
    altitude = _altitude_change(request.route, candidate.route)
    gimbal = abs(candidate.camera.gimbal_pitch_deg - request.camera.gimbal_pitch_deg)
    task = summary["estimated_task_coverage"]
    privacy = summary["sensitive_exposure"]

    objective = (
        weights.privacy * privacy
        + weights.route_length * route_increase
        + weights.smoothness * smoothness
        + weights.altitude * altitude
        + weights.gimbal * gimbal
        - weights.task * task * 100.0
    )

    return {
        "privacy": round(privacy, 4),
        "route_length": round(route_increase, 4),
        "smoothness": round(smoothness, 4),
        "altitude": round(altitude, 4),
        "gimbal": round(gimbal, 4),
        "task": round(task, 4),
        "objective": round(objective, 4),
    }


def _select_pareto_options(evaluated: list[dict], baseline: dict, max_options: int) -> list[dict]:
    ranked = sorted(evaluated, key=lambda item: item["objective_terms"]["objective"])
    privacy_first = min(evaluated, key=lambda item: item["summary"]["sensitive_exposure"])
    task_preserving = min(
        evaluated,
        key=lambda item: (
            max(0.0, baseline["estimated_task_coverage"] - item["summary"]["estimated_task_coverage"]),
            item["summary"]["route_length_m"],
        ),
    )

    selected: list[dict] = []
    for item in (privacy_first, ranked[0], task_preserving, *ranked):
        if item["candidate"].candidate_id not in {entry["candidate"].candidate_id for entry in selected}:
            selected.append(item)
        if len(selected) >= max_options:
            break
    return selected


def _option_payload(
    candidate: Candidate,
    summary: dict,
    baseline: dict,
    objective_terms: dict,
    label: str,
) -> dict:
    return {
        "id": candidate.candidate_id,
        "label": label,
        "strategy": candidate.strategy,
        "modified_route": [point.model_dump() for point in candidate.route],
        "modified_camera": candidate.camera.model_dump(),
        "summary": summary,
        "delta": {
            "sensitive_exposure_reduction_percent": _percent_reduction(
                baseline["sensitive_exposure"], summary["sensitive_exposure"]
            ),
            "total_exposure_reduction_percent": _percent_reduction(
                baseline["total_exposure"], summary["total_exposure"]
            ),
            "route_length_increase_percent": _percent_increase(
                baseline["route_length_m"], summary["route_length_m"]
            ),
            "coverage_loss_percent": _percent_reduction(
                baseline["estimated_task_coverage"], summary["estimated_task_coverage"]
            ),
        },
        "objective_terms": objective_terms,
        "explanation": candidate.explanation,
    }


def _candidate_explanation(strategy: str) -> str:
    explanations = {
        "altitude": "Raises route altitude near marked privacy areas to reduce close visual exposure.",
        "lateral": "Offsets nearby route segments away from marked privacy areas while preserving the task path shape.",
        "gimbal": "Adjusts viewing direction and effective visual depth near marked privacy areas.",
        "combined": "Combines route offset, altitude increase, and camera adjustment for a stronger privacy response.",
    }
    return explanations.get(strategy, "Keeps the current route as a baseline option.")


def _route_smoothness(route: list[RoutePoint]) -> float:
    if len(route) < 3:
        return 0.0
    total = 0.0
    for before, current, after in zip(route, route[1:], route[2:]):
        total += abs(_angle_delta(_bearing(before, current), _bearing(current, after)))
    return total / (len(route) - 2)


def _altitude_change(before: list[RoutePoint], after: list[RoutePoint]) -> float:
    if not before or not after:
        return 0.0
    baseline_altitude = sum(point.alt for point in before) / len(before)
    return sum(abs(point.alt - baseline_altitude) for point in after) / len(after)


def _bearing(start: RoutePoint, end: RoutePoint) -> float:
    avg_lat_rad = math.radians((start.lat + end.lat) / 2.0)
    east = (end.lon - start.lon) * math.cos(avg_lat_rad)
    north = end.lat - start.lat
    if abs(east) < 1e-12 and abs(north) < 1e-12:
        return start.yaw
    return (math.degrees(math.atan2(east, north)) + 360.0) % 360.0


def _angle_delta(start: float, end: float) -> float:
    return (end - start + 180.0) % 360.0 - 180.0


def _lerp(start: float, end: float, fraction: float) -> float:
    return start + (end - start) * fraction


def _lerp_angle(start: float, end: float, fraction: float) -> float:
    delta = _angle_delta(start, end)
    return (start + delta * fraction) % 360.0


def _percent_reduction(before: float, after: float) -> float:
    if before == 0.0:
        return 0.0
    return round(((before - after) / before) * 100.0, 2)


def _percent_increase(before: float, after: float) -> float:
    if before == 0.0:
        return 0.0
    return round(((after - before) / before) * 100.0, 2)
