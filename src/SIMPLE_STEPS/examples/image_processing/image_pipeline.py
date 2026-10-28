"""
image_pipeline.py — the image processing example's workflow, written in Python.

The twin of ``workspace/projects/image_processing/images.simple-steps-workflow``:
one Python line per saved step. ``runme.py`` runs both and checks every step's
output is the same.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod, op, res, zip_

from SIMPLE_STEPS.catalog import catalog

from image_tools import (ImageDirectory, average_color, film_strip, image_width, invert,
                         is_dark, mean_brightness, thumbnail, to_grayscale)

identity = op("identity")  # core's built-in tool, by name


def build_images() -> Kernel:
    """``images``: list a folder's images, load them, measure them, change
    them, and put their thumbnails in one strip."""
    wf = Kernel(catalog())
    wf.define("image_directory", ImageDirectory, path="sample_images")

    # the resource: one row per file, then each file's image
    wf["files"] = res["image_directory"].files[mod.source()]()
    wf["images"] = res["image_directory"].load[mod.map(), mod.name("image")](wf["files"])

    # measuring: a number, a colour, a filter
    wf["widths"] = image_width[mod.map(), mod.name("width")](wf["images"])
    wf["brightness"] = mean_brightness[mod.map(), mod.name("brightness")](wf["images"])
    wf["colors"] = average_color[mod.map(), mod.name("color")](wf["images"])
    # a map step is only its results; zip_ puts each file's name beside them
    wf["named"] = zip_(wf["files"], wf["images"])
    wf["dark"] = is_dark[mod.filter()](wf["named"], threshold=80)
    wf["bright_by_file"] = zip_(wf["files"], wf["brightness"])
    wf["brightest"] = identity[mod.sort(by="brightness", ascending=False)](wf["bright_by_file"])

    # changing: each a new image column
    wf["grey"] = to_grayscale[mod.map(), mod.name("grey")](wf["images"])
    wf["negatives"] = invert[mod.map(), mod.name("negative")](wf["images"])
    wf["thumbs"] = thumbnail[mod.map(), mod.name("thumb")](wf["images"], size=32)

    # all thumbnails in one image
    wf["strip"] = film_strip[mod.collapse()](wf["thumbs"])
    return wf


def live_resources() -> dict:
    """The objects the twin runs with."""
    return {"image_directory": ImageDirectory(path="sample_images")}
