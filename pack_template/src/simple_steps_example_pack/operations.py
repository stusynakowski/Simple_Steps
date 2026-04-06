"""
Example operations for the Simple Steps platform.

Each @simple_step function here will appear in the Simple Steps UI
automatically when this pack is pip-installed.
"""

from SIMPLE_STEPS.decorators import simple_step


@simple_step(
    id="example_hello",
    name="Hello World",
    category="Example Pack",
    operation_type="map",
)
def hello_world(name: str = "World") -> str:
    """Return a friendly greeting."""
    return f"Hello, {name}!"


@simple_step(
    id="example_uppercase",
    name="Uppercase Text",
    category="Example Pack",
    operation_type="map",
)
def uppercase_text(text: str) -> str:
    """Convert text to uppercase."""
    return text.upper()
