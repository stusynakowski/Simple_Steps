"""
my_pipeline.py — Scripted pipeline using the step proxy API.

This shows the more "Pythonic" usage where steps chain together
like variables, with automatic row-wise broadcasting.
"""

from simple_steps import simple_step, step, map_each
import pandas as pd


# Define a custom map operation
@simple_step(name="Tag High Value", category="Analysis", operation_type="map", id="tag_high_value")
def tag_high_value(cell: float = 0, threshold: float = 1000) -> str:
    """Tag values above a threshold as 'HIGH', otherwise 'LOW'."""
    return "HIGH" if float(cell) >= float(threshold) else "LOW"


if __name__ == "__main__":
    # Create a step from raw data
    sales = step({
        "product": ["Widget A", "Widget B", "Gadget X", "Widget A"],
        "revenue": [1200, 800, 1500, 950],
    })
    print("── Raw Data ──")
    print(sales.df)
    print()

    # Map operation: tag each revenue cell (broadcasts row-wise automatically)
    tagged = tag_high_value(cell=sales.revenue, threshold=1000)
    print("── Tagged (row-wise map) ──")
    print(tagged.df)
    print()

    # Use the built-in map_each helper with a plain lambda
    uppered = map_each(str.upper, text=sales.product)
    print("── Uppercased Products ──")
    print(uppered.df)
