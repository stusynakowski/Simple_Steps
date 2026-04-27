"""
run_pipeline.py — Script runner for Simple Steps workflow files.

Loads a .simple-steps-workflow (or .json) pipeline file and executes it
sequentially using the same engine that powers the UI.

Usage:
    python run_pipeline.py
    python run_pipeline.py --workflow workflows/runner_example.simple-steps-workflow
    python run_pipeline.py --workflow workflows/ui-test-basic-fetch-metadata.simple-steps-workflow --steps 2

How it works:
    1.  Imports mock_youtube_ops.py so all @simple_step operations are registered.
    2.  Loads the workflow JSON into a PipelineFile model.
    3.  Runs each step through engine.run_operation() — the exact same path the
        UI uses — passing the accumulated step_map so cross-step references
        (e.g. step1.output) resolve correctly.
    4.  Prints a summary table of row/column counts and the first few rows of
        each step's output DataFrame.
"""

import argparse
import io
import json
import os
import sys
import textwrap
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
# Path bootstrap — allow running from any working directory
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent  # mock_projects/../.. = Simple_Steps/

# Prefer the editable-install already on sys.path; fall back to src/
if not any("SIMPLE_STEPS" in p for p in sys.path):
    sys.path.insert(0, str(REPO_ROOT / "src"))

# ---------------------------------------------------------------------------
# Import engine components BEFORE registering operations
# ---------------------------------------------------------------------------
from SIMPLE_STEPS.engine import run_operation, get_dataframe  # noqa: E402
from SIMPLE_STEPS.models import PipelineFile                  # noqa: E402

# ---------------------------------------------------------------------------
# Register mock operations — importing this module triggers @simple_step
# ---------------------------------------------------------------------------
sys.path.insert(0, str(HERE))
import mock_youtube_ops  # noqa: F401 — side-effect: registers ops in OPERATION_REGISTRY


# ---------------------------------------------------------------------------
# PipelineRunner
# ---------------------------------------------------------------------------

