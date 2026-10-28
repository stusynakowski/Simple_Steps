"""
Simple Steps — Runtime Settings
================================
Controls runtime behavior flags. These are in-memory settings that can be
toggled via the API at runtime.
"""

from pydantic import BaseModel
from typing import Dict, Any, Literal


class SimpleStepsSettings(BaseModel):
    """Runtime settings for the Simple Steps engine."""

    # Controls where step outputs are persisted by default:
    # - memory: in-process RAM only
    # - parquet: RAM + parquet files under SIMPLE_STEPS_RESULT_CACHE_DIR
    result_store: Literal['memory', 'parquet'] = 'memory'

    class Config:
        # Allow mutation so we can toggle at runtime
        # (Pydantic v2 uses model_config but this works for both)
        validate_assignment = True


# Singleton instance — import this from anywhere
_settings = SimpleStepsSettings()


def get_settings() -> SimpleStepsSettings:
    return _settings


def update_settings(**kwargs: Any) -> SimpleStepsSettings:
    """Update settings in place. Returns the updated settings."""
    global _settings
    for k, v in kwargs.items():
        if hasattr(_settings, k):
            setattr(_settings, k, v)
        else:
            raise ValueError(f"Unknown setting: {k}")
    return _settings
