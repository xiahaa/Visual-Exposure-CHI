# MatrixCity Flight Configuration Guide

This guide is for study facilitators who need to test a different UAV path or
camera setup in the MatrixCity 3DGS scene. Participants cannot edit these
values. Formal server-assigned sessions continue to use the locked A/B and C/D
flight geometries.

## Recommended workflow

1. Open `/setup` and choose the event profile and disclosure condition.
2. Under **MatrixCity flight configuration**, select **Custom preview**.
3. Start from the selected profile defaults. Change one group at a time.
4. Set the UAV Start and End positions in MatrixCity ENU metres.
5. Set the camera Look-at Start and Look-at End points.
6. Adjust the camera model only when the study manipulation requires it.
7. Resolve any validation message and open **Preview selected cell**.
8. Scrub the timeline and inspect the external view, camera view, frustum, and
   physical-clarity overlay before using the configuration in a pilot.
9. Export the validated JSON and retain it with the study materials.

The custom configuration is embedded in the facilitator preview URL. Opening
that URL in another browser reproduces the same trajectory and camera model.
An invalid or tampered URL falls back to the profile default and displays a
warning.

## Coordinate system

All positions use the MatrixCity local **ENU** coordinate system:

| Axis | Meaning | Effect in the scene |
| --- | --- | --- |
| `E` | East, metres | Moves right/east across MatrixCity |
| `N` | North, metres | Moves north across MatrixCity |
| `U` | Up, metres | Sets altitude above the local vertical datum |

These are not longitude, latitude, or Three.js coordinates. Do not paste WGS84
coordinates into this form.

## Trajectory limits

The current form uses a two-keyframe trajectory. The UAV moves smoothly from
Start to End during the fixed 24-second clip.

| Parameter | Hard limit | Recommended range | Notes |
| --- | ---: | ---: | --- |
| UAV East | 60-340 m | 70-330 m | Keeps the UAV inside the validated GS flight envelope |
| UAV North | 3560-3840 m | 3570-3830 m | Avoids weak or missing edge reconstruction |
| UAV altitude | 40-180 m | 90-140 m | Matches the aerial MatrixCity capture domain |
| Route length | At least 20 m | 180-370 m | Very short routes produce little visible motion |

The hard limits prevent known blank or low-confidence areas. The recommended
ranges are narrower because the source Gaussian asset is strongest from aerial,
oblique viewpoints near the primary tile.

## Camera orientation

The camera is configured with two world-space look-at points instead of raw yaw
and pitch. The application derives yaw and gimbal pitch at every timeline pose.

| Parameter | Hard limit | Recommended range |
| --- | ---: | ---: |
| Target East | 0-400 m | 80-320 m |
| Target North | 3500-3900 m | 3560-3840 m |
| Target altitude | 0-120 m | 15-80 m |

Common patterns:

- **Track one location:** use the same Look-at Start and Look-at End point.
- **Pan across a facade:** keep target altitude similar and change East or North.
- **Look away from the resident:** choose targets that remain outside the target
  facade while previewing the complete timeline.

The target does not have to lie on the resident or building surface. It is the
camera optical-axis destination. Always verify the result in the camera view.

## Camera model limits

| Parameter | Hard limit | Recommended range | Meaning |
| --- | ---: | ---: | --- |
| Horizontal FOV | 30-100 deg | 55-80 deg | Narrow values magnify a smaller area; wide values cover more context |
| Image width | 640-3840 px | 1280-1920 px | Used to estimate projected pixels per metre |
| Image height | 360-2160 px | 720-1080 px | Defines aspect ratio and vertical FOV |
| Minimum depth | 0.1-25 m | 1-5 m | Surfaces closer than this are excluded |
| Maximum depth | 20-250 m | 80-160 m | Limits frustum length and distant clarity |

Maximum depth must be greater than minimum depth. Keep the same camera model
across experimental cells unless camera capability is an intentional independent
variable.

## JSON format

The setup page can import and export this format:

```json
{
  "version": 1,
  "trajectory": {
    "start_enu_m": [70, 3570, 125],
    "end_enu_m": [330, 3830, 125],
    "camera_target_start_enu_m": [238, 3718.5, 40.62],
    "camera_target_end_enu_m": [238, 3718.5, 40.62]
  },
  "camera": {
    "hfov_deg": 68,
    "image_width_px": 1920,
    "image_height_px": 1080,
    "min_depth_m": 2,
    "max_depth_m": 130
  }
}
```

## What the configuration controls

One validated configuration drives all of the following:

- UAV position on the timeline.
- UAV heading and derived gimbal pitch.
- Synthetic UAV camera view.
- Dynamic camera frustum.
- Physical-clarity overlay based on distance, projected pixel density,
  incidence angle, field of view, and depth limits.

The clarity overlay is **not a privacy score**. It currently evaluates explicit
proxy facade cells and does not infer semantic privacy from Gaussian splats.
Open3D remains the authoritative evaluator for the main visual-exposure engine.

## Pilot checks

Before approving a custom configuration:

- Play the entire 24-second timeline, not only the midpoint.
- Confirm all UAV poses remain inside rendered GS coverage.
- Confirm the camera never points into a blank or severely blurred region.
- Confirm frustum direction matches the camera view.
- Confirm the intended target enters or leaves the effective view at the planned
  time.
- Export and archive the JSON with the scenario, condition, and pilot notes.
