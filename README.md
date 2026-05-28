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

## Deployment

This repository is already configured for a single Vercel deployment:

- `frontend/` builds the React application.
- `api/index.py` exposes the FastAPI backend as a Vercel Python function.
- `/api/*` rewrites to the backend and all other routes rewrite to the SPA.

### Deploy on Vercel

1. From the repository root, run `npm --prefix frontend ci`.
2. Verify the frontend production build with `npm --prefix frontend run build`.
3. Import the GitHub repository into Vercel, or run `vercel` from the repository root.
4. Keep the project root at the repository root so Vercel uses `vercel.json`.

### Environment variables

- Leave `VITE_API_BASE_URL` unset in production when the frontend and backend are deployed together on Vercel.
- Set `VITE_API_BASE_URL` only if the frontend should call a separately hosted backend.

### Post-deploy checks

- `https://<your-domain>/api/health` should return `{"status":"ok"}`.
- The deployed frontend should load scenario data and complete exposure requests through `/api/...`.
