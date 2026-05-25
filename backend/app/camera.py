import math

import numpy as np

from .models import CameraConfig
from .trajectory import Pose


def generate_camera_rays(pose: Pose, camera: CameraConfig) -> np.ndarray:
    eye = pose.eye
    forward, right, up = _camera_basis(pose.yaw, camera.gimbal_pitch_deg)

    xs = _sample_axis(camera.ray_width, math.tan(math.radians(camera.hfov_deg) / 2.0))
    ys = _sample_axis(camera.ray_height, math.tan(math.radians(camera.vfov_deg) / 2.0))

    rays = np.zeros((camera.ray_width * camera.ray_height, 6), dtype=np.float32)
    cursor = 0
    for y in ys:
        for x in xs:
            direction = forward + x * right + y * up
            direction = direction / np.linalg.norm(direction)
            rays[cursor, :3] = eye
            rays[cursor, 3:] = direction
            cursor += 1
    return rays


def _camera_basis(yaw_deg: float, pitch_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)

    horizontal_forward = np.array([math.sin(yaw), math.cos(yaw), 0.0], dtype=np.float32)
    forward = math.cos(pitch) * horizontal_forward + np.array(
        [0.0, 0.0, math.sin(pitch)], dtype=np.float32
    )
    forward = forward / np.linalg.norm(forward)

    right = np.array([math.cos(yaw), -math.sin(yaw), 0.0], dtype=np.float32)
    right = right / np.linalg.norm(right)

    up = np.cross(right, forward)
    up = up / np.linalg.norm(up)
    return forward, right, up


def _sample_axis(count: int, half_extent: float) -> np.ndarray:
    if count == 1:
        return np.array([0.0], dtype=np.float32)
    return np.linspace(-half_extent, half_extent, count, dtype=np.float32)

