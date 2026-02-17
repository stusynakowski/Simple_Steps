import pytest
import pandas as pd
from SIMPLE_STEPS.engine import run_operation, save_dataframe, get_dataframe, resolve_reference, DATA_STORE
from SIMPLE_STEPS.decorators import simple_step, OPERATION_REGISTRY
from typing import Optional, Any, List

# Mock operations for testing reference resolution
@simple_step(
    id="test_generate_data",
    name="Test Generator",
    operation_type="source"
)
def op_test_generate() -> pd.DataFrame:
    return pd.DataFrame({
        "A": [1, 2, 3],
        "B": ["x", "y", "z"]
    })

@simple_step(
    id="test_consume_ref",
    name="Test Consumer",
    operation_type="source" 
)
def op_test_consume(input_values: List[Any]) -> pd.DataFrame:
    # Verify values are resolved to list, not string
    if isinstance(input_values, str) and input_values.startswith('='):
        raise ValueError("Reference not resolved")
    return pd.DataFrame({"Result": input_values})

# We need to manually register if we want to use them in run_operation,
# but simple_step does that automatically.


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
