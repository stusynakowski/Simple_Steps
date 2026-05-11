"""
run_pipeline.py — Pipeline runner for mock_table_manipulations workflows.

Registers both define_variable (from mock_basic_variables) and the table ops
(expand_cell, make_table) so that multi-step workflows can chain them.

Usage
-----
    python run_pipeline.py
    python run_pipeline.py --workflow workflows/expand-list-scalars.simple-steps-workflow
"""

import argparse
import io
import json
import os
import sys
import time
from contextlib import redirect_stderr, contextmanager
from pathlib import Path
from typing import Optional, Dict


@contextmanager
def _maybe_suppress_stderr(suppress: bool):
    if suppress:
        with redirect_stderr(io.StringIO()):
            yield
    else:
        yield


# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent

if not any("SIMPLE_STEPS" in p for p in sys.path):
    sys.path.insert(0, str(REPO_ROOT / "src"))

# ---------------------------------------------------------------------------
# Engine imports
# ---------------------------------------------------------------------------
from SIMPLE_STEPS.engine import run_operation, get_dataframe  # noqa: E402
from SIMPLE_STEPS.models import PipelineFile                  # noqa: E402
import SIMPLE_STEPS.operations  # Ensure core operations are registered

# ---------------------------------------------------------------------------
# Register ops — order matters only for clarity; all ops share a global registry
# ---------------------------------------------------------------------------
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "mock_basic_variables"))

import mock_basic_variables_ops  # noqa: F401 — registers define_variable
import mock_table_ops             # noqa: F401 — registers expand_cell, make_table


# ---------------------------------------------------------------------------
# StepResult / PipelineRunner  (same pattern as other mock runners)
# ---------------------------------------------------------------------------

class StepResult:
    def __init__(self, step_id, label, ref_id, metrics, elapsed):
        self.step_id = step_id
        self.label = label
        self.ref_id = ref_id
        self.rows: int = metrics.get("rows", 0)
        self.columns: list = metrics.get("columns", [])
        self.elapsed = elapsed

    @property
    def df(self):
        return get_dataframe(self.ref_id)

    def __repr__(self):
        return (
            f"<StepResult label={self.label!r} "
            f"rows={self.rows} cols={len(self.columns)} "
            f"elapsed={self.elapsed:.2f}s>"
        )


class PipelineRunner:
    """
    Loads and runs a Simple Steps workflow file via the backend engine.

    Example
    -------
        runner = PipelineRunner("workflows/expand-list-scalars.simple-steps-workflow")
        runner.load()
        runner.run()
        df = runner.results["step-expand"].df
    """

    def __init__(
        self,
        workflow_path: str,
        stop_after: Optional[int] = None,
        on_error: str = "warn",
        continue_on_error: bool = False,
    ):
        self.workflow_path = Path(workflow_path).resolve()
        self.stop_after = stop_after
        self.on_error = on_error
        self.continue_on_error = continue_on_error
        self.pipeline: Optional[PipelineFile] = None
        self.results: Dict[str, StepResult] = {}
        self.errors: Dict[str, str] = {}
        self._step_map: Dict[str, str] = {}
        self._stage: Dict[str, str] = {}

    def load(self) -> "PipelineRunner":
        if not self.workflow_path.exists():
            raise FileNotFoundError(f"Workflow not found: {self.workflow_path}")
        with open(self.workflow_path) as f:
            data = json.load(f)
        self.pipeline = PipelineFile(**data)
        print(f"  Loaded  : {self.pipeline.name}")
        print(f"  File    : {self.workflow_path.name}")
        print(f"  Steps   : {len(self.pipeline.steps)}")
        return self

    def run(self) -> "PipelineRunner":
        if self.pipeline is None:
            self.load()

        steps = self.pipeline.steps
        if self.stop_after is not None:
            steps = steps[: self.stop_after]

        print()
        print(f"  Running {len(steps)} step(s)…")
        print()

        self._stage = {}
        self._step_map = {}

        for i, step_cfg in enumerate(steps):
            label = step_cfg.label or f"Step {i}"
            op_id = step_cfg.operation_id
            config = dict(step_cfg.config)

            print(f"  [{i + 1}/{len(steps)}] {label}  ({op_id})")

            input_ref_id: Optional[str] = None
            if i > 0:
                prev_cfg = steps[i - 1]
                prev_key = prev_cfg.step_id
                input_ref_id = self._stage.get(prev_key)
                if input_ref_id is None:
                    msg = (
                        f"Input not staged — step '{prev_cfg.label or prev_key}' "
                        f"did not produce output. Skipping '{label}'."
                    )
                    print(f"       ⚠ {msg}")
                    self.errors[step_cfg.step_id] = msg
                    if self.on_error == "raise" or not self.continue_on_error:
                        break
                    continue

            t0 = time.perf_counter()
            try:
                with _maybe_suppress_stderr(self.on_error == "warn"):
                    ref_id, metrics = run_operation(
                        op_id=op_id,
                        config=config,
                        input_ref_id=input_ref_id,
                        step_label_map=self._step_map,
                        formula=step_cfg.formula or None,
                        step_id=step_cfg.step_id,
                    )
            except Exception as exc:
                elapsed = time.perf_counter() - t0
                msg = str(exc)
                self.errors[step_cfg.step_id] = msg
                print(f"       ✗ FAILED ({elapsed:.2f}s) — {msg}")
                if self.on_error == "raise":
                    raise
                if not self.continue_on_error:
                    break
                continue

            elapsed = time.perf_counter() - t0
            result = StepResult(
                step_id=step_cfg.step_id,
                label=label,
                ref_id=ref_id,
                metrics=metrics,
                elapsed=elapsed,
            )

            self.results[step_cfg.step_id] = result
            self._stage[step_cfg.step_id] = ref_id

            pos_alias = f"step{i + 1}"
            self._step_map[pos_alias] = ref_id
            self._step_map[step_cfg.step_id] = ref_id
            if label:
                label_key = label.lower().replace(" ", "_")
                self._step_map[label_key] = ref_id

            print(
                f"       ✓ {result.rows} row(s) × {len(result.columns)} col(s) "
                f"in {elapsed:.2f}s"
            )

        return self


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser():
    p = argparse.ArgumentParser(description="Run a table-manipulations workflow")
    p.add_argument(
        "--workflow",
        default=str(HERE / "workflows" / "expand-list-scalars.simple-steps-workflow"),
    )
    p.add_argument("--steps", type=int, default=None)
    return p


if __name__ == "__main__":
    args = _build_parser().parse_args()
    runner = PipelineRunner(args.workflow, stop_after=args.steps)
    runner.load()
    runner.run()

    if runner.errors:
        print("\nErrors:")
        for sid, msg in runner.errors.items():
            print(f"  {sid}: {msg}")
    else:
        print("\nAll steps completed successfully.")
        for sid, result in runner.results.items():
            df = result.df
            print(f"  {sid}: shape={df.shape}")
            print(df.to_string(index=False))
            print()
