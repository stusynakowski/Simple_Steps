import json
import os
from pathlib import Path

from SIMPLE_STEPS import notebook_dataflow as nd


def test_register_and_load(tmp_path):
    ws = str(tmp_path)
    nd.clear_dataflow(workspace=ws)

    nd.register_step(
        step_id="s1",
        title="T1",
        inputs=["a"],
        outputs=["b"],
        metadata={"x": 1},
        workspace=ws,
    )

    p = nd.get_datafile_path(workspace=ws)
    assert p.exists()
    data = nd.load_dataflow(workspace=ws)
    assert "steps" in data
    assert any(s.get("id") == "s1" for s in data["steps"])

    # update existing
    nd.register_step(step_id="s1", title="T1-updated", workspace=ws)
    data2 = nd.load_dataflow(workspace=ws)
    found = [s for s in data2["steps"] if s.get("id") == "s1"][0]
    assert found["title"] == "T1-updated"

    # clear
    nd.clear_dataflow(workspace=ws)
    assert not nd.get_datafile_path(workspace=ws).exists()
