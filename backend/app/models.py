from pydantic import BaseModel, Field


class RoutePoint(BaseModel):
    """One planned drone waypoint in frontend WGS84 coordinates."""

    lon: float
    lat: float
    alt: float
    # Degrees clockwise from north. This matches the ENU camera convention used
    # by `camera.generate_camera_rays`.
    yaw: float = 0.0


class CameraConfig(BaseModel):
    """Camera and ray-grid settings supplied by the frontend."""

    hfov_deg: float = 78.0
    vfov_deg: float = 50.0
    # Negative pitch points the gimbal downward toward the ground/buildings.
    gimbal_pitch_deg: float = -45.0
    # Ray grid dimensions intentionally cap fidelity for interactive response
    # times. Higher values mean better approximation but more Open3D queries.
    ray_width: int = Field(default=80, ge=1, le=640)
    ray_height: int = Field(default=45, ge=1, le=360)


class UserPreferences(BaseModel):
    """Spatial preferences drawn or selected by the user."""

    # GeoJSON polygons that should be treated as strongest sensitivity.
    do_not_capture: dict | None = None
    # GeoJSON polygons that raise sensitivity but do not necessarily prohibit
    # visibility in the prototype.
    sensitive_areas: dict | None = None
    # Kept for the CHI interaction contract; future planner/operator modules can
    # interpret conditions such as min altitude or no-hover.
    acceptable_conditions: list[dict] = Field(default_factory=list)


class ExposureRequest(BaseModel):
    """Request body for `/api/exposure/compute`."""

    scenario_id: str
    route: list[RoutePoint]
    camera: CameraConfig
    user_preferences: UserPreferences = Field(default_factory=UserPreferences)


class CompareRequest(BaseModel):
    """Request body for `/api/exposure/compare`."""

    scenario_id: str
    before: ExposureRequest
    after: ExposureRequest
