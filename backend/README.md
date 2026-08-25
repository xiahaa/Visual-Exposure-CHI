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

For deployments built from the repository root, Railpack uses the root
`railpack.json` file to start the backend with:

```text
uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
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
python -m pytest tests -q
```

Using the shared Windows venv:

```powershell
cd D:\CHI\backend
D:\CHI\.venv\Scripts\python.exe -m pytest tests -q
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

Study assignment limits and completion requirements are configured under
`study` in the same YAML file. For deployment, set:

```text
VEP_ADMIN_KEY=<researcher-only secret>
VEP_STUDY_DB_PATH=/persistent/path/study_sessions.sqlite3
```

`VEP_STUDY_DB_PATH` should point to persistent storage. SQLite runs in WAL mode
and assignment uses an immediate transaction, so concurrent workers share the
same per-cell capacity limits. Do not place the database in an ephemeral
container directory for a live study.

## Study Data Service

Participant endpoints under `/api/study` support anonymous launch, start
confirmation, phase updates, idempotent event batches, response batches, and
completion-code issuance. Researcher endpoints support pool monitoring,
completion-code lookup, and ZIP export:

```text
GET /api/admin/study-pool
GET /api/admin/study-results/{completion_code}
GET /api/admin/export/all
```

Researcher requests require `X-Admin-Key`. Per-cell capacities and required
completion events are defined in `config/backend.yaml`; restart the backend
after changing them. See `docs/API.md` for request and response details.

## Near-Term Tasks

1. Continue validating Open3D first-hit raycasting against small synthetic geometry cases.
2. Expand planner validation for route/camera alternatives near complex preference polygons.
3. Keep scenario and camera parameters in YAML so study runs remain reproducible.
4. Profile Hong Kong scenario latency after each planning or exposure-engine change.
5. Freeze the study cell capacities and completion-event requirements before data collection.
