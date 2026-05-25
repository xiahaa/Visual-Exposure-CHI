from pydantic import BaseModel, Field


class RoutePoint(BaseModel):
    lon: float
    lat: float
    alt: float
    yaw: float = 0.0


class CameraConfig(BaseModel):
    hfov_deg: float = 78.0
    vfov_deg: float = 50.0
    gimbal_pitch_deg: float = -45.0
    ray_width: int = Field(default=80, ge=1, le=640)
    ray_height: int = Field(default=45, ge=1, le=360)


class UserPreferences(BaseModel):
    do_not_capture: dict | None = None
    sensitive_areas: dict | None = None
    acceptable_conditions: list[dict] = Field(default_factory=list)


class ExposureRequest(BaseModel):
    scenario_id: str
    route: list[RoutePoint]
    camera: CameraConfig
    user_preferences: UserPreferences = Field(default_factory=UserPreferences)


class CompareRequest(BaseModel):
    scenario_id: str
    before: ExposureRequest
    after: ExposureRequest

