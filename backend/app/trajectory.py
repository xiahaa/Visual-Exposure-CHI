import math
from dataclasses import dataclass

import numpy as np

from .geo import EnuPoint, GeoPoint, geodetic_to_enu
from .models import RoutePoint


@dataclass(frozen=True)
class Pose:
    """A sampled drone pose in local ENU coordinates.

    `dt` is a relative time weight for exposure aggregation. The MVP currently
    uses a constant value per sampled pose, but keeping it on the pose makes it
    easy to add speed- or hover-aware weighting later.
    """

    x: float
    y: float
    z: float
    yaw: float
    dt: float

    @property
    def eye(self) -> np.ndarray:
        """Camera/ray origin as a float32 vector for Open3D."""

        return np.array([self.x, self.y, self.z], dtype=np.float32)


def route_to_enu(route: list[RoutePoint], origin: GeoPoint) -> list[EnuPoint]:
    """Convert route waypoints from frontend WGS84 into backend ENU meters."""

    return [
        geodetic_to_enu(GeoPoint(lon=point.lon, lat=point.lat, alt=point.alt), origin)
        for point in route
    ]


def route_length_m(route: list[RoutePoint], origin: GeoPoint) -> float:
    """Compute 3D route length in meters after converting to ENU."""

    route_enu = route_to_enu(route, origin)
    total = 0.0
    for start, end in zip(route_enu, route_enu[1:]):
        total += _distance(start, end)
    return total


def sample_route(
    route: list[RoutePoint],
    origin: GeoPoint,
    step_m: float = 5.0,
    default_dt: float = 1.0,
) -> list[Pose]:
    """Sample a polyline route into regularly spaced drone poses.

    The raycaster operates on discrete camera poses. Sampling every few meters
    gives a deterministic approximation of continuous flight while keeping the
    number of rays manageable for an interactive prototype.
    """

    if not route:
        return []

    route_enu = route_to_enu(route, origin)
    poses: list[Pose] = []

    for index, (start, end) in enumerate(zip(route_enu, route_enu[1:])):
        segment_length = _distance(start, end)
        sample_count = max(1, math.ceil(segment_length / step_m))

        for sample_index in range(sample_count):
            # Avoid duplicating the shared waypoint between adjacent segments.
            if poses and sample_index == 0:
                continue
            fraction = sample_index / sample_count
            # Yaw is interpolated along the shortest angular path so a route
            # from 350 degrees to 10 degrees rotates by 20 degrees, not 340.
            yaw = _lerp_angle(route[index].yaw, route[index + 1].yaw, fraction)
            poses.append(
                Pose(
                    x=_lerp(start.x, end.x, fraction),
                    y=_lerp(start.y, end.y, fraction),
                    z=_lerp(start.z, end.z, fraction),
                    yaw=yaw,
                    dt=default_dt,
                )
            )

    last = route_enu[-1]
    # Always include the final waypoint so route endpoints are represented.
    poses.append(Pose(x=last.x, y=last.y, z=last.z, yaw=route[-1].yaw, dt=default_dt))
    return poses


def _distance(start: EnuPoint, end: EnuPoint) -> float:
    dx = end.x - start.x
    dy = end.y - start.y
    dz = end.z - start.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _lerp(start: float, end: float, fraction: float) -> float:
    return start + (end - start) * fraction


def _lerp_angle(start: float, end: float, fraction: float) -> float:
    """Interpolate degrees around a circle using the shortest turn."""

    delta = (end - start + 180.0) % 360.0 - 180.0
    return (start + delta * fraction) % 360.0
