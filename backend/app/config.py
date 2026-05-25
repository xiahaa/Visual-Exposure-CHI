from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "backend.yaml"


class ExposureEngineConfig(BaseModel):
    """Tunable parameters for the geometric visibility engine."""

    # Maximum ray distance included in exposure aggregation. This prevents
    # far-away incidental hits from becoming privacy-relevant.
    max_range_m: float = Field(gt=0)
    # Distance at which recognizability weight reaches 1.0. Beyond this
    # distance the contribution decays as d0 / distance.
    recognizability_d0_m: float = Field(gt=0)
    # Spacing between sampled camera poses along the route.
    route_sample_step_m: float = Field(gt=0)


class BackendConfig(BaseModel):
    """Root backend configuration loaded from YAML."""

    exposure: ExposureEngineConfig


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
