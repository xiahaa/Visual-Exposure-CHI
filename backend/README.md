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

## Production / Railpack

For deployments built from the repository root, Railpack uses
`/tmp/workspace/xiahaa/Visual-Exposure-CHI/railpack.json` to start the backend
with:

```text
uvicorn api.index:app --host 0.0.0.0 --port ${PORT:-8000}
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

1. Continue validating Open3D first-hit raycasting against small synthetic geometry cases.
2. Expand planner validation for route/camera alternatives near complex preference polygons.
3. Keep scenario and camera parameters in YAML so study runs remain reproducible.
4. Profile Hong Kong scenario latency after each planning or exposure-engine change.
