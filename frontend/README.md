# Frontend

React + deck.gl interface for the CHI drone visual exposure prototype.

## Planned Layers

- `BuildingLayer`: 2.5D extruded building blocks.
- `RouteLayer`: planned route, waypoints, and direction.
- `CameraFootprintLayer`: sampled camera coverage footprints.
- `ExposureLayer`: surface-level exposure cells.
- `SensitiveAreaLayer`: semantic sensitive regions.
- `UserPreferenceLayer`: user-drawn do-not-capture and sensitive areas.
- `ComparisonLayer`: before/after exposure and task impact.

## Near-Term Tasks

1. Scaffold Vite + React + TypeScript.
2. Add deck.gl and MapLibre dependencies.
3. Load `/api/scenarios/residential_block_01`.
4. Render buildings, route, and semantic layers.
5. Call `/api/exposure/compute` and render exposure cells.

