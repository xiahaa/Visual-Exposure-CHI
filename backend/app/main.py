from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from .models import CompareRequest, ExposureRequest, PlanningRequest
from .scenario_store import load_prepared_mesh, load_scenario, load_surface_cells

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"
FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR / "index.html"
FRONTEND_FAVICON_PATH = FRONTEND_DIST_DIR / "favicon.ico"

app = FastAPI(title="CHI Drone Visual Exposure Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/health")
def health() -> dict[str, str]:
    """Small readiness endpoint for local dev and frontend checks."""

    return {"status": "ok"}


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


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> Response:
    """Serve built frontend assets and fall back to the SPA entrypoint."""

    if not FRONTEND_INDEX_PATH.exists():
        raise HTTPException(status_code=404)

    asset_path = _resolve_frontend_path(path)
    if asset_path is not None:
        return FileResponse(asset_path)
    return FileResponse(FRONTEND_INDEX_PATH)


def _resolve_frontend_path(path: str) -> Path | None:
    """Resolve a request path inside the built frontend directory."""

    requested_path = (FRONTEND_DIST_DIR / path).resolve()
    frontend_root = FRONTEND_DIST_DIR.resolve()
    try:
        requested_path.relative_to(frontend_root)
    except ValueError:
        return None
    return requested_path if requested_path.is_file() else None
