from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, model_validator


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "backend.yaml"


class ExposureEngineConfig(BaseModel):
    """Tunable parameters for the geometric visibility engine."""

    # Minimum ray distance included in exposure aggregation. This supports
    # preset-level near clipping while keeping legacy requests unchanged.
    min_range_m: float = Field(default=0.0, ge=0)
    # Maximum ray distance included in exposure aggregation. This prevents
    # far-away incidental hits from becoming privacy-relevant.
    max_range_m: float = Field(gt=0)
    # Distance at which recognizability weight reaches 1.0. Beyond this
    # distance the contribution decays as d0 / distance.
    recognizability_d0_m: float = Field(gt=0)
    # Spacing between sampled camera poses along the route.
    route_sample_step_m: float = Field(gt=0)
    # Reference camera sample count used to normalize exposure magnitude. Ray
    # grids may then change numerical fidelity without changing the score scale.
    reference_rays_per_pose: int = Field(default=3600, gt=0)


class StudyServiceConfig(BaseModel):
    """Persistent study-runner settings controlled by YAML."""

    # Relative paths resolve from the backend directory. The SQLite database
    # runs in WAL mode so reads and event ingestion can proceed concurrently.
    database_path: str
    completion_code_prefix: str = Field(min_length=1, max_length=12)
    completion_code_length: int = Field(default=8, ge=6, le=20)
    admin_key_env: str = Field(default="VEP_ADMIN_KEY", min_length=1)
    event_batch_limit: int = Field(default=100, ge=1, le=1000)
    question_config_version: str = Field(default="draft", min_length=1)
    required_completion_events: list[str] = Field(default_factory=list)
    # Explicit per-cell capacities allow researchers to close or rebalance an
    # individual condition without changing application code.
    cell_capacities: dict[str, dict[str, int]]

    @model_validator(mode="after")
    def validate_cells(self) -> "StudyServiceConfig":
        expected_profiles = {"A", "B", "C", "D"}
        expected_conditions = {"M", "S", "V"}
        if set(self.cell_capacities) != expected_profiles:
            raise ValueError("Study cell capacities must define profiles A, B, C, and D")
        for profile, conditions in self.cell_capacities.items():
            if set(conditions) != expected_conditions:
                raise ValueError(f"Profile {profile} must define M, S, and V capacities")
            if any(capacity < 0 for capacity in conditions.values()):
                raise ValueError("Study cell capacities cannot be negative")
        return self


class BackendConfig(BaseModel):
    """Root backend configuration loaded from YAML."""

    exposure: ExposureEngineConfig
    camera_profiles: dict
    study: StudyServiceConfig


@lru_cache(maxsize=1)
def load_backend_config(path: str | None = None) -> BackendConfig:
    """Load and validate backend YAML config.

    The result is cached so requests do not re-read the file on every exposure
    computation. Restart the dev server after changing YAML values.
    """

    config_path = Path(path) if path else DEFAULT_CONFIG_PATH
    with config_path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    return BackendConfig.model_validate(data)
