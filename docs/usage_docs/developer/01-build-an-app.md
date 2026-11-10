# 01 — Build an application

We'll build a tiny "shop" app: three tools, one workflow, a check that it
runs. Every snippet here was run as written.

## 0. Install

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install "git+https://github.com/stusynakowski/Simple_Steps.git"
simple-steps --version
```

## 1. The layout

```
my_app/
├── app.py           the application
├── my_tools.py      your tools
└── projects/
    └── shop/        workflows you save from the UI land here
```

`app.py`'s folder is the workspace unless you pass `workspace=`.

## 2. Write tools

`my_tools.py`:

```python
from SIMPLE_STEPS import simple_step_tool


@simple_step_tool(category="Shop")
def with_tax(price: float, rate: float = 0.08) -> float:
    """The price including tax.

    Args:
        price: the price before tax.
        rate: the tax rate, as a fraction.
    """
    return round(price * (1 + rate), 2)


@simple_step_tool(category="Shop")
def is_pricey(price: float) -> bool:
    """Keep rows whose price is over 5.

    Args:
        price: the price before tax.
    """
    return price > 5


@simple_step_tool(category="Shop")
def add_price(acc, price):
    """A running total of price.

    Args:
        acc: the total so far.
        price: the price to add.
    """
    return (acc or 0) + price
```

The rules that matter:

- **Write one row's worth of logic.** `with_tax` handles one price; Simple
  Steps calls it per row.
- **Name parameters after the columns they read.** `price` reads the
  `price` column.
- **The signature suggests the verb.** With no verb written, `(acc, x)`
  collapses, `-> list` expands, a `DataFrame` first input gets the whole
  table, anything else maps. A `-> bool` tool suits a filter, but users
  write `mod.filter()`: inferred, it maps to a True/False column.
- **Write the `Args:` section, and type hints.** The **Environment** panel
  shows each input's type, default and `Args:` text, and the return type —
  an input without a hint shows as *untyped*.
- **Use `category=`** to group tools in the Environment panel and the
  step editor's tool list.

### A tool that wants the whole table

Give it a `DataFrame` parameter, and run it with `mod.table()`:

```python
import pandas as pd

@simple_step_tool(category="Shop", operation_type="dataframe")
def cheapest(df: pd.DataFrame, n: int = 1) -> pd.DataFrame:
    """The n cheapest rows.

    Args:
        df: the whole input table.
        n: how many rows to keep.
    """
    return df.sort_values("price").head(int(n))
```

It must return a `DataFrame`, and it should return an empty one, not raise,
when given an empty table.

## 3. Write the app

`app.py`:

```python
from SIMPLE_STEPS import App

import my_tools

app = App(tools=[my_tools], title="My shop")

if __name__ == "__main__":
    app.serve()
```

**Import your tools absolutely** — `import my_tools`, or
`from tools_folder import my_tools` for a subfolder with an `__init__.py`.
A relative import (`from . import my_tools`) fails with *attempted relative
import with no known parent package*: both `python app.py` and
`simple-steps run app.py` load `app.py` as a standalone file, not as part of
a package. Both put `app.py`'s folder on the import path, which is what the
absolute form uses.

`tools=` takes modules (every decorated function in them) or single tools.
When you list tools, only those (plus the built-ins) are offered — the
workspace isn't scanned.

## 4. Run it

```bash
simple-steps run app.py          # or: python app.py
```

The UI opens in your browser. Add these steps (see
[03 — Define a step](../user/03-define-a-step.md) in the User guide), one formula each:

| step | formula |
|---|---|
| `items` | `to_rows[mod.source()](data='{"item": ["tea", "cake", "jam"], "price": [3.0, 12.0, 6.5]}')` |
| `taxed` | `with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)` |
| `pricey` | `is_pricey[mod.filter()](wf["items"])` |
| `spend` | `add_price[mod.collapse(initial=0)](wf["pricey"])` |
| `ranked` | `identity[mod.sort(by="price", ascending=False)](wf["items"])` |
| `cheap` | `cheapest[mod.table()](wf["items"], n=2)` |

Expected: `taxed` is one column, `total`: `3.3, 13.2, 7.15`; `pricey` keeps
cake and jam; `spend` is `18.5`, in a column named `spend`; `cheap` is tea,
jam.

Save it as `first` in project `shop`; it lands in
`projects/shop/first.simple-steps-workflow`.

## 5. The same workflow in Python

Each formula is valid Python — the right-hand side of a line in
simple-steps-core:

```python
# twin.py
from simple_steps_core import Kernel, mod, op
from SIMPLE_STEPS.catalog import catalog
from SIMPLE_STEPS.operations import to_rows
from my_tools import add_price, cheapest, is_pricey, with_tax

