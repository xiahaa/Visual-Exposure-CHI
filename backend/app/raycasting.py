from dataclasses import dataclass

import numpy as np
import open3d as o3d

from .mesh import PreparedMesh, build_triangle_mesh
from .surface_cells import SurfaceCell


@dataclass(frozen=True)
class RayHit:
    surface_id: str
    distance: float
    incidence: float
    ray_direction: np.ndarray


class VisibilityScene:
    def __init__(self, mesh: PreparedMesh):
        self.mesh = mesh
        self.scene = o3d.t.geometry.RaycastingScene()
        vertices = o3d.core.Tensor(mesh.vertices, dtype=o3d.core.Dtype.Float32)
        triangles = o3d.core.Tensor(mesh.triangles, dtype=o3d.core.Dtype.UInt32)
        triangle_mesh = o3d.t.geometry.TriangleMesh(vertices, triangles)
        self.geometry_id = self.scene.add_triangles(triangle_mesh)

    @classmethod
    def from_surface_cells(cls, surface_cells: list[SurfaceCell]) -> "VisibilityScene":
        return cls(build_triangle_mesh(surface_cells))

    def cast(self, rays: np.ndarray, max_range_m: float) -> list[RayHit]:
        if rays.size == 0:
            return []

        result = self.scene.cast_rays(o3d.core.Tensor(rays, dtype=o3d.core.Dtype.Float32))
        t_hit = result["t_hit"].numpy()
        primitive_ids = result["primitive_ids"].numpy()
        primitive_normals = result["primitive_normals"].numpy()
        ray_directions = rays[:, 3:]

        hits: list[RayHit] = []
        for index, distance in enumerate(t_hit):
            if not np.isfinite(distance) or distance <= 0.0 or distance > max_range_m:
                continue

            primitive_id = int(primitive_ids[index])
            if primitive_id < 0 or primitive_id >= len(self.mesh.primitive_to_surface):
                continue

            normal = primitive_normals[index]
            ray_direction = ray_directions[index]
            incidence = float(abs(np.dot(_normalize(normal), _normalize(ray_direction))))
            hits.append(
                RayHit(
                    surface_id=self.mesh.primitive_to_surface[primitive_id],
                    distance=float(distance),
                    incidence=incidence,
                    ray_direction=ray_direction,
                )
            )
        return hits


def _normalize(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0.0:
        return vector
    return vector / norm