class StepResult:
    """Holds the outcome of a single executed step."""
    def __init__(self, step_id: str, label: str, ref_id: str, metrics: dict, elapsed: float):
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
        runner = PipelineRunner("workflows/runner_example.simple-steps-workflow")
        runner.run()
        df = runner.results["step-2-transcribe"].df

    on_error options
    ----------------
    'raise' — re-raise the exception and stop immediately (strict mode).
    'warn'  — print the error, skip the failed step, and continue.
    """

    def __init__(
        self,
        workflow_path: str,
        stop_after: Optional[int] = None,
        on_error: str = "warn",
    ):
        """
        Parameters
        ----------
        workflow_path:
            Path to a .simple-steps-workflow or .json pipeline file.
        stop_after:
            If set, only execute the first N steps.
        on_error:
            'warn' (default) — print error, skip step, continue.
            'raise'          — re-raise immediately and abort.
        """
        self.workflow_path = Path(workflow_path).resolve()
        self.stop_after = stop_after
        self.on_error = on_error
        self.pipeline: Optional[PipelineFile] = None
        self.results: Dict[str, StepResult] = {}
        self.errors: Dict[str, str] = {}   # step_id → error message
        self._step_map: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------

    def load(self) -> "PipelineRunner":
        """Parse the workflow file into a PipelineFile model."""
        if not self.workflow_path.exists():
            raise FileNotFoundError(f"Workflow not found: {self.workflow_path}")
        with open(self.workflow_path) as f:
            data = json.load(f)
        self.pipeline = PipelineFile(**data)
        print(f"  Loaded  : {self.pipeline.name}")
        print(f"  File    : {self.workflow_path.name}")
        print(f"  Steps   : {len(self.pipeline.steps)}")
        return self

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    def run(self) -> "PipelineRunner":
        """Execute all steps (or stop_after steps) sequentially."""
        if self.pipeline is None:
            self.load()

        steps = self.pipeline.steps
        if self.stop_after is not None:
            steps = steps[: self.stop_after]

        print()
        print(f"  Running {len(steps)} step(s)…")
        print()

        prev_ref_id: Optional[str] = None

        for i, step_cfg in enumerate(steps):
            label = step_cfg.label or f"Step {i}"
            op_id = step_cfg.operation_id
            config = dict(step_cfg.config)

            print(f"  [{i + 1}/{len(steps)}] {label}  ({op_id})")

            t0 = time.perf_counter()
            try:
                # Suppress the engine's own traceback.print_exc() noise when in
                # warn mode — the runner prints its own concise error line.
                with _maybe_suppress_stderr(self.on_error == "warn"):
                    ref_id, metrics = run_operation(
                        op_id=op_id,
                        config=config,
                        input_ref_id=prev_ref_id,
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
                # 'warn' — skip this step; subsequent steps that reference it
                # will resolve to the previous step's output (or None).
                print(f"         (skipping — use --strict to abort on error)")
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

            # Update step_map so later steps can reference this one.
            # Keys match what the frontend wires:
            #   step<N>          positional alias  (step1, step2, …)
            #   <step_id>        exact ID
            #   <label>          human label
            positional = f"step{i + 1}"
            for key in (step_cfg.step_id, label, positional):
                self._step_map[key] = ref_id

            cols_str = ", ".join(metrics.get("columns", []))
            print(
                f"       ✓ {metrics.get('rows', '?')} rows × "
                f"{len(metrics.get('columns', []))} cols  "
                f"[{elapsed:.2f}s]  columns: {cols_str}"
            )

            prev_ref_id = ref_id

        print()
        return self

    # ------------------------------------------------------------------
    # Inspect
    # ------------------------------------------------------------------

    def show(self, step_id: Optional[str] = None, n: int = 5) -> None:
        """
        Print the first `n` rows of one step (by step_id or label)
        or all steps if step_id is None.
        """
        targets = list(self.results.values())
        if step_id is not None:
            # Accept step_id OR label
            targets = [
                r for r in targets
                if r.step_id == step_id or r.label == step_id
            ]
            if not targets:
                print(f"  No result for {step_id!r}")
                return

        for result in targets:
            df = result.df
            print(f"  ── {result.label}  ({result.step_id}) ──")
            if df is None or df.empty:
                print("     (empty)")
            else:
                print(textwrap.indent(str(df.head(n)), "     "))
            print()

    def summary(self) -> None:
        """Print a concise table of all step results."""
        if not self.results and not self.errors:
            print("  (no results — run() not called yet)")
            return

        all_step_ids = [s.step_id for s in self.pipeline.steps]

        print()
        print(f"  {'Step':<30}  {'Rows':>6}  {'Cols':>5}  {'Time':>7}  Columns / Error")
        print(f"  {'-'*30}  {'-'*6}  {'-'*5}  {'-'*7}  --------")
        for step_cfg in self.pipeline.steps:
            sid = step_cfg.step_id
            label = step_cfg.label or sid
            if sid in self.errors:
                print(f"  {label:<30}  {'—':>6}  {'—':>5}  {'—':>7}  ✗ {self.errors[sid][:60]}")
            elif sid in self.results:
                r = self.results[sid]
                cols_preview = ", ".join(r.columns[:4])
                if len(r.columns) > 4:
                    cols_preview += f", … (+{len(r.columns) - 4})"
                print(
                    f"  {r.label:<30}  {r.rows:>6}  {len(r.columns):>5}  "
                    f"{r.elapsed:>6.2f}s  {cols_preview}"
                )
            else:
                print(f"  {label:<30}  {'—':>6}  {'—':>5}  {'—':>7}  (skipped)")
        completed = [r for r in self.results.values()]
        total = sum(r.elapsed for r in completed)
        print(f"  {'':30}  {'':6}  {'':5}  {total:>6.2f}s  ← total")
        print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _banner(title: str) -> None:
    width = 60
    print()
    print("  " + "─" * width)
    print(f"  {'⚡ ' + title:^{width}}")
    print("  " + "─" * width)
    print()


DEFAULT_WORKFLOW = str(
    HERE / "workflows" / "runner_example.simple-steps-workflow"
)


def main():
    parser = argparse.ArgumentParser(
        description="Run a Simple Steps workflow file from the command line."
    )
    parser.add_argument(
        "--workflow", "-w",
        default=DEFAULT_WORKFLOW,
        help="Path to a .simple-steps-workflow or .json file "
             f"(default: {Path(DEFAULT_WORKFLOW).name})",
    )
    parser.add_argument(
        "--steps", "-s",
        type=int,
        default=None,
        metavar="N",
        help="Only execute the first N steps.",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Print a preview of every step's output DataFrame after running.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Abort immediately on any step error (default: warn and skip).",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=5,
        metavar="N",
        help="Number of preview rows to show per step (default 5).",
    )
    args = parser.parse_args()

    _banner("Simple Steps — Pipeline Runner")

    on_error = "raise" if args.strict else "warn"
    runner = PipelineRunner(args.workflow, stop_after=args.steps, on_error=on_error)
    runner.load()
    runner.run()
    runner.summary()

    if args.show:
        print("  ── Output Previews ──────────────────────────────────")
        print()
        runner.show(n=args.rows)


if __name__ == "__main__":
    main()
