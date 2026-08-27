# Warm-Up Rendering

The `/warmup` experience uses the same MatrixCity 3D Gaussian Splatting
appearance layer as the main event-study disclosure. It no longer uses the
separate Hong Kong OSM procedural renderer.

## Current MatrixCity 3DGS renderer

- Loads the browser-ready MatrixCity tile manifest configured by
  `VITE_MATRIXCITY_GS_MANIFEST_URL`.
- Uses the same Spark/Three.js renderer, coordinate transform, UAV model, and
  camera implementation as the main event-study scene.
- Uses a dedicated, locked `warmup_calibration` trajectory from
  `frontend/src/matrixCityStudyScene.json`.
- Renders the runner-matched aerial-oblique context view and UAV-camera view
  from the same time-indexed UAV pose and camera look-at target.
- Pans the camera from an offset direction toward and then across the target
  facade so camera orientation remains meaningful during calibration.
- Keeps all UAV poses within the validated MatrixCity GS aerial envelope.

The warm-up does not expose facilitator controls. Participants cannot change
the trajectory, camera, language, or study condition.

## Controlled stimulus

The 36-second audibility and exposure curves remain controlled study stimuli.
The exposure curve peaks at 25.5 seconds and is synchronized with the camera
sweep, but it is not recomputed from Gaussian opacity and is not an observed
real-world measurement.

The high aerial-oblique context camera deliberately matches the runner view and
stays close to MatrixCity's training-view distribution. It avoids the blurred,
low-altitude resident camera that is unsuitable for this GS asset.

The purpose of the warm-up is to teach one distinction before the main task:
audible proximity does not by itself determine what a camera can capture.
Camera orientation, distance, occlusion, and image detail also matter.

MatrixCity is synthetic public research data. No real residents or private
imagery are used. Open3D remains the authoritative evaluator for the main
visual-exposure engine because the GS renderer does not provide auditable
semantic first-hit surface mapping on its own.

## Deployment

The warm-up reads the same asset environment variable as the event runner:

```text
VITE_MATRIXCITY_GS_MANIFEST_URL=https://<asset-host>/vep/matrixcity/v2/matrixcity-neighborhood-study-v2.json
```

The primary tile loads for each view. Browser caching prevents duplicate network
transfer of the same immutable SPZ object, although each WebGL view maintains
its own GPU representation.
