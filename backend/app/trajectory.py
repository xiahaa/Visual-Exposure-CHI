import math
from dataclasses import dataclass

import numpy as np

from .geo import EnuPoint, GeoPoint, geodetic_to_enu
from .models import RoutePoint


@dataclass(frozen=True)
class Pose:
    x: float
    y: float
    z: float
    yaw: float
    dt: float

    @property
    def eye(self) -> np.ndarray:
        return np.array([self.x, self.y, self.z], dtype=np.float32)


def route_to_enu(route: list[RoutePoint], origin: GeoPoint) -> list[EnuPoint]:
    return [
        geodetic_to_enu(GeoPoint(lon=point.lon, lat=point.lat, alt=point.alt), origin)
        for point in route
    ]


def route_length_m(route: list[RoutePoint], origin: GeoPoint) -> float:
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
    if not route:
        return []

    route_enu = route_to_enu(route, origin)
    poses: list[Pose] = []

    for index, (start, end) in enumerate(zip(route_enu, route_enu[1:])):
        segment_length = _distance(start, end)
        sample_count = max(1, math.ceil(segment_length / step_m))

        for sample_index in range(sample_count):
            if poses and sample_index == 0:
                continue
            fraction = sample_index / sample_count
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
    delta = (end - start + 180.0) % 360.0 - 180.0
    return (start + delta * fraction) % 360.0

