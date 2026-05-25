# Backend API Contract

## `GET /api/health`

Returns backend status.

```json
{
  "status": "ok"
}
```

## `GET /api/scenarios/{scenario_id}`

Returns scenario metadata, default route, camera defaults, buildings, and
semantic layers.

```json
{
  "scenario_id": "residential_block_01",
  "origin": {
    "lon": 113.93,
    "lat": 22.54,
    "alt": 0.0
  },
  "default_route": [],
  "camera": {
    "hfov_deg": 78,
    "vfov_deg": 50,
    "gimbal_pitch_deg": -45,
    "ray_width": 80,
    "ray_height": 45
  },
  "buildings": {},
  "semantic_layers": {}
}
```

## `POST /api/exposure/compute`

Computes estimated visual exposure for a route and camera configuration.

The implementation samples the route, generates camera frustum rays for each
pose, casts them against an Open3D `RaycastingScene`, maps first-hit triangles
back to surface cells, and aggregates weighted surface-level exposure.

## `GET /api/scenarios/{scenario_id}/surfaces`

Returns the scenario's backend surface cells in local ENU coordinates. This is a
debugging and inspection endpoint used before Open3D raycasting is attached.

Surface cells include semantic ground regions, building roofs, and building
facades.

## `GET /api/scenarios/{scenario_id}/mesh`

Returns a prepared triangle mesh in local ENU coordinates with a
`primitive_to_surface` list. The list index corresponds to triangle index and
the value is the `surface_id` used for exposure aggregation.

## `POST /api/exposure/compare`

Compares baseline exposure against a modified route or preference set.

The comparison response is computed from two real `/api/exposure/compute`
summaries and reports sensitive exposure reduction, route length change, and
estimated task coverage change.
