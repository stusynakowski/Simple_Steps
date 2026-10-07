"""
cell_types.py — what a cell holds, and how the grid shows it.

A cell holds a Python value. Text and numbers are shown as they are; anything
richer — an image, a Plotly figure, a table, a dict — gets a **cell type**
(``docs/dev_plan/122-skeleton-complete.md`` §4) with three parts:

- **summary**: a short line for the grid cell, and what the agent reads
  (``"64×64 RGB image"``, ``"bar chart · 1 trace"``, ``"table 40×3"``);
- **preview**: optional, small inline data shown in the cell itself (an
  image thumbnail as a ``data:`` URL);
- **view**: the full payload a viewer opens when the cell is clicked, fetched
  separately (``GET /api/cell/…``) so a column of images never loads every
  full image.

Display never goes back into data: a later step reads the real object from the
step's stored output, not its summary or thumbnail.

The view payload is one of the kinds the frontend renders:

==========  ==============================================  =================
kind        fields                                          for
==========  ==============================================  =================
``image``   ``src`` (``data:`` URL), ``width``, ``height``  PIL images, uint8 arrays
``plotly``  ``figure`` (Plotly's JSON)                      Plotly figures
``table``   ``columns``, ``rows``, ``total``                a DataFrame in a cell
``json``    ``value``                                       dicts, lists, arrays
``text``    ``text``                                        anything else (``repr``)
==========  ==============================================  =================

A developer adds a type with :func:`register_cell_type`; its ``view`` returns
one of these kinds. Pillow and Plotly are optional (the ``media`` extra): a
type is only recognized by its module name, so neither is imported here, and
numpy image arrays are encoded to PNG with the standard library.
"""

from __future__ import annotations

import base64
import dataclasses
import datetime as _dt
import decimal
import io
import json
import math
import struct
import zlib
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import pandas as pd

#: Largest side of an inline thumbnail, in pixels.
THUMBNAIL = 48
#: Short collections are shown in full in the cell; longer ones as a count.
SHORT = 60
#: Rows of a table-in-a-cell sent to its viewer.
TABLE_ROWS = 200


@dataclass
class CellType:
    """How one kind of value is summarized, previewed and viewed."""
    name: str
    matches: Callable[[Any], bool]
    summary: Callable[[Any], str]
    view: Callable[[Any], Dict[str, Any]]
    preview: Optional[Callable[[Any], Optional[str]]] = None
    #: Whether the cell keeps a JSON ``value`` (dicts and lists do, so steps
    #: and checks can still read it); rich objects send only their summary.
    keeps_value: bool = False


_TYPES: List[CellType] = []


def register_cell_type(cell_type: CellType, *, first: bool = True) -> CellType:
    """Add a cell type. ``first`` puts it ahead of the built-ins, so a
    developer's type wins over, say, the generic ``json`` or ``text`` view."""
    _TYPES[:] = [t for t in _TYPES if t.name != cell_type.name]
    if first:
        _TYPES.insert(0, cell_type)
    else:
        _TYPES.append(cell_type)
    return cell_type


# ─────────────────────────────────────────────────────────────────────────────
# Plain values: shown exactly as before
# ─────────────────────────────────────────────────────────────────────────────

_PLAIN = (str, bool, int, float, np.generic, _dt.date, _dt.time, _dt.timedelta,
          decimal.Decimal, pd.Timestamp, pd.Timedelta)


def is_plain(value: Any) -> bool:
    """Text, numbers, dates, ``None`` and missing values need no cell type."""
    return value is None or isinstance(value, _PLAIN) or value is pd.NaT


