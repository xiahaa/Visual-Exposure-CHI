from fastapi import FastAPI, HTTPException

from .models import CompareRequest, ExposureRequest
from .scenario_store import load_prepared_mesh, load_scenario, load_surface_cells
from .services.exposure import compare_exposure, compute_exposure

app = FastAPI(title="CHI Drone Visual Exposure Prototype")


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

    try:
        return compute_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.post("/api/exposure/compare")
def post_compare_exposure(request: CompareRequest) -> dict:
    """Compare two exposure computations for privacy-task trade-off feedback."""

    try:
        return compare_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc
