"""Download a compact Hong Kong OSM scenario for the CHI prototype.

The script intentionally targets a small, fixed study area so the frontend and
Open3D backend stay responsive. It uses Overpass JSON with geometry output and
converts closed OSM ways into the scenario files consumed by the app.
"""

from __future__ import annotations

import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ID = "hong_kong_mong_kok_01"
SCENARIO_DIR = ROOT / "data" / "scenarios" / SCENARIO_ID

# Compact Mong Kok / Yau Ma Tei study area. Order is south, west, north, east.
BBOX = (22.3128, 114.1668, 22.3236, 114.1748)
ORIGIN = {"lon": 114.1708, "lat": 22.3182, "alt": 0.0}
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def main() -> None:
    SCENARIO_DIR.mkdir(parents=True, exist_ok=True)
    data = fetch_overpass()
    buildings = build_building_geojson(data)
    semantic_layers = build_semantic_geojson(data)
    scenario = build_scenario()

    write_json(SCENARIO_DIR / "scenario.json", scenario)
    write_json(SCENARIO_DIR / "buildings.geojson", buildings)
    write_json(SCENARIO_DIR / "semantic_layers.geojson", semantic_layers)
    print(
        f"Wrote {SCENARIO_ID}: "
        f"{len(buildings['features'])} buildings, "
        f"{len(semantic_layers['features'])} semantic areas"
    )


def fetch_overpass() -> dict[str, Any]:
    south, west, north, east = BBOX
    query = f"""
    [out:json][timeout:90];
    (
      way["building"]({south},{west},{north},{east});
      way["amenity"~"school|hospital|kindergarten|clinic"]({south},{west},{north},{east});
      way["leisure"~"playground|park|garden"]({south},{west},{north},{east});
      way["landuse"="residential"]({south},{west},{north},{east});
    );
    out tags geom;
    """
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        OVERPASS_URL,
        data=body,
        headers={"User-Agent": "CHI-Drone-Visual-Exposure-Prototype/0.1"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def build_building_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if "building" not in tags:
            continue
        ring = closed_ring(element)
        if not ring:
            continue
        height = building_height_m(tags)
        building_id = f"osm_way_{element['id']}"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "building_id": building_id,
                    "osm_id": element["id"],
                    "height_m": height,
                    "semantic_type": building_semantic_type(tags),
                    "height_source": height_source(tags),
                    "name": tags.get("name") or tags.get("name:en") or "",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def build_semantic_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if "building" in tags:
            continue
        semantic_type, sensitivity = semantic_label(tags)
        if not semantic_type:
            continue
        ring = closed_ring(element)
        if not ring:
            continue
        surface_id = f"{semantic_type}_{element['id']}"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "surface_id": surface_id,
                    "osm_id": element["id"],
                    "surface_type": "ground",
                    "semantic_type": semantic_type,
                    "sensitivity": sensitivity,
                    "name": tags.get("name") or tags.get("name:en") or "",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def build_scenario() -> dict[str, Any]:
    return {
        "scenario_id": SCENARIO_ID,
        "name": "Hong Kong Mong Kok Visual Exposure Study",
        "origin": ORIGIN,
        "camera": {
            "hfov_deg": 78,
            "vfov_deg": 50,
            "gimbal_pitch_deg": -45,
            "ray_width": 80,
            "ray_height": 45,
            "min_depth_m": 0,
            "max_depth_m": 250,
        },
        "default_route": [
            {"lon": 114.1688, "lat": 22.3152, "alt": 95, "yaw": 25},
            {"lon": 114.1702, "lat": 22.3172, "alt": 95, "yaw": 25},
            {"lon": 114.1718, "lat": 22.3195, "alt": 95, "yaw": 25},
            {"lon": 114.1730, "lat": 22.3216, "alt": 95, "yaw": 20},
        ],
        "summary": {
            "task": "Assess a high-density Hong Kong urban route using real OSM buildings and sensitive public areas.",
            "notice": "Estimated visual exposure is computed from OpenStreetMap footprints, inferred building heights, and planned camera settings.",
        },
    }


def closed_ring(element: dict[str, Any]) -> list[list[float]] | None:
    geometry = element.get("geometry") or []
    ring = [[round(point["lon"], 7), round(point["lat"], 7)] for point in geometry]
    if len(ring) < 4:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    if abs(polygon_area(ring)) < 1e-10:
        return None
    return ring


def building_height_m(tags: dict[str, str]) -> float:
    height = parse_meters(tags.get("height") or tags.get("building:height"))
    if height:
        return round(height, 2)
    levels = parse_float(tags.get("building:levels"))
    if levels:
        return round(max(3.2, levels * 3.2), 2)
    if tags.get("building") in {"apartments", "residential", "hotel", "commercial", "office"}:
        return 45.0
    return 18.0


def height_source(tags: dict[str, str]) -> str:
    if tags.get("height") or tags.get("building:height"):
        return "osm_height"
    if tags.get("building:levels"):
        return "osm_building_levels_x_3.2m"
    return "default_by_building_type"


def building_semantic_type(tags: dict[str, str]) -> str:
    building = tags.get("building", "building")
    if building in {"apartments", "residential", "house", "dormitory"}:
        return "residential"
    if building in {"school", "kindergarten", "university"}:
        return "education"
    if building in {"hospital", "clinic"}:
        return "healthcare"
    if building in {"commercial", "retail", "office", "hotel"}:
        return "commercial"
    return "building"


def semantic_label(tags: dict[str, str]) -> tuple[str | None, float]:
    amenity = tags.get("amenity")
    leisure = tags.get("leisure")
    landuse = tags.get("landuse")
    if amenity in {"school", "kindergarten"}:
        return "school_area", 0.95
    if amenity in {"hospital", "clinic"}:
        return "healthcare_area", 0.95
    if leisure == "playground":
        return "playground", 0.9
    if leisure in {"park", "garden"}:
        return "public_open_space", 0.65
    if landuse == "residential":
        return "residential_area", 0.8
    return None, 0.0


def parse_meters(value: str | None) -> float | None:
    if not value:
        return None
    normalized = value.lower().replace(",", ".").strip()
    match = re.search(r"[-+]?\d*\.?\d+", normalized)
    if not match:
        return None
    number = float(match.group())
    if "ft" in normalized or "feet" in normalized:
        return number * 0.3048
    return number


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"[-+]?\d*\.?\d+", value)
    return float(match.group()) if match else None


def polygon_area(ring: list[list[float]]) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def write_json(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
