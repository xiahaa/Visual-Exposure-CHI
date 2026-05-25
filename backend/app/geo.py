import math
from dataclasses import dataclass


# WGS84 ellipsoid constants. The frontend and scenario files use longitude and
# latitude, but Open3D needs a local Cartesian scene in meters. These constants
# let us convert through ECEF and then into a local ENU frame.
WGS84_A = 6378137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)


@dataclass(frozen=True)
class GeoPoint:
    """A point in WGS84 longitude/latitude plus altitude in meters."""

    lon: float
    lat: float
    alt: float = 0.0


@dataclass(frozen=True)
class EnuPoint:
    """A point in local East-North-Up coordinates, measured in meters."""

    x: float
    y: float
    z: float


def geodetic_to_enu(point: GeoPoint, origin: GeoPoint) -> EnuPoint:
    """Convert a WGS84 point into the local ENU frame anchored at origin."""

    # Convert both positions to Earth-centered coordinates first. Subtracting
    # them gives a small local vector that can be rotated into east/north/up.
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

    # Standard ECEF -> ENU rotation. The result is safe for local raycasting
    # because all distances are now expressed in meters rather than degrees.
    east = -sin_lon * dx + cos_lon * dy
    north = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz
    up = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz

    return EnuPoint(east, north, up)


def enu_to_geodetic(point: EnuPoint, origin: GeoPoint) -> GeoPoint:
    """Convert a local ENU point back to WGS84 for GeoJSON/API responses."""

    ox, oy, oz = _geodetic_to_ecef(origin)

    lon0 = math.radians(origin.lon)
    lat0 = math.radians(origin.lat)
    sin_lon = math.sin(lon0)
    cos_lon = math.cos(lon0)
    sin_lat = math.sin(lat0)
    cos_lat = math.cos(lat0)

    # Inverse ENU -> ECEF rotation. This is mainly useful for converting
    # backend-computed geometries back into frontend-friendly coordinates.
    dx = -sin_lon * point.x - sin_lat * cos_lon * point.y + cos_lat * cos_lon * point.z
    dy = cos_lon * point.x - sin_lat * sin_lon * point.y + cos_lat * sin_lon * point.z
    dz = cos_lat * point.y + sin_lat * point.z

    lon, lat, alt = _ecef_to_geodetic(ox + dx, oy + dy, oz + dz)
    return GeoPoint(lon=lon, lat=lat, alt=alt)


def _geodetic_to_ecef(point: GeoPoint) -> tuple[float, float, float]:
    """Project WGS84 geodetic coordinates onto the ECEF ellipsoid."""

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
    """Convert ECEF coordinates back to WGS84 using a short fixed iteration."""

    lon = math.atan2(y, x)
    p = math.sqrt(x * x + y * y)
    lat = math.atan2(z, p * (1 - WGS84_E2))

    # Latitude depends on altitude and altitude depends on latitude, so this
    # small fixed-point loop refines both. Six iterations is plenty at the
    # scale of this prototype and keeps the function deterministic.
    for _ in range(6):
        sin_lat = math.sin(lat)
        radius = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)
        alt = p / math.cos(lat) - radius
        lat = math.atan2(z, p * (1 - WGS84_E2 * radius / (radius + alt)))

    sin_lat = math.sin(lat)
    radius = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)
    alt = p / math.cos(lat) - radius

    return math.degrees(lon), math.degrees(lat), alt
