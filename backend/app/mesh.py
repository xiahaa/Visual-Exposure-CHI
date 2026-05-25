from dataclasses import asdict, dataclass

from .surface_cells import SurfaceCell


@dataclass(frozen=True)
class PreparedMesh:
    """Triangle mesh payload consumed by Open3D.

    `primitive_to_surface[i]` maps Open3D triangle index `i` back to the
    semantic surface cell that triangle came from. This lookup is the bridge
    between low-level ray hits and user-facing exposure explanations.
    """

    vertices: list[list[float]]
    triangles: list[list[int]]
    primitive_to_surface: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def build_triangle_mesh(surface_cells: list[SurfaceCell]) -> PreparedMesh:
    """Triangulate surface cells into one shared mesh plus primitive map."""

    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    primitive_to_surface: list[str] = []

    for cell in surface_cells:
        start_index = len(vertices)
        vertices.extend(_point_to_vertex(point) for point in cell.geometry_enu)

        # Fan triangulation is enough for the MVP because all authored surfaces
        # are simple convex or near-rectangular polygons. If scenarios later add
        # concave footprints, replace this with Shapely/earcut triangulation.
        for local_triangle in _fan_triangulate(len(cell.geometry_enu)):
            triangles.append([start_index + index for index in local_triangle])
            primitive_to_surface.append(cell.surface_id)

    return PreparedMesh(
        vertices=vertices,
        triangles=triangles,
        primitive_to_surface=primitive_to_surface,
    )


def _point_to_vertex(point: dict[str, float]) -> list[float]:
    """Convert a named ENU vertex dict into Open3D's list format."""

    return [point["x"], point["y"], point["z"]]


def _fan_triangulate(vertex_count: int) -> list[list[int]]:
    """Create triangles `[0, i, i+1]` over a polygon vertex fan."""

    if vertex_count < 3:
        return []
    return [[0, index, index + 1] for index in range(1, vertex_count - 1)]
