from fastapi import FastAPI, HTTPException

from .models import CompareRequest, ExposureRequest
from .scenario_store import load_prepared_mesh, load_scenario, load_surface_cells
from .services.exposure import compare_exposure, compute_exposure

app = FastAPI(title="CHI Drone Visual Exposure Prototype")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> dict:
    try:
        return load_scenario(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.get("/api/scenarios/{scenario_id}/surfaces")
def get_scenario_surfaces(scenario_id: str) -> dict:
    try:
        return load_surface_cells(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.get("/api/scenarios/{scenario_id}/mesh")
def get_scenario_mesh(scenario_id: str) -> dict:
    try:
        return load_prepared_mesh(scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.post("/api/exposure/compute")
def post_compute_exposure(request: ExposureRequest) -> dict:
    try:
        return compute_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc


@app.post("/api/exposure/compare")
def post_compare_exposure(request: CompareRequest) -> dict:
    try:
        return compare_exposure(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found") from exc
