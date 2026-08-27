"""Export a small MatrixCity runtime-pack subset for browser 3DGS rendering.

The trained MatrixCity asset is split into many PyTorch pages. Loading the
whole domain in a browser would be wasteful, so this script selects only the
pages nearest one tile centre, filters nearly transparent Gaussians, and writes
an INRIA-style binary PLY accepted by Spark's ``SplatMesh`` loader.

Example (from WSL with the repository mounted at /mnt/d/CHI):

    python scripts/export_matrixcity_spark_ply.py \
      --asset-root /mnt/f/MatrixCity/render_assets_sh3_full \
      --tile-id block3_tile19 --page-count 16 \
      --focus-page e+00001_n+00036 --focus-page e+00001_n+00037 \
      --focus-page e+00002_n+00036 --focus-page e+00002_n+00037 \
      --focus-weight 2 --max-splats 1000000 \
      --min-opacity 0.005 --max-scale-m 4 \
      --output frontend/public/gs-local/matrixcity-tile19-study.ply

The output remains local and is ignored by Git. Deploy a converted ``.ply`` or
``.spz`` through object storage/CDN and set ``VITE_MATRIXCITY_GS_URL`` instead
of committing the trained asset to this repository.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import torch


SH_DEGREE_3_COEFFICIENTS = 16


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--asset-root",
        type=Path,
        required=True,
        help="Directory containing manifest.json and runtime_packs_sh3_full/.",
    )
    parser.add_argument("--tile-id", default="block3_tile19")
    parser.add_argument("--page-count", type=int, default=2)
    parser.add_argument(
        "--page",
        action="append",
        default=[],
        help="Explicit page cell_id. Repeat to export multiple pages.",
    )
    parser.add_argument(
        "--focus-page",
        action="append",
        default=[],
        help="Page that receives a larger share of the splat budget. Repeat as needed.",
    )
    parser.add_argument(
        "--focus-weight",
        type=float,
        default=8.0,
        help="Relative splat-budget weight assigned to each focus page.",
    )
    parser.add_argument("--max-splats", type=int, default=600_000)
    parser.add_argument("--min-opacity", type=float, default=0.005)
    parser.add_argument(
        "--max-scale-m",
        type=float,
        default=4.0,
        help="Discard oversized Gaussian axes that appear as long floating streaks.",
    )
    parser.add_argument("--seed", type=int, default=20260826)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def select_cells(pack: dict[str, Any], explicit_pages: list[str], page_count: int) -> list[dict[str, Any]]:
    cells = pack.get("cells", [])
    if explicit_pages:
        wanted = set(explicit_pages)
        selected = [cell for cell in cells if cell.get("cell_id") in wanted]
        missing = wanted.difference(cell["cell_id"] for cell in selected)
        if missing:
            raise ValueError(f"Pages not found in pack: {', '.join(sorted(missing))}")
        return selected

    if page_count < 1:
        raise ValueError("--page-count must be at least 1")
    if not cells:
        raise ValueError("The selected tile has no runtime pages")

    all_bounds = np.asarray([cell["bounds"] for cell in cells], dtype=np.float64)
    tile_center = np.array(
        [
            (all_bounds[:, 0].min() + all_bounds[:, 2].max()) / 2,
            (all_bounds[:, 1].min() + all_bounds[:, 3].max()) / 2,
        ],
        dtype=np.float64,
    )

    def distance_to_tile_center(cell: dict[str, Any]) -> float:
        west, south, east, north = cell["bounds"]
        centre = np.array([(west + east) / 2, (south + north) / 2])
        return float(np.linalg.norm(centre - tile_center))

    return sorted(cells, key=distance_to_tile_center)[: min(page_count, len(cells))]


def sigmoid(value: torch.Tensor) -> torch.Tensor:
    return torch.sigmoid(value.float())


def load_page(
    page_path: Path,
    min_opacity: float,
    max_scale_m: float,
    local_cap: int,
) -> dict[str, np.ndarray]:
    payload = torch.load(page_path, map_location="cpu", weights_only=True)
    tensors = payload.get("tensors")
    if not isinstance(tensors, dict):
        raise ValueError(f"{page_path} does not contain a tensors mapping")

    required = {"means", "quats", "scales", "opacities", "colors"}
    missing = required.difference(tensors)
    if missing:
        raise ValueError(f"{page_path} is missing tensors: {', '.join(sorted(missing))}")

    colors = tensors["colors"]
    if colors.ndim != 3 or tuple(colors.shape[1:]) != (SH_DEGREE_3_COEFFICIENTS, 3):
        raise ValueError(
            f"Expected SH3 colors shaped [N, 16, 3], got {tuple(colors.shape)} in {page_path}",
        )

    opacity_probability = sigmoid(tensors["opacities"])
    maximum_axis_scale = torch.exp(tensors["scales"].float()).amax(dim=1)
    valid = (opacity_probability >= min_opacity) & (maximum_axis_scale <= max_scale_m)
    indices = torch.nonzero(valid, as_tuple=False).flatten()
    if indices.numel() > local_cap:
        scores = opacity_probability.index_select(0, indices)
        indices = indices.index_select(0, torch.topk(scores, local_cap, sorted=False).indices)

    def take(name: str) -> np.ndarray:
        return tensors[name].index_select(0, indices).float().numpy()

    return {
        "means": take("means"),
        "quats": take("quats"),
        "scales": take("scales"),
        "opacities": take("opacities").reshape(-1),
        "colors": take("colors"),
    }


def trim_to_limit(pages: list[dict[str, np.ndarray]], max_splats: int) -> dict[str, np.ndarray]:
    if max_splats < 1:
        raise ValueError("--max-splats must be at least 1")
    merged = {key: np.concatenate([page[key] for page in pages], axis=0) for key in pages[0]}
    if merged["opacities"].shape[0] <= max_splats:
        return merged

    # Highest-opacity selection is deterministic and preserves the visually
    # strongest primitives. Stable sorting keeps repeated exports identical.
    selected = np.argsort(-merged["opacities"], kind="stable")[:max_splats]
    return {key: value[selected] for key, value in merged.items()}


def build_vertex_array(data: dict[str, np.ndarray], origin_enu: np.ndarray) -> tuple[np.ndarray, list[str]]:
    means = data["means"] - origin_enu[None, :]
    colors = data["colors"]
    dc = colors[:, 0, :]
    # INRIA PLY stores the 15 non-DC coefficients channel-major.
    rest = colors[:, 1:, :].transpose(0, 2, 1).reshape(colors.shape[0], -1)

    names = ["x", "y", "z", "nx", "ny", "nz"]
    names += [f"f_dc_{index}" for index in range(3)]
    names += [f"f_rest_{index}" for index in range(rest.shape[1])]
    names += ["opacity"]
    names += [f"scale_{index}" for index in range(3)]
    names += [f"rot_{index}" for index in range(4)]

    rows = np.column_stack(
        [
            means,
            np.zeros_like(means),
            dc,
            rest,
            data["opacities"][:, None],
            data["scales"],
            data["quats"],
        ],
    ).astype("<f4", copy=False)
    return rows, names


def write_binary_ply(path: Path, rows: np.ndarray, names: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header_lines = ["ply", "format binary_little_endian 1.0", "comment MatrixCity SH3 subset"]
    header_lines.append(f"element vertex {rows.shape[0]}")
    header_lines.extend(f"property float {name}" for name in names)
    header_lines.append("end_header")
    with path.open("wb") as handle:
        handle.write(("\n".join(header_lines) + "\n").encode("ascii"))
        rows.tofile(handle)


def main() -> None:
    args = parse_args()
    if not 0 <= args.min_opacity < 1:
        raise ValueError("--min-opacity must be in [0, 1)")
    if args.max_scale_m <= 0:
        raise ValueError("--max-scale-m must be positive")
    if args.focus_weight < 1:
        raise ValueError("--focus-weight must be at least 1")
    torch.manual_seed(args.seed)

    pack_root = args.asset_root / "runtime_packs_sh3_full" / args.tile_id
    pack = read_json(pack_root / "pack.json")
    cells = select_cells(pack, args.page, args.page_count)
    selected_ids = {cell["cell_id"] for cell in cells}
    unknown_focus = set(args.focus_page).difference(selected_ids)
    if unknown_focus:
        raise ValueError(
            f"Focus pages are not selected: {', '.join(sorted(unknown_focus))}",
        )
    focus_ids = set(args.focus_page)
    weights = [args.focus_weight if cell["cell_id"] in focus_ids else 1.0 for cell in cells]
    weight_total = sum(weights)
    # Allocate more of the fixed browser budget to the study target while still
    # retaining lower-density context pages around the extended trajectory.
    local_caps = [
        max(1, math.floor(args.max_splats * weight / weight_total))
        for weight in weights
    ]
    pages = [
        load_page(pack_root / cell["path"], args.min_opacity, args.max_scale_m, local_cap)
        for cell, local_cap in zip(cells, local_caps, strict=True)
    ]
    data = trim_to_limit(pages, args.max_splats)

    bounds = np.asarray([cell["bounds"] for cell in cells], dtype=np.float64)
    origin_enu = np.array(
        [
            (bounds[:, 0].min() + bounds[:, 2].max()) / 2,
            (bounds[:, 1].min() + bounds[:, 3].max()) / 2,
            float(np.median([cell["ground_reference_up_m"] for cell in cells])),
        ],
        dtype=np.float32,
    )
    rows, names = build_vertex_array(data, origin_enu)
    write_binary_ply(args.output, rows, names)

    metadata = {
        "source_format": "matrixcity-full-domain-3dgs-v1",
        "tile_id": args.tile_id,
        "cell_ids": [cell["cell_id"] for cell in cells],
        "focus_cell_ids": sorted(focus_ids),
        "focus_weight": args.focus_weight,
        "splat_count": int(rows.shape[0]),
        "origin_enu_m": origin_enu.tolist(),
        "coordinate_frame": "local_enu_m",
        "three_rotation_x_deg": -90,
        "min_opacity": args.min_opacity,
        "max_scale_m": args.max_scale_m,
        "asset_file": args.output.name,
    }
    metadata_path = args.output.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), **metadata}, indent=2))


if __name__ == "__main__":
    main()
