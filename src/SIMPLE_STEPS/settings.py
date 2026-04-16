"""
Simple Steps — Runtime Settings
================================
Controls runtime behavior flags. These are in-memory settings that can be
toggled via the API at runtime.

⚠️  EVAL_MODE is dangerous — it allows arbitrary Python code execution
    from the formula bar. Only enable in trusted development environments.
"""

from pydantic import BaseModel
from typing import Dict, Any


class SimpleStepsSettings(BaseModel):
    """Runtime settings for the Simple Steps engine."""

    # ── Eval Mode ────────────────────────────────────────────────────────
    # When True, formulas starting with =!  are executed as raw Python via
    # exec/eval. The code has access to:
    #   - df_in   : the input DataFrame (from the previous step)
    #   - pd      : pandas
    #   - np      : numpy
    #   - step_map: resolved references dict
    #   - Any imported module the user chooses
    #
    # This is essentially Python's eval() — treat it with the same caution.
    eval_mode: bool = False

    class Config:
        # Allow mutation so we can toggle at runtime
        # (Pydantic v2 uses model_config but this works for both)
        pass


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
