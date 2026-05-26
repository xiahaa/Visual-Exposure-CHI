from dataclasses import dataclass

import numpy as np
import open3d as o3d

from .mesh import PreparedMesh, build_triangle_mesh
from .surface_cells import SurfaceCell


@dataclass(frozen=True)
class RayHit:
    """A first-hit result translated back into prototype terms."""

    surface_id: str
    # Distance from ray origin to first triangle hit, in meters.
    distance: float
    # Cosine-like viewing weight in [0, 1]. Higher means the ray meets the
    # surface more frontally; grazing views contribute less exposure.
    incidence: float
    ray_direction: np.ndarray


class VisibilityScene:
    """Open3D raycasting wrapper with semantic surface mapping."""

    def __init__(self, mesh: PreparedMesh):
        self.mesh = mesh
        self.scene = o3d.t.geometry.RaycastingScene()
        # Open3D stores all triangles in an acceleration structure internally.
        # We keep our own `PreparedMesh` because Open3D only returns primitive
        # IDs, while the API needs surface IDs.
        vertices = o3d.core.Tensor(mesh.vertices, dtype=o3d.core.Dtype.Float32)
        triangles = o3d.core.Tensor(mesh.triangles, dtype=o3d.core.Dtype.UInt32)
        triangle_mesh = o3d.t.geometry.TriangleMesh(vertices, triangles)
        self.geometry_id = self.scene.add_triangles(triangle_mesh)

    @classmethod
    def from_surface_cells(cls, surface_cells: list[SurfaceCell]) -> "VisibilityScene":
        """Build a raycasting scene directly from semantic surface cells."""

        return cls(build_triangle_mesh(surface_cells))

    def cast(self, rays: np.ndarray, max_range_m: float, min_range_m: float = 0.0) -> list[RayHit]:
        """Cast rays and return valid first hits within the configured range."""

        if rays.size == 0:
            return []

        # `cast_rays` returns one result per input ray. We use t_hit for range,
        # primitive_ids for surface mapping, and primitive_normals for incidence.
        result = self.scene.cast_rays(o3d.core.Tensor(rays, dtype=o3d.core.Dtype.Float32))
        t_hit = result["t_hit"].numpy()
        primitive_ids = result["primitive_ids"].numpy()
        primitive_normals = result["primitive_normals"].numpy()
        ray_directions = rays[:, 3:]

        hits: list[RayHit] = []
        for index, distance in enumerate(t_hit):
            # Open3D uses inf for misses. We also discard zero/negative and
            # beyond-range hits so distant background surfaces do not dominate.
            if (
                not np.isfinite(distance)
                or distance <= 0.0
                or distance < min_range_m
                or distance > max_range_m
            ):
                continue

            primitive_id = int(primitive_ids[index])
            # Defensive guard: primitive IDs should align with the prepared mesh,
            # but malformed geometry should fail closed instead of crashing.
            if primitive_id < 0 or primitive_id >= len(self.mesh.primitive_to_surface):
                continue

            normal = primitive_normals[index]
            ray_direction = ray_directions[index]
            # Absolute dot product treats either triangle winding as valid. This
            # avoids exposure changing just because a polygon ring is clockwise
            # or counter-clockwise.
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
    """Return a unit vector while preserving zero vectors defensively."""

    norm = np.linalg.norm(vector)
    if norm == 0.0:
        return vector
    return vector / norm
