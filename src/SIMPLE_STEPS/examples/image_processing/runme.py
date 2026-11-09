"""
runme.py — run the image processing example's workflow and check every step.

    python examples/image_processing/runme.py

``images`` runs through the app, then is compared step by step with its Python
twin (``image_pipeline.py``) run straight in simple-steps-core, and checked
against what the five sample images are known to hold. It needs Pillow to read
the files; without it the workflow is skipped and says how to install it.
Exits non-zero if any step doesn't match.
"""

import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import image_pipeline as pipeline  # noqa: E402
from image_tools import pillow_missing  # noqa: E402

FILES = ["checkerboard.png", "forest.png", "night.png", "ocean.png", "sunset.png"]


def images(column, shape):
    """Every row of *column* is an RGB image of *shape*."""
    def check(data, metrics):
        found = [getattr(v, "shape", None) for v in data[column]]
        return all(s == shape for s in found) or f"{column} shapes: {found}"
    return check


example.check("image_processing", "images", twin=pipeline.build_images,
              live=pipeline.live_resources, skip=pillow_missing, expect={
    "files": {"file": FILES},
    "images": images("image", (96, 96, 3)),
    "widths": {"width": [96] * 5},
    "brightness": {"brightness": [127.5, 48.0, 16.6, 116.2, 132.9]},
    "colors": {"color": ["#808080", "#1a571e", "#090b1f", "#147dcd", "#d75564"]},
    "dark": {"file": ["forest.png", "night.png"]},
    "brightest": {"file": ["sunset.png", "checkerboard.png", "ocean.png", "forest.png", "night.png"]},
    "grey": lambda data, metrics: all((v[..., 0] == v[..., 1]).all() for v in data["grey"])
            or "a grey image has colour in it",
    "thumbs": images("thumb", (32, 32, 3)),
    # five 32×32 thumbnails side by side
    "strip": images("strip", (32, 160, 3)),
})

sys.exit(example.finish())
