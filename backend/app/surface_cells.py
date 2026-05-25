from dataclasses import asdict, dataclass

from .geo import EnuPoint, GeoPoint, geodetic_to_enu


@dataclass(frozen=True)
class SurfaceCell:
    surface_id: str
    surface_type: str
    semantic_type: str
    sensitivity: float
    geometry_enu: list[dict[str, float]]
    geometry_geojson: dict
    source_id: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def build_surface_cells(scenario: dict) -> list[SurfaceCell]:
    origin = GeoPoint(**scenario["origin"])
    cells: list[SurfaceCell] = []

    for feature in scenario["semantic_layers"]["features"]:
        cells.append(_semantic_ground_cell(feature, origin))

    for feature in scenario["buildings"]["features"]:
        cells.extend(_building_cells(feature, origin))

    return cells


def surface_cells_response(scenario: dict) -> dict:
    cells = build_surface_cells(scenario)
    return {
        "scenario_id": scenario["scenario_id"],
        "origin": scenario["origin"],
        "surface_count": len(cells),
        "surfaces": [cell.to_dict() for cell in cells],
    }


def _semantic_ground_cell(feature: dict, origin: GeoPoint) -> SurfaceCell:
    properties = feature.get("properties", {})
    surface_id = properties["surface_id"]
    ring = _outer_ring(feature)

    return SurfaceCell(
        surface_id=surface_id,
        surface_type=properties.get("surface_type", "ground"),
        semantic_type=properties.get("semantic_type", "unknown"),
        sensitivity=float(properties.get("sensitivity", 0.5)),
        geometry_enu=_ring_to_enu(ring, origin, z=0.0),
        geometry_geojson=feature["geometry"],
        source_id=surface_id,
    )


def _building_cells(feature: dict, origin: GeoPoint) -> list[SurfaceCell]:
    properties = feature.get("properties", {})
    building_id = properties["building_id"]
    height = float(properties.get("height_m", 0.0))
    semantic_type = properties.get("semantic_type", "building")
    ring = _outer_ring(feature)
    open_ring = ring[:-1] if ring[0] == ring[-1] else ring

    cells = [
        SurfaceCell(
            surface_id=f"{building_id}_roof",
            surface_type="roof",
            semantic_type=semantic_type,
            sensitivity=0.45,
            geometry_enu=_ring_to_enu(open_ring, origin, z=height),
            geometry_geojson=feature["geometry"],
            source_id=building_id,
        )
    ]

    for index, (start, end) in enumerate(zip(open_ring, open_ring[1:] + open_ring[:1])):
        facade_ring = [start, end, end, start]
        geometry_enu = [
            _point_to_enu(start, origin, 0.0),
            _point_to_enu(end, origin, 0.0),
            _point_to_enu(end, origin, height),
            _point_to_enu(start, origin, height),
        ]
        cells.append(
            SurfaceCell(
                surface_id=f"{building_id}_facade_{index + 1:02d}",
                surface_type="facade",
                semantic_type=f"{semantic_type}_facade",
                sensitivity=0.7,
                geometry_enu=geometry_enu,
                geometry_geojson={
                    "type": "LineString",
                    "coordinates": [facade_ring[0], facade_ring[1]],
                },
                source_id=building_id,
            )
        )

    return cells


def _outer_ring(feature: dict) -> list[list[float]]:
    geometry = feature["geometry"]
    if geometry["type"] != "Polygon":
        raise ValueError(f"Unsupported geometry type: {geometry['type']}")
    return geometry["coordinates"][0]


def _ring_to_enu(ring: list[list[float]], origin: GeoPoint, z: float) -> list[dict[str, float]]:
    open_ring = ring[:-1] if ring and ring[0] == ring[-1] else ring
    return [_point_to_enu(point, origin, z) for point in open_ring]


def _point_to_enu(point: list[float], origin: GeoPoint, z: float) -> dict[str, float]:
    enu = geodetic_to_enu(GeoPoint(lon=point[0], lat=point[1], alt=z), origin)
    return _round_enu(enu)


def _round_enu(point: EnuPoint) -> dict[str, float]:
    return {
        "x": round(point.x, 4),
        "y": round(point.y, 4),
        "z": round(point.z, 4),
    }
