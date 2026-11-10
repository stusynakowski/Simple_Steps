"""
Simple Steps — Runtime Settings
================================
Controls runtime behavior flags. These are in-memory settings that can be
toggled via the API at runtime (System Settings in the UI). An ``App`` sets
their starting values: its defaults (``App(step_palette=…)``).
"""

import re
from typing import Any, Dict, List, Literal, Union

from pydantic import BaseModel, field_validator


# ── Step colours ────────────────────────────────────────────────────────────
# A palette colours the steps that have no colour of their own (owner,
# 2026-11-10). Two kinds:
#   - a list of colours, used in turn: step 1 the first, step 2 the second, …
#     and round again;
#   - {"gradient": [first, …, last]}: blended along the workflow, its first
#     step the first colour, its last step the last.
# Colours are #rrggbb. The header's text is white, so mid-to-dark colours read
# best.

Palette = Union[List[str], Dict[str, List[str]]]

#: The palettes every app offers; an App adds its own (``step_palettes=``).
BUILTIN_PALETTES: Dict[str, Palette] = {
    # Vaporwave (the default; owner, 2026-11-10): magenta, cyan-teal, violet,
    # pink, in two depths. Kept 30°+ of hue from the run's colours (blue,
    # green, amber, red: index.css) so a step's colour never reads as its
    # status; dark enough for the header's white text.
    "vaporwave": ["#c2187a", "#10939e", "#8a3fcf", "#d6589a", "#0b6e7a", "#5b2a9e"],
    "muted": ["#4f6d8f", "#5f8a76", "#a0784a", "#7a6293", "#9a5a63", "#4f8790", "#86844f", "#66707f"],
    "ocean": {"gradient": ["#1f3b63", "#2f7f8c", "#3e9e86"]},
    "sunset": {"gradient": ["#5a2d82", "#b0456a", "#d9773a"]},
    "forest": {"gradient": ["#24483a", "#4f7a43", "#8a9a3e"]},
    "slate": {"gradient": ["#33415c", "#5c6f8f"]},
    "classic": ["#FF5733", "#33A1FF", "#33FF57", "#FF33F6", "#FFC300", "#8E44AD", "#1ABC9C", "#E67E22"],
}

#: The palette a new app starts with.
DEFAULT_PALETTE = "vaporwave"

_palettes: Dict[str, Palette] = dict(BUILTIN_PALETTES)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def check_palette(name: str, palette: Any) -> Palette:
    """*palette* as stored, or ValueError saying what's wrong with it."""
    colors = palette.get("gradient") if isinstance(palette, dict) else palette
    if isinstance(palette, dict) and set(palette) != {"gradient"}:
        raise ValueError(f"step palette {name!r}: a dict palette is {{'gradient': [colours]}}")
    if not isinstance(colors, (list, tuple)) or not colors:
        raise ValueError(f"step palette {name!r}: give a list of colours, or {{'gradient': [colours]}}")
    if isinstance(palette, dict) and len(colors) < 2:
        raise ValueError(f"step palette {name!r}: a gradient needs at least two colours")
    bad = [c for c in colors if not (isinstance(c, str) and _HEX.match(c))]
    if bad:
        raise ValueError(f"step palette {name!r}: {bad[0]!r} is not a colour like '#4f6d8f'")
    return {"gradient": list(colors)} if isinstance(palette, dict) else list(colors)


def add_palettes(palettes: Dict[str, Any]) -> None:
    """Offer *palettes* beside the built-in ones (an App's ``step_palettes=``)."""
    checked = {name: check_palette(name, p) for name, p in palettes.items()}
    _palettes.update(checked)


def palettes() -> Dict[str, Palette]:
    """Every palette on offer, by name: the built-ins, then the app's own."""
    return dict(_palettes)


class SimpleStepsSettings(BaseModel):
    """Runtime settings for the Simple Steps engine."""

    # Controls where step outputs are persisted by default:
    # - memory: in-process RAM only
    # - parquet: RAM + parquet files under SIMPLE_STEPS_RESULT_CACHE_DIR
    result_store: Literal['memory', 'parquet'] = 'memory'

    # The palette that colours the steps (a name in palettes()).
    step_palette: str = DEFAULT_PALETTE

    @field_validator("step_palette")
    @classmethod
    def _known_palette(cls, name: str) -> str:
        if name not in _palettes:
            raise ValueError(f"no step palette {name!r}. Known: {', '.join(_palettes)}")
        return name

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


def settings_payload() -> Dict[str, Any]:
    """The settings as the API serves them, with the palettes on offer."""
    return {**get_settings().model_dump(), "step_palettes": palettes()}
