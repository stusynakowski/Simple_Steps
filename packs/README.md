# Developer Packs

This directory contains **developer packs** — reusable collections of
`@simple_step`-decorated Python functions organized by problem domain.

## How It Works

Each sub-folder is a "pack" — a set of related operations that users can
opt into for their projects. When Simple Steps starts, it scans this
directory and imports every `.py` file it finds, automatically registering
any functions decorated with `@simple_step` or `@pack.step`.

## Directory Structure

```
packs/
├── README.md                ← you are here
├── youtube/                 ← a domain-specific pack
│   ├── youtube_ops.py
│   └── analysis_ops.py
├── webscraping/
│   └── scraper_ops.py
└── llm/
    └── llm_ops.py
```

## Creating a New Pack

1. **Create a folder** under `packs/` named after your domain:
   ```
   mkdir packs/my_domain
   ```

2. **Write your functions** in one or more `.py` files, using the
   `@simple_step` decorator:

   ```python
   from SIMPLE_STEPS.decorators import simple_step

   @simple_step(
       id="my_custom_op",
       name="My Custom Operation",
       category="My Domain",
       operation_type="dataframe",
   )
   def my_custom_op(df, threshold: float = 0.5):
       """Filter rows by a custom scoring threshold."""
       return df[df["score"] > threshold]
   ```

3. **That's it.** Restart Simple Steps and your operation will appear in
   the sidebar under the category you specified.

## Using the OperationPack Pattern (Optional)

For more advanced packs that need dependency checking, health validation,
or input/output contracts, use the `OperationPack` class:

```python
from SIMPLE_STEPS.operation_pack import OperationPack

pack = OperationPack(
    name="My Domain",
    version="1.0.0",
    description="Operations for my domain.",
    required_packages=["pandas", "scikit-learn"],
    required_env_vars=["MY_API_KEY"],
)

@pack.step(id="my_op", name="My Operation", operation_type="dataframe")
def my_op(df):
    ...

# IMPORTANT: call register() at the bottom of the file
pack.register()
```

## Notes

- Any Python dependencies your functions need must be installed in the
  active Python environment (`pip install ...`).
- Pack functions are available to ALL projects. For project-specific
  operations, put them in the project's `ops/` folder instead.
- Use `simple-steps --packs /path/to/extra/packs` to add additional
  pack directories at startup.
