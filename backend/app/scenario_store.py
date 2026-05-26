import json
from pathlib import Path

from .config import load_backend_config


ROOT_DIR = Path(__file__).resolve().parents[2]
SCENARIO_DIR = ROOT_DIR / "data" / "scenarios"


def read_json(path: Path) -> dict:
    """Read UTF-8 JSON/GeoJSON into a Python dictionary."""

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_scenario(scenario_id: str) -> dict:
    """Load a complete scenario bundle from disk.

    Scenario data is deliberately file-based for the MVP so experiments remain
    reproducible and easy to inspect without a database.
    """

    scenario_path = SCENARIO_DIR / scenario_id
    scenario = read_json(scenario_path / "scenario.json")
    scenario["buildings"] = read_json(scenario_path / "buildings.geojson")
    scenario["semantic_layers"] = read_json(scenario_path / "semantic_layers.geojson")
    _attach_camera_profiles(scenario)
    return scenario


def load_surface_cells(scenario_id: str) -> dict:
    """Load a scenario and return its derived surface-cell representation."""

    # Import locally to avoid a module cycle: scenario_store is a low-level data
    # loader, while surface_cells builds derived geometry from loaded scenarios.
    from .surface_cells import surface_cells_response

    return surface_cells_response(load_scenario(scenario_id))


def load_prepared_mesh(scenario_id: str) -> dict:
    """Load a scenario and return the raycasting mesh debug payload."""

    # Local imports keep the base scenario loader usable without importing
    # Open3D-adjacent geometry modules.
    from .mesh import build_triangle_mesh
    from .surface_cells import build_surface_cells

    scenario = load_scenario(scenario_id)
    mesh = build_triangle_mesh(build_surface_cells(scenario)).to_dict()
    return {
        "scenario_id": scenario_id,
        "origin": scenario["origin"],
        "mesh": mesh,
    }


def _attach_camera_profiles(scenario: dict) -> None:
    """Attach YAML camera presets to the frontend scenario payload."""

    profiles_config = load_backend_config().camera_profiles
    profiles = profiles_config["profiles"]
    default_profile_id = profiles_config["default_profile_id"]
    scenario["camera_profiles"] = profiles
    scenario["default_camera_profile_id"] = default_profile_id

    default_profile = next(
        (profile for profile in profiles if profile["id"] == default_profile_id),
        None,
    )
    if default_profile:
        scenario["camera"] = default_profile["camera"]
