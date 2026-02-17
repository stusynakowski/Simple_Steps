import pytest
import pandas as pd
from SIMPLE_STEPS.engine import run_operation, save_dataframe, get_dataframe, resolve_reference, DATA_STORE, REGISTRY
from SIMPLE_STEPS.operations import register_operation, OperationParam
from typing import Optional, Any

# Mock operations for testing reference resolution
@register_operation(
    id="test_generate_data",
    label="Test Generator",
    description="Generate a dataframe",
    params=[]
)
def op_test_generate(df: Optional[pd.DataFrame], config: dict) -> pd.DataFrame:
    return pd.DataFrame({
        "A": [1, 2, 3],
        "B": ["x", "y", "z"]
    })

@register_operation(
    id="test_consume_ref",
    label="Test Consumer",
    description="Consume data via reference",
    params=[
        OperationParam(name="input_values", type="list", description="List of values")
    ]
)
def op_test_consume(df: Optional[pd.DataFrame], config: dict) -> pd.DataFrame:
    values = config.get("input_values")
    # Verify values are resolved to list, not string
    if isinstance(values, str) and values.startswith('='):
        raise ValueError("Reference not resolved")
    
    return pd.DataFrame({"Result": values})

def test_step_reference_resolution():
    # 1. Simulate Step 1 Output
    df1 = pd.DataFrame({"COLA": [10, 20, 30], "COLB": ["a", "b", "c"]})
    ref_id_1 = save_dataframe(df1)
    
    # 2. Prepare Step Map
    step_map = {
        "Step 1": ref_id_1
    }
    
    # 3. Simulate Step 2 Config referencing Step 1
    config = {
        "input_values": "=Step 1!COLA"
    }
    
    # 4. Run Step 2
    out_ref_2, metrics = run_operation(
        op_id="test_consume_ref",
        config=config,
        input_ref_id=None,
        step_label_map=step_map
    )
    
    # 5. Verify Output
    df2 = get_dataframe(out_ref_2)
    assert df2 is not None
    assert len(df2) == 3
    assert df2["Result"].tolist() == [10, 20, 30]

def test_reference_resolution_failure():
    # Test reference to non-existent step
    step_map = {}
    config = {"input_values": "=Missing Step!Col"}
    
    # Run should arguably fail or pass unresolved string?
    # Current implementation passes the unresolved string if step not found.
    # The operation will then likely fail if it expects a list.
    
    with pytest.raises(RuntimeError) as excinfo:
        run_operation(
            op_id="test_consume_ref",
            config=config,
            input_ref_id=None,
            step_label_map=step_map
        )
    assert "Operation failed" in str(excinfo.value)
