import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import load_backend_config
from .models import CompareRequest, ExposureRequest, PlanningRequest
from .scenario_store import load_prepared_mesh, load_scenario, load_surface_cells
from .study_routes import router as study_router

# Navigate from backend/app/main.py back to the repository root.
ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"
FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR / "index.html"
FRONTEND_FAVICON_PATH = FRONTEND_DIST_DIR / "favicon.ico"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
FRONTEND_SCENARIOS_DIR = FRONTEND_DIST_DIR / "scenarios"
GS_ASSETS_DIR = ROOT_DIR / "assets"

app = FastAPI(title="CHI Drone Visual Exposure Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_origin_regex=os.getenv(
        "CORS_ALLOW_ORIGIN_REGEX",
        r"https://(?:.*\.(?:vercel\.app|hf\.space)|(?:www\.)?aam-privacy-study\.cn)",
    ),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(study_router)


if FRONTEND_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="frontend-assets")

if FRONTEND_SCENARIOS_DIR.exists():
    app.mount("/scenarios", StaticFiles(directory=FRONTEND_SCENARIOS_DIR), name="frontend-scenarios")


@app.get("/", include_in_schema=False)
def root() -> Response:
    """Serve the built frontend when available, otherwise show a small landing page."""

    if FRONTEND_INDEX_PATH.exists():
        return FileResponse(FRONTEND_INDEX_PATH)

    return HTMLResponse(
        """
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>CHI Drone Visual Exposure Prototype</title>
          </head>
          <body>
            <h1>CHI Drone Visual Exposure Prototype</h1>
            <p>The backend is running.</p>
            <p>API health: <a href="/api/health">/api/health</a></p>
          </body>
        </html>
        """.strip()
    )


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    """Return the frontend favicon when present, otherwise avoid a 404."""

    if FRONTEND_FAVICON_PATH.exists():
        return FileResponse(FRONTEND_FAVICON_PATH)
    return Response(status_code=204)


@app.api_route(
    "/gs-assets/{asset_name}",
    methods=["GET", "HEAD"],
    include_in_schema=False,
)
def gaussian_splat_asset(asset_name: str) -> Response:
    """Serve an immutable browser-ready Gaussian asset or tile manifest.

    The route deliberately accepts a filename rather than an arbitrary path.
    This keeps study assets outside the frontend bundle while preventing path
    traversal into other files in the backend container.
    """

    media_types = {
        ".spz": "application/octet-stream",
        ".json": "application/json",
    }
    suffix = Path(asset_name).suffix.lower()
    if Path(asset_name).name != asset_name or suffix not in media_types:
        raise HTTPException(status_code=404, detail="Gaussian asset not found")

    asset_path = GS_ASSETS_DIR / asset_name
    if not asset_path.is_file():
        raise HTTPException(status_code=404, detail="Gaussian asset not found")

    return FileResponse(
        asset_path,
        media_type=media_types[suffix],
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/api/health")
def health() -> dict[str, str]:
    """Small readiness endpoint for local dev and frontend checks."""

    return {"status": "ok"}


@app.get("/api/gaussian-assets")
def get_gaussian_asset_catalog() -> dict:
    """Return browser GS delivery profiles without proxying large assets.

    Vercel clients fetch SPZ pages directly from OSS. Keeping the profile list
    in backend YAML lets a study operator change the default or disable the
    high-quality path without rebuilding the frontend bundle.
    """

    return load_backend_config().gaussian_assets.model_dump(mode="json")


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> dict:
    """Return the frontend-facing scenario payload."""

    try:
        return load_scenario(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.get("/api/scenarios/{scenario_id}/surfaces")
def get_scenario_surfaces(scenario_id: str) -> dict:
    """Return semantic surface cells for debugging the backend model."""

    try:
        return load_surface_cells(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.get("/api/scenarios/{scenario_id}/mesh")
def get_scenario_mesh(scenario_id: str) -> dict:
    """Return prepared triangles and primitive mapping for raycasting checks."""

    try:
        return load_prepared_mesh(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.post("/api/exposure/compute")
def post_compute_exposure(request: ExposureRequest) -> dict:
    """Compute estimated visual exposure for a route/camera request."""

    from .services.exposure import compute_exposure

    try:
        return compute_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/exposure/compare")
def post_compare_exposure(request: CompareRequest) -> dict:
    """Compare two exposure computations for privacy-task trade-off feedback."""

    from .services.exposure import compare_exposure

    try:
        return compare_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/planning/optimize")
def post_optimize_planning(request: PlanningRequest) -> dict:
    """Generate privacy-aware route/camera alternatives for decision support."""

    from .services.planning import optimize_planning

    try:
        return optimize_planning(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# Register this last. FastAPI matches earlier routes first, so backend
# endpoints must be declared above it and should stay under /api.
@app.get("/{path:path}", include_in_schema=False)
def frontend_fallback(path: str) -> Response:
    """Serve the SPA entrypoint for all non-API routes."""

    if not FRONTEND_INDEX_PATH.exists():
        raise HTTPException(status_code=404, detail="Frontend build not available")
    return FileResponse(FRONTEND_INDEX_PATH)
