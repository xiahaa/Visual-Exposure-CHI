# Backend

FastAPI backend for scenario loading, coordinate conversion, and visual exposure
computation.

## Development

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

From the current project location, the shared Windows development environment is
kept at `D:\CHI\.venv`:

```powershell
cd D:\CHI
python -m venv .venv
D:\CHI\.venv\Scripts\python.exe -m pip install -r D:\CHI\backend\requirements.txt
cd D:\CHI\backend
D:\CHI\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

## Tests

```powershell
cd backend
python -m unittest discover -s tests
```

Using the shared Windows venv:

```powershell
cd D:\CHI\backend
D:\CHI\.venv\Scripts\python.exe -m unittest discover -s tests
```

## Configuration

Backend engine parameters live in `config/backend.yaml`.

```yaml
exposure:
  max_range_m: 250.0
  recognizability_d0_m: 80.0
  route_sample_step_m: 5.0
```

Change this file to tune raycasting range, distance weighting, or route sampling
without editing Python code.

## Near-Term Tasks

1. Replace placeholder exposure with Open3D RaycastingScene.
2. Add WGS84 to local ENU conversion utilities.
3. Generate 2.5D meshes from GeoJSON footprints.
4. Aggregate first-hit rays into surface-level exposure scores.
