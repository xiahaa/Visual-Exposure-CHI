from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .mesh import build_triangle_mesh
from .raycasting import VisibilityScene
from .scenario_store import load_scenario
from .surface_cells import SurfaceCell, build_surface_cells


@dataclass(frozen=True)
class PreparedScene:
    """Cached geometry and lookup arrays for one scenario."""

    scenario: dict
    surface_cells: tuple[SurfaceCell, ...]
    visibility_scene: VisibilityScene
    primitive_to_surface_index: np.ndarray


@lru_cache(maxsize=8)
def get_prepared_scene(scenario_id: str) -> PreparedScene:
    """Load and prepare one scenario for repeated exposure computations."""

    scenario = load_scenario(scenario_id)
    surface_cells = tuple(build_surface_cells(scenario))
    surface_index_by_id = {
        surface.surface_id: index
        for index, surface in enumerate(surface_cells)
    }
    mesh = build_triangle_mesh(list(surface_cells))
    primitive_to_surface_index = np.array(
        [surface_index_by_id[surface_id] for surface_id in mesh.primitive_to_surface],
        dtype=np.int32,
    )
    return PreparedScene(
        scenario=scenario,
        surface_cells=surface_cells,
        visibility_scene=VisibilityScene(mesh),
        primitive_to_surface_index=primitive_to_surface_index,
    )


def clear_prepared_scene_cache() -> None:
    """Clear cached scenario geometry for tests and development reloads."""

    get_prepared_scene.cache_clear()
