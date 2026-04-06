# simple-steps-example-pack

An example operation pack for [Simple Steps](https://github.com/stusynakowski/Simple_Steps).

## Installation

```bash
pip install simple-steps-example-pack
```

That's it. The operations will appear in the Simple Steps UI automatically.

## What's Inside

| Operation | ID | Type | Description |
|---|---|---|---|
| Hello World | `example_hello` | map | Returns a greeting |
| Uppercase Text | `example_uppercase` | map | Converts text to uppercase |

## Creating Your Own Pack

1. **Copy this template** and rename it:
   ```
   my-pack/
   ├── pyproject.toml                        # package metadata + entry point
   ├── README.md
   └── src/
       └── simple_steps_my_pack/             # your Python package
           ├── __init__.py                   # imports submodules
           └── operations.py                 # @simple_step functions
   ```

2. **Rename the package** in `pyproject.toml`:
   ```toml
   [project]
   name = "simple-steps-my-pack"

   [project.entry-points."simple_steps.packs"]
   my_pack = "simple_steps_my_pack"
   ```

3. **Write your operations** using `@simple_step`:
   ```python
   from SIMPLE_STEPS.decorators import simple_step

   @simple_step(id="my_op", name="My Operation", category="My Pack")
   def my_op(input_text: str) -> str:
       return input_text.upper()
   ```

4. **Install locally** to test:
   ```bash
   cd my-pack
   pip install -e .
   ```

5. **Publish to PyPI** when ready:
   ```bash
   pip install build twine
   python -m build
   twine upload dist/*
   ```

## Using the OperationPack Pattern (Optional)

For packs that need dependency checking or health validation:

```python
from SIMPLE_STEPS.operation_pack import OperationPack

pack = OperationPack(
    name="My Domain",
    version="1.0.0",
    required_packages=["requests", "pandas"],
    required_env_vars=["MY_API_KEY"],
)

@pack.step(id="my_op", name="My Operation", operation_type="source")
def my_op(query: str) -> list:
    ...

pack.register()
```
