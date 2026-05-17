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
        continue_on_error: bool = False,
        wait_for_stable: bool = False,
        stable_checks: int = 3,
        poll_interval: float = 0.5,
        stable_timeout: float = 20.0,
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
        continue_on_error:
            Only applies when on_error='warn'.
            False (default) — stop pipeline after first failed step.
            True            — keep previous behavior: skip failed step and continue.
        wait_for_stable:
            If True, poll each completed step output and only continue to the
            next step once row count is stable for `stable_checks` polls.
            Useful when an operation returns early while data is still growing.
        stable_checks:
            Number of consecutive identical row-count polls required.
        poll_interval:
            Seconds between stability polls.
        stable_timeout:
            Max seconds to wait for a step output to stabilize.
        """
        self.workflow_path = Path(workflow_path).resolve()
        self.stop_after = stop_after
        self.on_error = on_error
        self.continue_on_error = continue_on_error
        self.wait_for_stable = wait_for_stable
        self.stable_checks = max(1, int(stable_checks))
        self.poll_interval = max(0.05, float(poll_interval))
        self.stable_timeout = max(0.5, float(stable_timeout))
        self.pipeline: Optional[PipelineFile] = None
        self.results: Dict[str, StepResult] = {}
        self.errors: Dict[str, str] = {}   # step_id → error message
        self._step_map: Dict[str, str] = {}
        # Stage: canonical record of all outputs available for downstream steps.
        # Keys are every alias that identifies a completed step (id, label, step<N>).
        # A step's input is resolved from here before it is allowed to run.
        self._stage: Dict[str, str] = {}     # alias → ref_id

    def _wait_until_stable(self, ref_id: str, label: str) -> None:
        """Wait until row count for `ref_id` stops changing for N polls."""
        if not self.wait_for_stable:
            return

        start = time.perf_counter()
        last_rows: Optional[int] = None
        stable_hits = 0

        while True:
            df = get_dataframe(ref_id)
            rows = len(df) if df is not None else 0

            if last_rows is None:
                last_rows = rows
            elif rows == last_rows:
                stable_hits += 1
                if stable_hits >= self.stable_checks:
                    print(f"       ↺ stabilized at {rows} rows — continuing")
                    return
            else:
                print(f"       ↺ output still growing: {last_rows} → {rows} rows")
                last_rows = rows
                stable_hits = 0

            if (time.perf_counter() - start) >= self.stable_timeout:
                print(f"       ⚠ stability timeout after {self.stable_timeout:.1f}s; continuing with {rows} rows")
                return

            time.sleep(self.poll_interval)

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
        """Execute all steps (or stop_after steps) sequentially.

        After every successful step the output is committed to ``self._stage``.
        Before each step runs, the stage is checked for the previous step's
        output so that a step is never executed against incomplete or missing
        upstream data — even in continue-on-error mode.
        """
        if self.pipeline is None:
            self.load()

        steps = self.pipeline.steps
        if self.stop_after is not None:
            steps = steps[: self.stop_after]

        print()
        print(f"  Running {len(steps)} step(s)…")
        print()

        # Clear stage at the start of each run so re-runs are clean.
        self._stage = {}
        self._step_map = {}

        for i, step_cfg in enumerate(steps):
            label = step_cfg.label or f"Step {i}"
            op_id = step_cfg.operation_id
            config = dict(step_cfg.config)

            print(f"  [{i + 1}/{len(steps)}] {label}  ({op_id})")

            # ── Resolve input from stage ────────────────────────────────────
            # For the first step there is no prior output.
            # For all others, look up the previous step's ref_id in the stage.
            # If it's absent (because that step failed/was skipped) we refuse
            # to run this step against stale or missing data.
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
                        print("         (stopping pipeline — upstream data is missing)")
                        break
                    continue

            t0 = time.perf_counter()
            try:
                # Suppress the engine's own traceback.print_exc() noise when in
                # warn mode — the runner prints its own concise error line.
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
                    print("         (stopping pipeline — use --continue-on-error to keep running)")
                    break
                print("         (skipping — use --strict to abort on error)")
                continue

            elapsed = time.perf_counter() - t0
            result = StepResult(
                step_id=step_cfg.step_id,
                label=label,
                ref_id=ref_id,
                metrics=metrics,
                elapsed=elapsed,
            )

            # Optional barrier mode: do not start downstream steps until this
            # step's output stops changing.
            self._wait_until_stable(ref_id, label)

            # Refresh result shape after stability wait in case rows/columns
            # changed after run_operation returned.
            final_df = get_dataframe(ref_id)
            if final_df is not None:
                result.rows = len(final_df)
                result.columns = list(final_df.columns)

            self.results[step_cfg.step_id] = result

            # ── Commit to stage ────────────────────────────────────────────
            # Register all aliases for this step so downstream steps and the
            # step_map can resolve references by any name.
            positional = f"step{i + 1}"
            for key in (step_cfg.step_id, label, positional):
                self._stage[key] = ref_id
                self._step_map[key] = ref_id

            cols_str = ", ".join(result.columns[:6])
            if len(result.columns) > 6:
                cols_str += f", … (+{len(result.columns) - 6})"
            print(
                f"       ✓ {result.rows} rows × "
                f"{len(result.columns)} cols  "
                f"[{elapsed:.2f}s]  columns: {cols_str}"
            )
            print(f"       ↳ staged as: {step_cfg.step_id}, {label}, {positional}")

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
        "--continue-on-error",
        action="store_true",
        help="When not in --strict mode, skip failed steps and keep running downstream steps.",
    )
    parser.add_argument(
        "--wait-stable",
        action="store_true",
        help="After each step, wait until output row-count stabilizes before running next step.",
    )
    parser.add_argument(
        "--stable-checks",
        type=int,
        default=3,
        metavar="N",
        help="Consecutive stable polls required with --wait-stable (default 3).",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=0.5,
        metavar="SEC",
        help="Seconds between stability polls with --wait-stable (default 0.5).",
    )
    parser.add_argument(
        "--stable-timeout",
        type=float,
        default=20.0,
        metavar="SEC",
        help="Max seconds to wait for stability with --wait-stable (default 20).",
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
    runner = PipelineRunner(
        args.workflow,
        stop_after=args.steps,
        on_error=on_error,
        continue_on_error=args.continue_on_error,
        wait_for_stable=args.wait_stable,
        stable_checks=args.stable_checks,
        poll_interval=args.poll_interval,
        stable_timeout=args.stable_timeout,
    )
    runner.load()
    runner.run()
    runner.summary()

    if args.show:
        print("  ── Output Previews ──────────────────────────────────")
        print()
        runner.show(n=args.rows)


if __name__ == "__main__":
    main()
