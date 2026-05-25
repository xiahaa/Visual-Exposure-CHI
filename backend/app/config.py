from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "backend.yaml"


class ExposureEngineConfig(BaseModel):
    max_range_m: float = Field(gt=0)
    recognizability_d0_m: float = Field(gt=0)
    route_sample_step_m: float = Field(gt=0)


class BackendConfig(BaseModel):
    exposure: ExposureEngineConfig


@lru_cache(maxsize=1)
def load_backend_config(path: str | None = None) -> BackendConfig:
    config_path = Path(path) if path else DEFAULT_CONFIG_PATH
    with config_path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    return BackendConfig.model_validate(data)