identity = op("identity")


def build() -> Kernel:
    wf = Kernel(catalog())        # the app's tools, as the UI has them
    wf["items"] = to_rows[mod.source()](data='{"item": ["tea", "cake", "jam"], "price": [3.0, 12.0, 6.5]}')
    wf["taxed"] = with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)
    wf["pricey"] = is_pricey[mod.filter()](wf["items"])
    wf["spend"] = add_price[mod.collapse(initial=0)](wf["pricey"])
    wf["ranked"] = identity[mod.sort(by="price", ascending=False)](wf["items"])
    wf["cheap"] = cheapest[mod.table()](wf["items"], n=2)
    return wf


if __name__ == "__main__":
    wf = build()
    wf.run("spend")               # runs it, and the steps it reads
    print(wf.step("spend").data)
```

This is useful for tests, and for moving a workflow out of the UI into a
script.

## 6. Check it headlessly (optional)

The examples' checker runs a saved workflow the way the UI does and compares
step outputs to what you expect:

```python
# runme.py
import sys
from pathlib import Path
from SIMPLE_STEPS.example_check import Example

import twin

example = Example(Path(__file__).resolve().parent / "app.py")
example.check("shop", "first", twin=twin.build, expect={
    "taxed": {"total": [3.3, 13.2, 7.15]},
    "spend": {"spend": [18.5]},
})
sys.exit(example.finish())
```

```
── shop/first
PASS  items   to_rows[mod.source()](data='…')
PASS  taxed   with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)
…
```

`twin=` takes the function that builds the Python version (step 5); every
step is then also compared cell for cell against it. Leave it out to check
only `expect`.

## 7. Add a resource (when a tool needs a connection or a model)

```python
from SIMPLE_STEPS import simple_step_resource

@simple_step_resource
class PriceList:
    """A fixed discount for every item."""

    def __init__(self, discount: float = 0.5):
        self.discount = discount

    @simple_step_tool                       # a method tool: res["sale"].sale_price
    def sale_price(self, price: float) -> float:
        """The price after the discount.

        Args:
            price: the full price.
        """
        return price * (1 - self.discount)


@simple_step_tool(category="Shop")         # a function that takes the resource
def discounted(price: float, prices: PriceList) -> float:
    """The discounted price, from a price list.

    Args:
        price: the full price.
        prices: the price list to use.
    """
    return prices.sale_price(price)
```

Offer the type in the app — `App(tools=[my_tools], resources=[my_tools.PriceList])`
— create a resource named `sale` in the workflow, then use either form:

```
discounted[mod.map(), mod.name("sale")](wf["items"], prices=res["sale"])
res["sale"].sale_price[mod.map(), mod.name("sale")](wf["items"])
```

Settings are plain literals and are saved with the workflow. Secrets are
not: give the app a ready-made resource with `loaded={"name": Loaded(Type, …)}`
and read credentials there. See
[`examples/dummy_llm/`](../../../src/SIMPLE_STEPS/examples/dummy_llm/README.md).

For a resource that holds files, see
[`examples/image_processing/`](../../../src/SIMPLE_STEPS/examples/image_processing/README.md):
a folder of images declared as `image_directory`, read with
`res["image_directory"].files[mod.source()]()` and processed per image.

## Where next

- [`examples/basic/basic_tools.py`](../../../src/SIMPLE_STEPS/examples/basic/basic_tools.py)
  — the file to copy: a tool for every verb, plus table and diagnostic tools.
- [`examples/bad_examples/`](../../../src/SIMPLE_STEPS/examples/bad_examples/README.md)
  — common mistakes and the messages they produce.
