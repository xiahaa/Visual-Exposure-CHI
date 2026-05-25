import math
from dataclasses import dataclass


WGS84_A = 6378137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)


@dataclass(frozen=True)
class GeoPoint:
    lon: float
    lat: float
    alt: float = 0.0


@dataclass(frozen=True)
class EnuPoint:
    x: float
    y: float
    z: float


def geodetic_to_enu(point: GeoPoint, origin: GeoPoint) -> EnuPoint:
    px, py, pz = _geodetic_to_ecef(point)
    ox, oy, oz = _geodetic_to_ecef(origin)

    dx = px - ox
    dy = py - oy
    dz = pz - oz

    lon0 = math.radians(origin.lon)
    lat0 = math.radians(origin.lat)
    sin_lon = math.sin(lon0)
    cos_lon = math.cos(lon0)
    sin_lat = math.sin(lat0)
    cos_lat = math.cos(lat0)

    east = -sin_lon * dx + cos_lon * dy
    north = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz
    up = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz

    return EnuPoint(east, north, up)


def enu_to_geodetic(point: EnuPoint, origin: GeoPoint) -> GeoPoint:
    ox, oy, oz = _geodetic_to_ecef(origin)

    lon0 = math.radians(origin.lon)
    lat0 = math.radians(origin.lat)
    sin_lon = math.sin(lon0)
    cos_lon = math.cos(lon0)
    sin_lat = math.sin(lat0)
    cos_lat = math.cos(lat0)

    dx = -sin_lon * point.x - sin_lat * cos_lon * point.y + cos_lat * cos_lon * point.z
    dy = cos_lon * point.x - sin_lat * sin_lon * point.y + cos_lat * sin_lon * point.z
    dz = cos_lat * point.y + sin_lat * point.z

    lon, lat, alt = _ecef_to_geodetic(ox + dx, oy + dy, oz + dz)
    return GeoPoint(lon=lon, lat=lat, alt=alt)


def _geodetic_to_ecef(point: GeoPoint) -> tuple[float, float, float]:
    lon = math.radians(point.lon)
    lat = math.radians(point.lat)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    radius = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)

    x = (radius + point.alt) * cos_lat * math.cos(lon)
    y = (radius + point.alt) * cos_lat * math.sin(lon)
    z = (radius * (1 - WGS84_E2) + point.alt) * sin_lat
    return x, y, z


def _ecef_to_geodetic(x: float, y: float, z: float) -> tuple[float, float, float]:
    lon = math.atan2(y, x)
    p = math.sqrt(x * x + y * y)
    lat = math.atan2(z, p * (1 - WGS84_E2))

    for _ in range(6):
        sin_lat = math.sin(lat)
        radius = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)
        alt = p / math.cos(lat) - radius
        lat = math.atan2(z, p * (1 - WGS84_E2 * radius / (radius + alt)))

    sin_lat = math.sin(lat)
    radius = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)
    alt = p / math.cos(lat) - radius

    return math.degrees(lon), math.degrees(lat), alt

