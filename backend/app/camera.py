import math

import numpy as np

from .models import CameraConfig
from .trajectory import Pose


def generate_camera_rays(pose: Pose, camera: CameraConfig) -> np.ndarray:
    """Generate Open3D-compatible rays for one sampled drone pose.

    Open3D expects each ray as `[ox, oy, oz, dx, dy, dz]`, where the origin is
    the camera position and the direction is a normalized 3D vector. The ray
    grid is a low-resolution proxy for a real camera sensor.
    """

    eye = pose.eye
    forward, right, up = _camera_basis(pose.yaw, camera.gimbal_pitch_deg)

    # Convert angular field-of-view into normalized image-plane extents. A ray
    # through each grid sample approximates the camera frustum.
    xs = _sample_axis(camera.ray_width, math.tan(math.radians(camera.hfov_deg) / 2.0))
    ys = _sample_axis(camera.ray_height, math.tan(math.radians(camera.vfov_deg) / 2.0))

    rays = np.zeros((camera.ray_width * camera.ray_height, 6), dtype=np.float32)
    cursor = 0
    for y in ys:
        for x in xs:
            # Start from the optical axis, then offset horizontally and
            # vertically across the image plane before normalizing.
            direction = forward + x * right + y * up
            direction = direction / np.linalg.norm(direction)
            rays[cursor, :3] = eye
            rays[cursor, 3:] = direction
            cursor += 1
    return rays


def _camera_basis(yaw_deg: float, pitch_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return camera forward/right/up vectors in ENU coordinates.

    Convention:
    - yaw is degrees clockwise from north: 0 = north, 90 = east.
    - pitch is degrees around the lateral axis: negative values look downward.
    - roll is intentionally omitted for the MVP because route notice scenarios
      can be explained with yaw plus gimbal pitch.
    """

    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)

    # ENU axes are x=east, y=north, z=up. This makes yaw=0 point along +y.
    horizontal_forward = np.array([math.sin(yaw), math.cos(yaw), 0.0], dtype=np.float32)
    forward = math.cos(pitch) * horizontal_forward + np.array(
        [0.0, 0.0, math.sin(pitch)], dtype=np.float32
    )
    forward = forward / np.linalg.norm(forward)

    # Right is kept horizontal so camera pitch tilts the optical axis without
    # introducing roll.
    right = np.array([math.cos(yaw), -math.sin(yaw), 0.0], dtype=np.float32)
    right = right / np.linalg.norm(right)

    # Complete an orthonormal camera basis. This "up" is camera-up, not world-up.
    up = np.cross(right, forward)
    up = up / np.linalg.norm(up)
    return forward, right, up


def _sample_axis(count: int, half_extent: float) -> np.ndarray:
    """Return evenly spaced image-plane samples for one camera axis."""

    if count == 1:
        return np.array([0.0], dtype=np.float32)
    return np.linspace(-half_extent, half_extent, count, dtype=np.float32)
