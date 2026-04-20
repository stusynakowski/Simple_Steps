"""
my_operations.py — Custom operations using simple-steps as a package.

This file defines custom @simple_step operations that automatically
register into the Simple Steps UI and engine.
"""

from simple_steps import simple_step
import pandas as pd


# ── Custom Operations ────────────────────────────────────────────────────

@simple_step(name="Load Sales Data", category="My Project", operation_type="source", id="load_sales")
def load_sales(region: str = "all") -> pd.DataFrame:
    """Generate sample sales data (replace with your real data source)."""
    data = {
        "product": ["Widget A", "Widget B", "Gadget X", "Widget A", "Gadget X"],
        "region": ["east", "west", "east", "west", "west"],
        "revenue": [1200, 800, 1500, 950, 2100],
        "units": [10, 8, 5, 7, 12],
    }
    df = pd.DataFrame(data)
    if region != "all":
        df = df[df["region"] == region]
    return df


@simple_step(name="Add Profit Margin", category="My Project", operation_type="dataframe", id="add_margin")
def add_margin(df: pd.DataFrame, cost_per_unit: float = 50.0) -> pd.DataFrame:
    """Add a profit margin column based on revenue minus cost."""
    result = df.copy()
    result["cost"] = result["units"] * cost_per_unit
    result["profit"] = result["revenue"] - result["cost"]
    result["margin_pct"] = (result["profit"] / result["revenue"] * 100).round(1)
    return result


@simple_step(name="Top Products", category="My Project", operation_type="dataframe", id="top_products")
def top_products(df: pd.DataFrame, metric: str = "revenue", n: int = 3) -> pd.DataFrame:
    """Return the top N products by a given metric."""
    return (
        df.groupby("product")[metric]
        .sum()
        .sort_values(ascending=False)
        .head(n)
        .reset_index()
    )


@simple_step(name="Uppercase Text", category="My Project", operation_type="map", id="uppercase")
def uppercase(cell: str = "") -> str:
    """Convert a cell value to uppercase."""
    return str(cell).upper()


# ── Script Usage (no UI needed) ──────────────────────────────────────────

if __name__ == "__main__":
    from simple_steps import step

    # Step 1: Load data
    s1 = load_sales(region="all")
    print("── Step 1: Sales Data ──")
    print(s1.df)
    print()

    # Step 2: Add profit margin
    s2 = add_margin(s1.df, cost_per_unit=50.0)
    print("── Step 2: With Profit Margin ──")
    print(s2.df)
    print()

    # Step 3: Top products by profit
    s3 = top_products(s2.df, metric="profit", n=3)
    print("── Step 3: Top Products by Profit ──")
    print(s3.df)
