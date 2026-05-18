""""""

run_pipeline.py — Pipeline runner for mock_basic_variables workflows.run_pipeline.py — Pipeline runner for mock_basic_variables workflows.



mock_basic_variables exercises bare-literal formula syntax (`=42`,Usage

`={"k":"v"}`, etc.) which only requires the core ``literal`` op — no-----

custom ops to register.    python run_pipeline.py

    python run_pipeline.py --workflow workflows/var-string.simple-steps-workflow

This file mirrors the runner pattern in

``mock_table_manipulations/run_pipeline.py`` so tests can import theHow it works

same ``PipelineRunner`` symbol.------------

1.  Imports mock_basic_variables_ops.py so @simple_step ops are registered.

Usage::2.  Loads the workflow JSON into a PipelineFile model.

3.  Runs each step through engine.run_operation() — the same path the UI uses.

    python run_pipeline.py --workflow workflows/var-int.simple-steps-workflow"""

"""

import argparse

from __future__ import annotationsimport io

import json

import argparseimport os

import jsonimport sys

import sysimport time

import timefrom contextlib import redirect_stderr, contextmanager

from pathlib import Pathfrom pathlib import Path

from typing import Dict, Optionalfrom typing import Optional, Dict



HERE = Path(__file__).resolve().parent

REPO_ROOT = HERE.parent.parent@contextmanager

if str(REPO_ROOT / "src") not in sys.path:def _maybe_suppress_stderr(suppress: bool):

    sys.path.insert(0, str(REPO_ROOT / "src"))    if suppress:

        with redirect_stderr(io.StringIO()):

from SIMPLE_STEPS.engine import run_operation, get_dataframe  # noqa: E402            yield

from SIMPLE_STEPS.models import PipelineFile                  # noqa: E402    else:

import SIMPLE_STEPS.operations  # noqa: F401 — registers `literal` + core ops        yield





class StepResult:# ---------------------------------------------------------------------------

    def __init__(self, step_id, label, ref_id, metrics, elapsed):# Path bootstrap

        self.step_id = step_id# ---------------------------------------------------------------------------

        self.label = labelHERE = Path(__file__).resolve().parent

        self.ref_id = ref_idREPO_ROOT = HERE.parent.parent  # mock_projects/../.. = Simple_Steps/

        self.rows: int = metrics.get("rows", 0)

        self.columns: list = metrics.get("columns", [])if not any("SIMPLE_STEPS" in p for p in sys.path):

        self.elapsed = elapsed    sys.path.insert(0, str(REPO_ROOT / "src"))



    @property# ---------------------------------------------------------------------------

    def df(self):# Import engine components

        return get_dataframe(self.ref_id)# ---------------------------------------------------------------------------

from SIMPLE_STEPS.engine import run_operation, get_dataframe  # noqa: E402

    def __repr__(self) -> str:from SIMPLE_STEPS.models import PipelineFile                  # noqa: E402

        return (import SIMPLE_STEPS.operations  # noqa: F401,E402 — registers built-in ops (define_value, etc.)

            f"<StepResult label={self.label!r} "

            f"rows={self.rows} cols={len(self.columns)} "# ---------------------------------------------------------------------------

            f"elapsed={self.elapsed:.2f}s>"# Register mock operations — importing this module triggers @simple_step

        )# ---------------------------------------------------------------------------

sys.path.insert(0, str(HERE))

import mock_basic_variables_ops  # noqa: F401 — side-effect: registers ops

class PipelineRunner:

    """Minimal runner shared by tests/test_basic_variables.py."""

