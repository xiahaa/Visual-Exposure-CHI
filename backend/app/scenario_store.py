import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
SCENARIO_DIR = ROOT_DIR / "data" / "scenarios"


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_scenario(scenario_id: str) -> dict:
    scenario_path = SCENARIO_DIR / scenario_id
    scenario = read_json(scenario_path / "scenario.json")
    scenario["buildings"] = read_json(scenario_path / "buildings.geojson")
    scenario["semantic_layers"] = read_json(scenario_path / "semantic_layers.geojson")
    return scenario


def load_surface_cells(scenario_id: str) -> dict:
    from .surface_cells import surface_cells_response

    return surface_cells_response(load_scenario(scenario_id))


def load_prepared_mesh(scenario_id: str) -> dict:
    from .mesh import build_triangle_mesh
    from .surface_cells import build_surface_cells

    scenario = load_scenario(scenario_id)
    mesh = build_triangle_mesh(build_surface_cells(scenario)).to_dict()
    return {
        "scenario_id": scenario_id,
        "origin": scenario["origin"],
        "mesh": mesh,
    }
