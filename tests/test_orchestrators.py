import pytest
import pandas as pd
from SIMPLE_STEPS.orchestrators import source_wrapper, rowmap_wrapper, filter_wrapper, expand_wrapper

def test_source_wrapper():
    # Test function returning list of scalars
    def get_list():
        return ["a", "b", "c"]
    
    wrapped = source_wrapper(get_list)
    df = wrapped()
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 3
    assert "output" in df.columns
    assert df["output"].tolist() == ["a", "b", "c"]

    # Test function returning list of dicts
    def get_dicts():
        return [{"id": 1, "val": "x"}, {"id": 2, "val": "y"}]
    
    wrapped_dict = source_wrapper(get_dicts)
    df_dict = wrapped_dict()
    assert isinstance(df_dict, pd.DataFrame)
    assert len(df_dict) == 2
    assert "id" in df_dict.columns

def test_rowmap_wrapper():
    # Input DataFrame
    df = pd.DataFrame({"val": [1, 2, 3]})
    
    # Simple scalar mapping
    def double(val):
        return val * 2
        
    wrapped = rowmap_wrapper(double)
    # Simulate engine passing kwargs
    res = wrapped(val=df) 
    
    # Since 'val' matches the argument name, it should pick that column
    assert "double_output" in res.columns
    assert res["double_output"].tolist() == [2, 4, 6]

def test_filter_wrapper():
    df = pd.DataFrame({"num": [10, 20, 30, 5]})
    
    def is_big(num):
        return num > 15
        
    wrapped = filter_wrapper(is_big)
    res = wrapped(num=df)
    
    assert len(res) == 2
    assert res["num"].tolist() == [20, 30]

def test_expand_wrapper():
    df = pd.DataFrame({"group": ["A", "B"]})
    
    def expand_group(group):
        if group == "A": return [1, 2]
        return [3]
        
    wrapped = expand_wrapper(expand_group)
    res = wrapped(group=df)
    
    # Should result in 3 rows: A->1, A->2, B->3
    assert len(res) == 3
    assert "expand_group_output" in res.columns
    assert res["expand_group_output"].tolist() == [1, 2, 3]