# ---------------------------------------------------------------------------

    def __init__(# PipelineRunner

        self,# ---------------------------------------------------------------------------

        workflow_path: str,

        stop_after: Optional[int] = None,class StepResult:

        on_error: str = "warn",    """Holds the outcome of a single executed step."""

        continue_on_error: bool = False,

    ):    def __init__(

        self.workflow_path = Path(workflow_path).resolve()        self,

        self.stop_after = stop_after        step_id: str,

        self.on_error = on_error        label: str,

        self.continue_on_error = continue_on_error        ref_id: str,

        self.pipeline: Optional[PipelineFile] = None        metrics: dict,

        self.results: Dict[str, StepResult] = {}        elapsed: float,

        self.errors: Dict[str, str] = {}    ):

        self._step_map: Dict[str, str] = {}        self.step_id = step_id

        self._stage: Dict[str, str] = {}        self.label = label

        self.ref_id = ref_id

    def load(self) -> "PipelineRunner":        self.rows: int = metrics.get("rows", 0)

        if not self.workflow_path.exists():        self.columns: list = metrics.get("columns", [])

            raise FileNotFoundError(f"Workflow not found: {self.workflow_path}")        self.elapsed = elapsed

        with open(self.workflow_path) as f:

            data = json.load(f)    @property

        self.pipeline = PipelineFile(**data)    def df(self):

        return self        return get_dataframe(self.ref_id)



    def run(self) -> "PipelineRunner":    def __repr__(self):

        if self.pipeline is None:        return (

            self.load()            f"<StepResult label={self.label!r} "

            f"rows={self.rows} cols={len(self.columns)} "

        steps = self.pipeline.steps            f"elapsed={self.elapsed:.2f}s>"

        if self.stop_after is not None:        )

            steps = steps[: self.stop_after]



        self._stage = {}class PipelineRunner:

        self._step_map = {}    """

    Loads and runs a Simple Steps workflow file via the backend engine.

        for i, step_cfg in enumerate(steps):

            label = step_cfg.label or f"Step {i}"    Example

            op_id = step_cfg.operation_id    -------

            config = dict(step_cfg.config)        runner = PipelineRunner("workflows/var-string.simple-steps-workflow")

        runner.load()

            input_ref_id: Optional[str] = None        runner.run()

            if i > 0:        df = runner.results["step-var"].df

                prev_cfg = steps[i - 1]        assert df.shape == (1, 1)

                prev_key = prev_cfg.step_id    """

                input_ref_id = self._stage.get(prev_key)

    def __init__(

            t0 = time.time()        self,

            try:        workflow_path: str,

                out_ref, metrics = run_operation(        stop_after: Optional[int] = None,

                    op_id=op_id,        on_error: str = "warn",

                    config=config,        continue_on_error: bool = False,

                    input_ref_id=input_ref_id,    ):

                    session_id=None,        self.workflow_path = Path(workflow_path).resolve()

                    step_id=step_cfg.step_id,        self.stop_after = stop_after

                    step_map=self._step_map,        self.on_error = on_error

                )        self.continue_on_error = continue_on_error

            except Exception as e:        self.pipeline: Optional[PipelineFile] = None

                msg = f"{op_id}: {e}"        self.results: Dict[str, StepResult] = {}

                self.errors[step_cfg.step_id] = msg        self.errors: Dict[str, str] = {}

                if self.on_error == "raise":        self._step_map: Dict[str, str] = {}

                    raise        self._stage: Dict[str, str] = {}

                continue

            elapsed = time.time() - t0    # ------------------------------------------------------------------

    # Load

            self._stage[step_cfg.step_id] = out_ref    # ------------------------------------------------------------------

            self._step_map[step_cfg.step_id] = out_ref

            self.results[step_cfg.step_id] = StepResult(    def load(self) -> "PipelineRunner":

                step_id=step_cfg.step_id,        if not self.workflow_path.exists():

                label=label,            raise FileNotFoundError(f"Workflow not found: {self.workflow_path}")

                ref_id=out_ref,        with open(self.workflow_path) as f:

                metrics=metrics,            data = json.load(f)

                elapsed=elapsed,        self.pipeline = PipelineFile(**data)

            )        print(f"  Loaded  : {self.pipeline.name}")

        return self        print(f"  File    : {self.workflow_path.name}")

        print(f"  Steps   : {len(self.pipeline.steps)}")

        return self

def _main(argv: Optional[list] = None) -> int:

    parser = argparse.ArgumentParser(description=__doc__)    # ------------------------------------------------------------------

    parser.add_argument(    # Run

        "--workflow",    # ------------------------------------------------------------------

        default=str(HERE / "workflows" / "basic-variables-literals.simple-steps-workflow"),

    )    def run(self) -> "PipelineRunner":

    parser.add_argument("--steps", type=int, default=None)        if self.pipeline is None:

    args = parser.parse_args(argv)            self.load()



    runner = PipelineRunner(args.workflow, stop_after=args.steps, on_error="raise")        steps = self.pipeline.steps

    runner.load().run()        if self.stop_after is not None:

    for sid, res in runner.results.items():            steps = steps[: self.stop_after]

        print(f"  {sid}: rows={res.rows} cols={res.columns}")

    return 0        print()

        print(f"  Running {len(steps)} step(s)…")

        print()

if __name__ == "__main__":

    raise SystemExit(_main())        self._stage = {}

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

            # Register positional alias (step1, step2, …) and label alias.
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
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Run a basic-variables workflow")
    p.add_argument(
        "--workflow",
        default=str(HERE / "workflows" / "var-string.simple-steps-workflow"),
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
            print(f"  {sid}: shape={df.shape}  value={df.iloc[0, 0]!r}")
