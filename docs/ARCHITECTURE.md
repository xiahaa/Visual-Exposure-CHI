# Architecture

## System Layers

```text
Frontend: React + deck.gl
  Map display, route display, exposure cells, user annotation, comparison UI

Backend API: FastAPI
  Scenario loading, visual exposure computation, comparison responses

Visibility Engine: Open3D RaycastingScene
  2.5D block model, camera frustum rays, first-hit surface aggregation

Data Layer
  Scenario JSON, GeoJSON layers, semantic labels, route and camera metadata
```

## Data Flow

```text
deck.gl lon/lat route and polygons
  -> FastAPI request
  -> WGS84 to local ENU conversion
  -> Open3D RaycastingScene first-hit queries
  -> exposure aggregation by surface cell
  -> GeoJSON response
  -> deck.gl exposure layers
```

## Coordinate Contract

The frontend uses WGS84 coordinates:

```text
[longitude, latitude, altitude]
```

The backend visibility engine uses a local ENU coordinate system in meters:

```text
origin = {lon0, lat0, alt0}
x = east meters
y = north meters
z = up meters
```

Raycasting must not run directly on longitude and latitude values.

## Exposure Model

The prototype reports estimated visual exposure, not privacy violation.

For a surface cell `i` and sampled drone pose `k`:

```text
E_i = sum(V_ik * R_ik * T_k * A_ik * S_i)
```

Where:

- `V_ik`: whether a first-hit ray reaches the surface.
- `R_ik`: recognizability proxy based on distance.
- `T_k`: time or route sampling weight.
- `A_ik`: incidence angle weight.
- `S_i`: semantic sensitivity weight.

## Backend Implementation Status

The backend now implements the full first-pass visibility pipeline:

```text
route WGS84 points
  -> local ENU route samples
  -> camera frustum rays
  -> Open3D RaycastingScene first-hit queries
  -> primitive_id to surface_id lookup
  -> distance/incidence/sensitivity exposure aggregation
  -> GeoJSON exposure response
```

The engine remains an estimated geometric model. It uses a 2.5D block scene and
does not claim to detect actual privacy violations.

Engine parameters are loaded from `backend/config/backend.yaml`, including
raycasting range, recognizability distance, and route sampling interval.
