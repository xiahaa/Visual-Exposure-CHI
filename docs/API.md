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

Shows a preference-weighted exposure comparison for the same or modified route.
This endpoint is used by the frontend action `Show Preference-Weighted
Exposure`: it re-scores exposure with user-marked sensitive and do-not-capture
areas, but it does not generate a new route or claim mitigation by itself.

The comparison response is computed from two real `/api/exposure/compute`
summaries and reports total exposure change, sensitive exposure change, route
length change, and estimated task coverage change.

## `POST /api/planning/optimize`

Generates privacy-aware suggested alternatives for route, altitude, and camera
settings. This is a deterministic candidate-based response generator, not a
globally optimal path planner.

The planner creates candidate adaptations, evaluates each candidate through the
same exposure engine, ranks the candidates by privacy/task trade-off, and
returns a small Pareto-style set for human review.

Request:

```json
{
  "scenario_id": "hong_kong_mong_kok_01",
  "route": [
    { "lon": 114.1694, "lat": 22.3193, "alt": 80, "yaw": 0 },
    { "lon": 114.1712, "lat": 22.3201, "alt": 80, "yaw": 30 }
  ],
  "camera": {
    "hfov_deg": 78,
    "vfov_deg": 50,
    "gimbal_pitch_deg": -45,
    "ray_width": 80,
    "ray_height": 45,
    "min_depth_m": 0,
    "max_depth_m": 180
  },
  "user_preferences": {
    "sensitive_areas": { "type": "FeatureCollection", "features": [] },
    "do_not_capture": { "type": "FeatureCollection", "features": [] }
  },
  "planner_config": {
    "evaluation_ray_width": 32,
    "evaluation_ray_height": 18,
    "max_route_length_increase_percent": 25,
    "min_task_coverage": 0.75
  }
}
```

Response:

```json
{
  "baseline_summary": {},
  "options": [
    {
      "id": "privacy_first",
      "label": "Privacy-first",
      "modified_route": [],
      "modified_camera": {},
      "summary": {},
      "delta": {
        "sensitive_exposure_reduction_percent": 61.2,
        "total_exposure_reduction_percent": 38.4,
        "route_length_increase_percent": 8.5,
        "coverage_loss_percent": 4.0
      },
      "objective_terms": {
        "privacy": 0.31,
        "route_length": 0.08,
        "smoothness": 0.02,
        "altitude": 0.12,
        "gimbal": 0.05,
        "task": 0.96,
        "objective": -12.4
      },
      "explanation": "Suggested alternative evaluated against the marked privacy areas."
    }
  ]
}
```

Current candidate strategies include altitude adjustment, lateral detour,
depth-limited camera, and combined variants. Routes are densified before
candidate adjustment so long segments near preference polygons can respond even
when their endpoints are far away.