def _is_missing(value: Any) -> bool:
    try:
        return bool(pd.isna(value)) if is_plain(value) else False
    except (TypeError, ValueError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Images
# ─────────────────────────────────────────────────────────────────────────────

def _is_image_array(value: Any) -> bool:
    """A uint8 array shaped like an image: H×W (grey), H×W×3 (RGB), H×W×4 (RGBA)."""
    if not isinstance(value, np.ndarray) or value.dtype != np.uint8:
        return False
    if value.ndim == 2:
        return min(value.shape) >= 8      # a tiny 2-D byte array is data, not a picture
    return value.ndim == 3 and value.shape[2] in (3, 4) and min(value.shape[:2]) >= 1


def _is_pil_image(value: Any) -> bool:
    return (type(value).__module__.startswith("PIL.")
            and hasattr(value, "size") and hasattr(value, "save"))


def _png_from_array(array: np.ndarray) -> bytes:
    """Encode a uint8 image array as PNG with the standard library."""
    a = np.ascontiguousarray(array)
    if a.ndim == 2:
        color = 0
    elif a.shape[2] == 3:
        color = 2
    else:
        color = 6
    height, width = a.shape[:2]
    raw = b"".join(b"\x00" + a[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))


def _png_from_pil(image: Any, max_side: Optional[int] = None) -> bytes:
    img = image
    if img.mode not in ("RGB", "RGBA", "L", "LA", "P"):
        img = img.convert("RGBA")
    if max_side is not None:
        img = img.copy()
        img.thumbnail((max_side, max_side))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _image_size(value: Any) -> tuple:
    if isinstance(value, np.ndarray):
        return int(value.shape[1]), int(value.shape[0])
    return tuple(int(v) for v in value.size)


def _image_summary(value: Any) -> str:
    width, height = _image_size(value)
    if isinstance(value, np.ndarray):
        mode = {2: "grey"}.get(value.ndim) or ("RGB" if value.shape[2] == 3 else "RGBA")
        return f"{width}×{height} {mode} image"
    fmt = f" {value.format}" if getattr(value, "format", None) else ""
    return f"{width}×{height}{fmt} {value.mode} image"


def _image_png(value: Any, max_side: Optional[int] = None) -> bytes:
    if isinstance(value, np.ndarray):
        array = value
        if max_side is not None:
            step = max(1, math.ceil(max(array.shape[:2]) / max_side))
            array = array[::step, ::step]
        return _png_from_array(array)
    return _png_from_pil(value, max_side)


def _image_view(value: Any) -> Dict[str, Any]:
    width, height = _image_size(value)
    return {"kind": "image", "src": _data_url(_image_png(value)),
            "width": width, "height": height}


# ─────────────────────────────────────────────────────────────────────────────
# Plotly figures
# ─────────────────────────────────────────────────────────────────────────────

def _is_plotly(value: Any) -> bool:
    return (type(value).__module__.startswith("plotly.")
            and hasattr(value, "to_json") and hasattr(value, "data"))


def _plotly_summary(value: Any) -> str:
    kinds = sorted({getattr(trace, "type", None) or "trace" for trace in value.data})
    n = len(value.data)
    title = getattr(getattr(value.layout, "title", None), "text", None)
    what = f"{' + '.join(kinds)} chart" if kinds else "empty chart"
    return f"{what} · {n} trace{'' if n == 1 else 's'}" + (f" · {title}" if title else "")


def _plotly_view(value: Any) -> Dict[str, Any]:
    return {"kind": "plotly", "figure": json.loads(value.to_json())}


# ─────────────────────────────────────────────────────────────────────────────
# Tables, JSON-like values, anything else
# ─────────────────────────────────────────────────────────────────────────────

def jsonable(value: Any, _depth: int = 0) -> Any:
    """A JSON-safe copy of *value* (dicts, lists, numbers, text, None)."""
    if _depth > 20:
        return str(value)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, np.generic):
        return jsonable(value.item(), _depth + 1)
    if isinstance(value, dict):
        return {str(k): jsonable(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [jsonable(v, _depth + 1) for v in value]
    if isinstance(value, np.ndarray):
        return jsonable(value.tolist(), _depth + 1)
    if isinstance(value, pd.DataFrame):
        return jsonable(value.to_dict("records"), _depth + 1)
    if hasattr(value, "model_dump"):
        return jsonable(value.model_dump(), _depth + 1)
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return jsonable(dataclasses.asdict(value), _depth + 1)
    return str(value)


def _is_json_like(value: Any) -> bool:
    return (isinstance(value, (dict, list, tuple, set, frozenset, np.ndarray))
            or hasattr(value, "model_dump")
            or (dataclasses.is_dataclass(value) and not isinstance(value, type)))


def _json_summary(value: Any) -> str:
    text = str(value)
    if len(text) <= SHORT:
        return text
    if isinstance(value, dict) or hasattr(value, "model_dump") or dataclasses.is_dataclass(value):
        n = len(jsonable(value)) if not isinstance(value, dict) else len(value)
        return f"{{{n} keys}}"
    if isinstance(value, np.ndarray):
        return f"array {'×'.join(str(d) for d in value.shape)} {value.dtype}"
    return f"[{len(value)} items]"


def _table_view(value: pd.DataFrame) -> Dict[str, Any]:
    head = value.head(TABLE_ROWS)
    return {"kind": "table", "columns": [str(c) for c in head.columns],
            "rows": jsonable(head.values.tolist()), "total": int(len(value))}


def _text_summary(value: Any) -> str:
    text = repr(value)
    return text if len(text) <= SHORT else text[: SHORT - 1] + "…"


register_cell_type(CellType("text", lambda v: True, _text_summary,
                            lambda v: {"kind": "text", "text": repr(v)[:20000]}), first=False)
register_cell_type(CellType("json", _is_json_like, _json_summary,
                            lambda v: {"kind": "json", "value": jsonable(v)},
                            keeps_value=True))
register_cell_type(CellType("table", lambda v: isinstance(v, pd.DataFrame),
                            lambda v: f"table {len(v)}×{len(v.columns)}", _table_view))
register_cell_type(CellType("plotly", _is_plotly, _plotly_summary, _plotly_view))
register_cell_type(CellType("image", lambda v: _is_image_array(v) or _is_pil_image(v),
                            _image_summary, _image_view,
                            preview=lambda v: _data_url(_image_png(v, THUMBNAIL))))


# ─────────────────────────────────────────────────────────────────────────────
# Cells
# ─────────────────────────────────────────────────────────────────────────────

def cell_type_of(value: Any) -> Optional[CellType]:
    """The cell type for *value*, or ``None`` for plain text and numbers."""
    if is_plain(value):
        return None
    for cell_type in _TYPES:
        try:
            if cell_type.matches(value):
                return cell_type
        except Exception:
            continue
    return None


def cell(row_id: int, column_id: str, value: Any) -> Dict[str, Any]:
    """One grid cell for ``/api/data``.

    Plain values keep the shape they always had (``value`` + ``display_value``).
    Typed values add ``cell_type``, ``summary`` and maybe ``preview``; their
    ``display_value`` is the summary, so every older code path still shows
    something readable.
    """
    if is_plain(value):
        missing = _is_missing(value)
        out = None if missing else (value.item() if isinstance(value, np.generic) else value)
        if isinstance(out, (_dt.date, _dt.time, _dt.timedelta, decimal.Decimal,
                            pd.Timestamp, pd.Timedelta)):
            out = str(out)
        return {"row_id": row_id, "column_id": column_id, "value": out,
                "display_value": "" if missing else str(value)}
    cell_type = cell_type_of(value)
    try:
        summary = cell_type.summary(value)
    except Exception as exc:          # a broken summarizer never breaks the grid
        summary = f"<{type(value).__name__}: {exc}>"
    out: Dict[str, Any] = {
        "row_id": row_id, "column_id": column_id,
        "value": jsonable(value) if cell_type.keeps_value else None,
        "display_value": summary,
        "cell_type": cell_type.name,
        "summary": summary,
    }
    if cell_type.preview is not None:
        try:
            preview = cell_type.preview(value)
        except Exception:
            preview = None
        if preview:
            out["preview"] = preview
    return out


def view(value: Any) -> Dict[str, Any]:
    """The full payload for a cell's viewer (``GET /api/cell/…``)."""
    cell_type = cell_type_of(value)
    if cell_type is None:
        return {"cell_type": None, "summary": "" if _is_missing(value) else str(value),
                "view": {"kind": "text", "text": "" if _is_missing(value) else str(value)}}
    return {"cell_type": cell_type.name, "summary": cell_type.summary(value),
            "view": cell_type.view(value)}
