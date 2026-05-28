# CHI Drone Visual Exposure Prototype

Research prototype for helping non-expert publics inspect planned drone routes,
understand estimated visual exposure, articulate spatial privacy preferences, and
compare privacy-task trade-offs before flight.

The project is intentionally scoped as a CHI research prototype rather than a
complete low-altitude traffic platform.

## Architecture

```text
frontend/
  React + deck.gl map interface

backend/
  FastAPI service and Open3D-based visibility engine

data/scenarios/
  Reproducible scenario metadata, routes, buildings, and semantic layers

docs/
  Research framing, API contracts, and implementation notes
```

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
```

See `docs/HF_SPACES_DEPLOYMENT.md` for the full checklist.

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
