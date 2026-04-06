"""
simple-steps-example-pack
=========================
An example operation pack for Simple Steps.

All @simple_step decorated functions in this package (and its submodules)
are auto-registered when Simple Steps starts — no configuration needed.

Just: pip install simple-steps-example-pack
"""

# Import submodules so their @simple_step decorators run at import time
from . import operations  # noqa: F401
