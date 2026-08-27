# CHI Drone Visual Exposure Prototype

Research prototype for helping non-expert publics inspect planned drone routes,
understand estimated visual exposure, articulate spatial privacy preferences, and
compare privacy-task trade-offs before flight.

The project is intentionally scoped as a CHI research prototype rather than a
complete low-altitude traffic platform.

## Architecture

```text
frontend/
  React + deck.gl evidence workbench and Three.js study media runner

backend/
  FastAPI service and Open3D-based visibility engine

data/scenarios/
  Reproducible scenario metadata, routes, buildings, and semantic layers

docs/
  Research framing, API contracts, and implementation notes
```

## Implemented Research Flows

- Guided C1/C2/C3 visual-exposure study with strict condition isolation.
- Hong Kong scenario loading, Open3D first-hit exposure estimation, route
  evidence, preference marking, and candidate-based privacy alternatives.
- Four synchronized UAV event profiles (A-D) with M/S/V disclosure conditions,
  third-person context, resident view, and synthetic UAV-camera view.
- V disclosure adds a synchronized evidence viewer with follow/free-orbit
  cameras, optional camera frustum, physical image-clarity surface coloring,
  and pose scrubbing. S disclosure remains a fixed standard 3D presentation.
- An optional Spark renderer uses a small, offline-converted MatrixCity 3DGS
  subset as the shared M/S/V event environment. UAV, resident, route, camera,
  frustum, and clarity evidence use one local ENU metre frame; complete training
  assets remain outside the repository.
- Anonymous server-side study-cell assignment with configurable capacities,
  persistent event/response ingestion, completion-code issuance, code-based
  auditing, and structured export.

The participant runner is opened at `/runner`. A participant URL may include an
opaque `entry_token`, but it does not select a profile or disclosure condition:
the backend assigns the experimental cell. `/setup` provides facilitator links
and a separate preview mode that does not write study data.

## Deployment

The recommended deployment is split by responsibility:

```text
Vercel:
  frontend/ static React app

Hugging Face Spaces:
  Dockerized FastAPI + Open3D backend
```

After the Hugging Face Space is live, set the Vercel environment variable:

```text
VITE_API_BASE_URL=https://<user-or-org>-<space-name>.hf.space
VITE_MATRIXCITY_GS_MANIFEST_URL=https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-neighborhood-study-v2.json
VITE_MATRIXCITY_GS_URL=https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-tile19-study-v1.spz
```

The manifest keeps the 25.9 MB primary tile as the first render and loads eight
lower-density context tiles only when a V-condition participant unlocks scene
exploration. `VITE_MATRIXCITY_GS_URL` remains a single-tile fallback. For a
formal study with mainland-China participants, upload the manifest and its nine
immutable SPZ files to OSS/COS with CDN and CORS enabled, then replace only
`VITE_MATRIXCITY_GS_MANIFEST_URL`.

For a live study, mount persistent storage in the backend and set:

```text
VEP_STUDY_DB_PATH=/data/study_sessions.sqlite3
VEP_ADMIN_KEY=<researcher-only secret>
```

SQLite is intended for one deployed backend instance with moderate concurrent
study traffic. Use PostgreSQL before running multiple backend replicas.

See `docs/HF_SPACES_DEPLOYMENT.md` for the full checklist.
See `docs/MATRIXCITY_3DGS.md` for the local subset export and browser-loading
workflow.
See `docs/MATRIXCITY_FLIGHT_CONFIGURATION.md` for facilitator trajectory and
camera configuration ranges, JSON import/export, and pilot validation guidance.

## Core Principle

The frontend does not decide privacy. The backend does not decide user choices.
The backend estimates visual exposure; the frontend helps users inspect,
annotate, and reason about it.

## MVP Milestones

1. Define one reproducible residential block scenario.
2. Implement backend scenario loading and API contracts. Done.
3. Add local ENU coordinate conversion utilities. Done.
4. Build a 2.5D block visibility scene. Done.
5. Compute surface-level visual exposure. Done for the first Open3D raycasting pass.
6. Render buildings, route, exposure cells, and annotations in deck.gl. Done.
7. Add before/after comparison and experiment logging. Done.
8. Add candidate-based privacy option generation for suggested route/camera alternatives. Done.
9. Add balanced study-cell assignment, persistent event ingestion, completion codes, and structured research export. Done.
