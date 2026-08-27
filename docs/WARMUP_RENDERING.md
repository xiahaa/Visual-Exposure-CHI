# Warm-Up Rendering

The `/warmup` experience uses a synchronized geometry-based renderer rather
than cropping a prerecorded image.

## Current Mesh Renderer

- Loads 1,405 real Hong Kong OSM building footprints from the Mong Kok scenario.
- Selects nearby buildings and extrudes them using the scenario height estimates.
- Uses one deterministic trajectory to drive the UAV model and camera pose.
- Renders a resident camera and UAV camera against the same geometry.
- Builds the visible camera frustum from the gimbal mount using the configured
  horizontal FOV, 16:9 sensor aspect, and maximum visual depth.
- Uses the same camera target, FOV, depth, and mesh occlusion for the resident
  frustum overlay and UAV live view.
- Adds deterministic facade variation, windows, rooftop equipment, streets,
  trees, daylight, shadows, and atmospheric perspective for legibility.
- Adds procedural facade windows only as an appearance cue. They are not treated
  as detected real windows or used by the exposure engine.

The warm-up exposure curve remains a controlled study stimulus. It is designed
to demonstrate that audible proximity and visual exposure can peak at different
times; it is not presented as observed real-world footage.

This is an L2 geometry-consistent mesh stimulus, not a photorealistic digital
twin. Its purpose is to keep route, camera pose, occlusion, and study timing
auditable while avoiding the use of private real-world imagery.

## Future 3DGS Renderer

A city-scale Gaussian Splatting asset can later replace the mesh appearance
layer while preserving the same trajectory and camera timeline. Final exposure
metrics should continue to be evaluated by Open3D or another explicit geometry
engine, because a splat renderer alone does not provide the same auditable
first-hit surface mapping.
