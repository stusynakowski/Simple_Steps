# My Project — Using Simple Steps as a Package

This is an example of how to use `simple-steps` as an installed package
in your own repository.

## Setup

```bash
# 1. Create a virtual environment
python -m venv .venv
source .venv/bin/activate

# 2. Install simple-steps from the built wheel (local)
pip install /path/to/Simple_Steps/dist/simple_steps-0.1.0-py3-none-any.whl

# Or install directly from the GitHub repo:
# pip install git+https://github.com/stusynakowski/Simple_Steps.git

# 3. Run your custom operations as a script
python my_operations.py

# 4. Or launch the full UI with your operations loaded
simple-steps --ops-dir .
```

## Files

- `my_operations.py` — Custom `@simple_step` operations + script usage
- `my_pipeline.py` — Scripted pipeline using the step proxy API (no UI needed)
