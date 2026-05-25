from dataclasses import asdict, dataclass

from .surface_cells import SurfaceCell


@dataclass(frozen=True)
class PreparedMesh:
    vertices: list[list[float]]
    triangles: list[list[int]]
    primitive_to_surface: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def build_triangle_mesh(surface_cells: list[SurfaceCell]) -> PreparedMesh:
    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    primitive_to_surface: list[str] = []

    for cell in surface_cells:
        start_index = len(vertices)
        vertices.extend(_point_to_vertex(point) for point in cell.geometry_enu)

        for local_triangle in _fan_triangulate(len(cell.geometry_enu)):
            triangles.append([start_index + index for index in local_triangle])
            primitive_to_surface.append(cell.surface_id)

    return PreparedMesh(
        vertices=vertices,
        triangles=triangles,
        primitive_to_surface=primitive_to_surface,
    )


def _point_to_vertex(point: dict[str, float]) -> list[float]:
    return [point["x"], point["y"], point["z"]]


def _fan_triangulate(vertex_count: int) -> list[list[int]]:
    if vertex_count < 3:
        return []
    return [[0, index, index + 1] for index in range(1, vertex_count - 1)]

