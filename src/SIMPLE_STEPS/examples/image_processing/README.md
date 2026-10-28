# Image processing — a folder of images as a resource

A folder of images is a **resource**: not data itself, but something tools
read data from. The workflow declares one, named `image_directory`, and every
image comes through it.

```bash
pip install "simple-steps[media]"                  # Pillow, to read image files
simple-steps run examples/image_processing/app.py  # open "images" and press Run All
python examples/image_processing/runme.py          # run it and check every step
```

Without Pillow the app still starts; the workflow's `images` step says how to
install it, and `runme.py` skips the workflow. The processing itself is plain
numpy.

## The resource

[`image_tools.py`](image_tools.py) declares `ImageDirectory`, a folder of
images with one setting, `path` (relative paths are read from this folder, so
the default `sample_images` is the five images shipped here). The workflow's
`resources` section creates one:

```json
"resources": {
  "image_directory": {"source": "defined", "type": "ImageDirectory",
                      "settings": {"path": "sample_images"}}
}
```

In the UI, that's **Resources** in the toolbar → **+ New resource**, type
`ImageDirectory`, named `image_directory`.
Point `path` at any folder of `.png`/`.jpg` files to process your own.

It has two tools of its own, written `res["image_directory"].<tool>`:

| tool | formula | gives |
|---|---|---|
| `files` | `res["image_directory"].files[mod.source()]()` | one row per image: `file` |
| `load` | `res["image_directory"].load[mod.map(), mod.name("image")](wf["files"])` | each file's image, as an array |

## The workflow

[`images`](workspace/projects/image_processing/images.simple-steps-workflow),
and its Python twin `build_images()` in [`image_pipeline.py`](image_pipeline.py):

| step | formula | what it shows |
|---|---|---|
| `files` | `res["image_directory"].files[mod.source()]()` | a resource's tool as a source |
| `images` | `res["image_directory"].load[mod.map(), mod.name("image")](wf["files"])` | a cell that holds an image |
| `widths` | `image_width[mod.map(), mod.name("width")](wf["images"])` | a number from an image |
| `brightness` | `mean_brightness[mod.map(), mod.name("brightness")](wf["images"])` | 0 (black) to 255 (white) |
| `colors` | `average_color[mod.map(), mod.name("color")](wf["images"])` | a hex colour, `#d75564` |
| `dark` | `is_dark[mod.filter()](wf["images"], threshold=80)` | keeps forest and night |
| `brightest` | `identity[mod.sort(by="brightness", ascending=False)](wf["brightness"])` | sunset first |
| `grey` | `to_grayscale[mod.map(), mod.name("grey")](wf["images"])` | an image from an image |
| `negatives` | `invert[mod.map(), mod.name("negative")](wf["images"])` | |
| `thumbs` | `thumbnail[mod.map(), mod.name("thumb")](wf["images"], size=32)` | |
| `strip` | `film_strip[mod.collapse()](wf["thumbs"])` | every thumbnail in one image: a reducer |

A tool reads an image by parameter name, like any column: `mean_brightness(image)`
reads the `image` column; `film_strip(acc, thumb)` reads `thumb`.

## Try

- `is_dark`'s `threshold=30` keeps only night.
- `thumbnail`'s `size=8`, then look at `strip`.
- Add your own image to `sample_images/` and press **Run All**: every step
  picks it up, and `runme.py` fails, because its expected values are for
  the five shipped images.
