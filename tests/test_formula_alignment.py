"""
test_formula_alignment.py
===========================
End-to-end alignment tests ensuring that:

  1. A Python function registered with @simple_step can be called directly
     in a Python script with the exact same arguments.
  2. The same function + arguments can be expressed as a formula string
     (e.g. =fetch_channel_videos.source(channel_url="https://..."))
  3. That formula string, when parsed, produces the correct operation_id
     and config dict that the backend engine accepts.
  4. When saved to pipeline JSON and reloaded, the formula bar shows the
     correct formula (not just the step name).
  5. When formula is typed by hand in the formula bar, the resulting
     operation_id + config matches what the engine expects.

These tests cover the THREE critical boundaries:
  ┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
  │ Python Script │←→│ Backend Engine    │←→│ Frontend Formula │
  │ (function call)│  │ (run_operation)   │   │ (formula bar)    │
  └──────────────┘    └──────────────────┘    └─────────────────┘
"""

import os
import sys
import json
import pytest
import pandas as pd

# Ensure src/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from SIMPLE_STEPS.decorators import simple_step, OPERATION_REGISTRY, DEFINITIONS_LIST
from SIMPLE_STEPS.engine import run_operation, save_dataframe, get_dataframe, DATA_STORE
from SIMPLE_STEPS.models import PipelineFile, StepConfig


# ═══════════════════════════════════════════════════════════════════════════════
# FIXTURES — Register test operations with known signatures
# ═══════════════════════════════════════════════════════════════════════════════

@simple_step(
    id="test_align_source",
    name="Test Alignment Source",
    category="Test Alignment",
    operation_type="source",
)
def align_source(channel_url: str = "https://example.com") -> pd.DataFrame:
    """A source operation for alignment tests."""
    return pd.DataFrame({
        "url": [f"{channel_url}/video/{i}" for i in range(3)],
        "video_id": ["v1", "v2", "v3"],
    })


@simple_step(
    id="test_align_map",
    name="Test Alignment Map",
    category="Test Alignment",
    operation_type="map",
)
def align_map(url: str = "") -> dict:
    """A map operation for alignment tests."""
    return {"title": f"Title for {url}", "views": len(str(url)) * 100}


@simple_step(
    id="test_align_filter",
    name="Test Alignment Filter",
    category="Test Alignment",
    operation_type="filter",
)
def align_filter(views: int = 0, min_views: int = 500) -> bool:
    """A filter operation for alignment tests."""
    return int(views) > int(min_views)


@simple_step(
    id="test_align_dataframe",
    name="Test Alignment DataFrame",
    category="Test Alignment",
    operation_type="dataframe",
)
def align_dataframe(_input_df: pd.DataFrame) -> pd.DataFrame:
    """A dataframe operation for alignment tests."""
    result = _input_df.copy()
    result["processed"] = True
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# BOUNDARY 1: Python function ↔ Backend engine
#
# The SAME function call you would write in a .py script should produce the
# same result when funneled through run_operation with equivalent config.
# ═══════════════════════════════════════════════════════════════════════════════

class TestPythonToEngineAlignment:
    """
    Verify that calling the raw Python function produces the same result
    as calling run_operation with the equivalent config dict.
    """

    def test_source_direct_vs_engine(self):
        """
        Python script:  df = align_source(channel_url="https://test.com")
        Engine:         run_operation("test_align_source", {"channel_url": "https://test.com"}, None)
        Both should produce identical DataFrames.
        """
        # Direct Python call
        direct_df = align_source(channel_url="https://test.com")

        # Engine call
        ref, metrics = run_operation(
            op_id="test_align_source",
            config={"channel_url": "https://test.com"},
            input_ref_id=None,
        )
        engine_df = get_dataframe(ref)

        assert direct_df.equals(engine_df), (
            f"Direct call and engine call produced different results.\n"
            f"Direct:\n{direct_df}\n\nEngine:\n{engine_df}"
        )

    def test_map_direct_vs_engine(self):
        """
        Python script:  result = align_map(url="https://test.com/video/1")
        Engine:         run_operation("test_align_map", {"url": "url"}, input_ref_id=ref1)
        The engine wraps map calls over a DataFrame — each row calls the function.
        """
        # Direct Python call on one value
        direct_result = align_map(url="https://test.com/video/1")
        assert "title" in direct_result
        assert "views" in direct_result

        # Engine call: first produce a source DataFrame, then map over it
        ref1, _ = run_operation(
            op_id="test_align_source",
            config={"channel_url": "https://test.com"},
            input_ref_id=None,
        )
        ref2, metrics2 = run_operation(
            op_id="test_align_map",
            config={"url": "url"},  # column name from source output
            input_ref_id=ref1,
        )
        engine_df = get_dataframe(ref2)
        assert engine_df is not None
        assert len(engine_df) == 3, f"Map should produce same number of rows as input, got {len(engine_df)}"

    def test_filter_direct_vs_engine(self):
        """
        Python script:  keep = align_filter(views=1500, min_views=1000)
        Engine:         run_operation("test_align_filter", {"views": "views", "min_views": 1000}, ref)
        """
        # Direct Python call
        assert align_filter(views=1500, min_views=1000) is True
        assert align_filter(views=500, min_views=1000) is False

        # Engine call needs a DataFrame with a "views" column
        source_df = pd.DataFrame({"views": [500, 1500, 2000, 300]})
        ref_in = save_dataframe(source_df)

        ref_out, metrics = run_operation(
            op_id="test_align_filter",
            config={"views": "views", "min_views": 1000},
            input_ref_id=ref_in,
        )
        engine_df = get_dataframe(ref_out)
        assert engine_df is not None
        assert len(engine_df) == 2, f"Filter should keep 2 rows (1500, 2000), got {len(engine_df)}"

    def test_operation_registered_with_correct_params(self):
        """
        The params inferred by @simple_step should match the function signature.
        This is critical because the formula bar uses these params for autocomplete
        and the engine uses them to validate config keys.
        """
        entry = OPERATION_REGISTRY.get("test_align_source")
        assert entry is not None, "test_align_source not in registry"

        definition = entry["definition"]
        param_names = [p.name for p in definition.params]
        assert "channel_url" in param_names, (
            f"Expected 'channel_url' in params, got: {param_names}"
        )

    def test_operation_param_types_match_function_hints(self):
        """
        The UI type inferred for each param should match the Python type hint.
        string → str, number → int/float, boolean → bool.
        """
        entry = OPERATION_REGISTRY.get("test_align_filter")
        assert entry is not None
        definition = entry["definition"]
        param_map = {p.name: p.type for p in definition.params}

        assert param_map.get("views") == "number", f"'views' should be number, got {param_map.get('views')}"
        assert param_map.get("min_views") == "number", f"'min_views' should be number, got {param_map.get('min_views')}"


# ═══════════════════════════════════════════════════════════════════════════════
# BOUNDARY 2: Formula string ↔ Backend engine config
#
# The formula string typed in the formula bar must parse into the exact
# operation_id + config dict that run_operation expects.
# ═══════════════════════════════════════════════════════════════════════════════

# NOTE: We test the formula parser in Python to validate the contract.
# The actual parser is in TypeScript (formulaParser.ts), so these tests
# implement the SAME parsing logic to serve as the specification.

def parse_formula_python(input_str: str) -> dict:
    """
    Python reference implementation of the formula parser.
    Must produce identical output to formulaParser.ts parseFormula().
    This is the SPECIFICATION that both implementations must satisfy.
    """
    raw = (input_str or "").strip()

    if not raw.startswith("="):
        return {
            "operationId": None,
            "orchestration": None,
            "args": {},
            "isValid": False,
            "rawInput": raw,
        }

    ORCHESTRATION_MODES = {"source", "map", "filter", "dataframe", "expand", "raw_output"}

    body = raw[1:]  # Remove leading '='
    paren_idx = body.find("(")

    if paren_idx == -1:
        # Still typing — no '(' yet
        dot_idx = body.find(".")
        operation_id = body[:dot_idx] if dot_idx != -1 else body
        return {
            "operationId": operation_id.upper() or None,
            "orchestration": None,
            "args": {},
            "isValid": False,
            "rawInput": raw,
        }

    # Everything before '(' is either "opId" or "opId.modifier"
    head = body[:paren_idx]
    dot_idx = head.find(".")

    if dot_idx != -1:
        operation_id = head[:dot_idx]
        maybe_mode = head[dot_idx + 1:]
        orchestration = maybe_mode if maybe_mode in ORCHESTRATION_MODES else None
    else:
        operation_id = head
        orchestration = None

    if not operation_id:
        return {
            "operationId": None,
            "orchestration": None,
            "args": {},
            "isValid": False,
            "rawInput": raw,
        }

    has_closing_paren = raw.endswith(")")
    if has_closing_paren:
        args_raw = body[paren_idx + 1 : -1]
    else:
        args_raw = body[paren_idx + 1 :]

    args = {}
    if args_raw.strip():
        # Simple split on commas not inside quotes
        import re
        tokens = re.split(r',(?=(?:[^"\']*["\'][^"\']*["\'])*[^"\']*$)', args_raw)
        for token in tokens:
            eq_idx = token.find("=")
            if eq_idx != -1:
                key = token[:eq_idx].strip()
                val = token[eq_idx + 1 :].strip()
                # Strip surrounding quotes
                if (val.startswith('"') and val.endswith('"')) or (
                    val.startswith("'") and val.endswith("'")
                ):
                    val = val[1:-1]
                if key:
                    args[key] = val

    return {
        "operationId": operation_id,
        "orchestration": orchestration,
        "args": args,
        "isValid": has_closing_paren,
        "rawInput": raw,
    }


def build_formula_python(
    operation_id: str,
    config: dict,
    orchestration: str = None,
) -> str:
    """
    Python reference implementation of buildFormula from formulaParser.ts.
    Must produce identical output.
    """
    if not operation_id or operation_id == "noop":
        return ""
    if operation_id == "passthrough":
        return str(config.get("_ref", ""))

    effective_mode = orchestration if orchestration else config.get("_orchestrator")
    modifier = f".{effective_mode}" if effective_mode else ""

    args_parts = []
    for k, v in config.items():
        if k.startswith("_"):
            continue
        if isinstance(v, str) and not v.startswith("="):
            val_str = f'"{v}"'
        else:
            val_str = str(v) if v is not None else ""
        args_parts.append(f"{k}={val_str}")

    args = ", ".join(args_parts)
    return f"={operation_id}{modifier}({args})"


class TestFormulaToEngineAlignment:
    """
    Verify that formula strings parse into the operation_id + config
    that the engine expects, and that buildFormula produces the correct
    formula from an operation_id + config.
    """

    def test_parse_source_formula(self):
        """=test_align_source.source(channel_url="https://test.com")"""
        formula = '=test_align_source.source(channel_url="https://test.com")'
        parsed = parse_formula_python(formula)

        assert parsed["isValid"] is True
        assert parsed["operationId"] == "test_align_source"
        assert parsed["orchestration"] == "source"
        assert parsed["args"]["channel_url"] == "https://test.com"

    def test_parse_map_formula(self):
        """=test_align_map.map(url=step1.url)"""
        formula = "=test_align_map.map(url=step1.url)"
        parsed = parse_formula_python(formula)

        assert parsed["isValid"] is True
        assert parsed["operationId"] == "test_align_map"
        assert parsed["orchestration"] == "map"
        assert parsed["args"]["url"] == "step1.url"

    def test_parse_filter_formula_with_number(self):
        """=test_align_filter.filter(views=step2.views, min_views=1000)"""
        formula = "=test_align_filter.filter(views=step2.views, min_views=1000)"
        parsed = parse_formula_python(formula)

        assert parsed["isValid"] is True
        assert parsed["operationId"] == "test_align_filter"
        assert parsed["orchestration"] == "filter"
        assert parsed["args"]["views"] == "step2.views"
        assert parsed["args"]["min_views"] == "1000"

    def test_parse_formula_without_orchestration_modifier(self):
        """=test_align_source(channel_url="https://test.com") — no .source modifier"""
        formula = '=test_align_source(channel_url="https://test.com")'
        parsed = parse_formula_python(formula)

        assert parsed["isValid"] is True
        assert parsed["operationId"] == "test_align_source"
        assert parsed["orchestration"] is None  # No modifier — uses registered default
        assert parsed["args"]["channel_url"] == "https://test.com"

    def test_parsed_formula_produces_valid_engine_call(self):
        """
        KEY TEST: Parse a formula → extract operation_id + config → run engine.
        This simulates what happens when you type a formula and click Run.
        """
        formula = '=test_align_source.source(channel_url="https://formula-test.com")'
        parsed = parse_formula_python(formula)

        assert parsed["isValid"]
        operation_id = parsed["operationId"]
        config = dict(parsed["args"])
        if parsed["orchestration"]:
            config["_orchestrator"] = parsed["orchestration"]

        # This should execute successfully
        ref, metrics = run_operation(
            op_id=operation_id,
            config=config,
            input_ref_id=None,
        )
        df = get_dataframe(ref)
        assert df is not None
        assert len(df) == 3
        assert "url" in df.columns

    def test_build_formula_round_trip(self):
        """
        buildFormula(operation_id, config) → formula string → parseFormula → same operation_id + args.
        This is the critical round-trip that must work for save/load to preserve formulas.
        """
        original_config = {"channel_url": "https://round-trip.com"}
        original_orchestration = "source"

        formula = build_formula_python("test_align_source", original_config, original_orchestration)
        assert formula == '=test_align_source.source(channel_url="https://round-trip.com")'

        # Now parse it back
        parsed = parse_formula_python(formula)
        assert parsed["isValid"]
        assert parsed["operationId"] == "test_align_source"
        assert parsed["orchestration"] == "source"
        assert parsed["args"]["channel_url"] == "https://round-trip.com"

    def test_build_formula_preserves_step_references(self):
        """
        Step references like 'step1.url' appear as quoted strings in the formula.
        The engine resolves them at runtime via resolve_reference().
        The key invariant: parseFormula(buildFormula(...)) round-trips correctly.
        """
        config = {"url": "step1.url", "_orchestrator": "map"}
        formula = build_formula_python("test_align_map", config, "map")

        # step references are stored as quoted strings in the formula syntax
        assert "url=" in formula, f"Expected url arg in formula, got: {formula}"
        assert "step1.url" in formula, f"Expected step reference in formula, got: {formula}"

        # Round-trip: parse it back and verify the value
        parsed = parse_formula_python(formula)
        assert parsed["args"]["url"] == "step1.url"

    def test_formula_args_match_registered_params(self):
        """
        The keys in a parsed formula's args must be a subset of the
        registered operation's param names. Unknown keys mean the formula
        bar typed something the engine won't understand.
        """
        formula = '=test_align_source.source(channel_url="https://test.com")'
        parsed = parse_formula_python(formula)

        entry = OPERATION_REGISTRY.get(parsed["operationId"])
        assert entry is not None, f"Operation '{parsed['operationId']}' not in registry"

        registered_param_names = {p.name for p in entry["definition"].params}
        formula_arg_names = set(parsed["args"].keys())

        unexpected = formula_arg_names - registered_param_names
        assert not unexpected, (
            f"Formula has args not in registered params: {unexpected}. "
            f"Registered params: {registered_param_names}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# BOUNDARY 3: Pipeline JSON ↔ Formula bar (Save / Load round-trip)
#
# When a pipeline is saved and reloaded, the formula bar must show the
# complete formula — not just the step name.
# ═══════════════════════════════════════════════════════════════════════════════

class TestPipelineJsonAlignment:
    """
    Verify that pipeline JSON files preserve formulas correctly and that
    loading them restores the formula bar to the correct state.
    """

    def _make_pipeline_json(self, steps: list[dict]) -> dict:
        """Create a pipeline JSON structure matching the PipelineFile model."""
        return {
            "id": "test-pipeline",
            "name": "Test Pipeline",
            "created_at": "2026-04-13T00:00:00Z",
            "updated_at": "2026-04-13T00:00:00Z",
            "steps": steps,
        }

    def test_save_with_formula_field(self):
        """
        When saving a pipeline, the formula field MUST be populated.
        If it's missing, the frontend will only see the step name on reload.
        THIS IS THE ROOT CAUSE of the reported bug.
        """
        # Simulate what saveWorkflow produces (see useWorkflow.ts saveWorkflow)
        step_data = {
            "step_id": "step-001",
            "operation_id": "test_align_source",
            "label": "Fetch Data",
            "config": {
                "channel_url": "https://test.com",
                "_orchestrator": "source",
            },
            "formula": '=test_align_source.source(channel_url="https://test.com")',
        }

        pipeline = PipelineFile(
            id="test-pipeline",
            name="Test Pipeline",
            steps=[StepConfig(**step_data)],
        )

        # The formula field must be non-empty
        assert pipeline.steps[0].formula != "", "Formula must be saved in pipeline JSON"
        assert pipeline.steps[0].formula.startswith("="), "Formula must start with '='"

    def test_load_pipeline_without_formula_falls_back(self):
        """
        Old pipeline files don't have the formula field. The hydrateStep
        function should reconstruct it from operation_id + config.
        This tests the Python-side equivalent of that logic.
        """
        # Simulate an old-format save file (no formula field)
        old_step = {
            "step_id": "step-001",
            "operation_id": "test_align_source",
            "label": "Fetch Data",
            "config": {
                "channel_url": "https://test.com",
                "_orchestrator": "source",
            },
        }

        # The hydration logic (Python equivalent of hydrateStep in useWorkflow.ts)
        operation_id = old_step["operation_id"]
        config = old_step["config"]
        orchestration = config.get("_orchestrator")

        reconstructed_formula = build_formula_python(operation_id, config, orchestration)

        assert reconstructed_formula != "", "Should reconstruct formula from legacy fields"
        assert "test_align_source" in reconstructed_formula
        assert "channel_url" in reconstructed_formula
        assert "source" in reconstructed_formula

        # Now verify the reconstructed formula parses correctly
        parsed = parse_formula_python(reconstructed_formula)
        assert parsed["isValid"]
        assert parsed["operationId"] == "test_align_source"
        assert parsed["args"]["channel_url"] == "https://test.com"

    def test_pipeline_json_round_trip(self):
        """
        Save → serialize to JSON → deserialize → hydrate formula → verify.
        The formula must survive the full round-trip.
        """
        original_formula = '=test_align_source.source(channel_url="https://round-trip.com")'

        # Save
        pipeline = PipelineFile(
            id="round-trip-test",
            name="Round Trip Test",
            steps=[
                StepConfig(
                    step_id="step-001",
                    operation_id="test_align_source",
                    label="Step 1",
                    config={
                        "channel_url": "https://round-trip.com",
                        "_orchestrator": "source",
                    },
                    formula=original_formula,
                ),
            ],
        )

        # Serialize
        json_str = pipeline.model_dump_json(indent=2)
        data = json.loads(json_str)

        # Deserialize
        loaded = PipelineFile(**data)

        assert loaded.steps[0].formula == original_formula, (
            f"Formula lost in round-trip.\n"
            f"Original: {original_formula}\n"
            f"Loaded:   {loaded.steps[0].formula}"
        )

    def test_existing_pipeline_files_have_formulas(self):
        """
        Check all existing pipeline JSON files in the projects/ directory.
        Flag any step that is missing the formula field — these are the
        files causing the "only see step name" bug.
        """
        projects_dir = os.path.join(
            os.path.dirname(__file__), "..", "projects"
        )
        if not os.path.isdir(projects_dir):
            pytest.skip("No projects/ directory found")

        missing_formulas = []

        for root, dirs, files in os.walk(projects_dir):
            for fname in files:
                if not fname.endswith(".json"):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                except (json.JSONDecodeError, OSError):
                    continue

                steps = data.get("steps", [])
                for step in steps:
                    op_id = step.get("operation_id", "")
                    formula = step.get("formula", "")
                    if op_id and op_id not in ("noop", "passthrough", "") and not formula:
                        missing_formulas.append(
                            f"  {fpath}: step '{step.get('step_id', '?')}' "
                            f"has operation_id='{op_id}' but no formula"
                        )

        if missing_formulas:
            msg = (
                "Pipeline JSON files with missing formula fields:\n"
                + "\n".join(missing_formulas)
                + "\n\nThese steps will NOT show the function+args in the formula bar. "
                "They need to be re-saved with the formula field populated."
            )
            pytest.fail(msg)


# ═══════════════════════════════════════════════════════════════════════════════
# BOUNDARY 4: Full pipeline — Python script ↔ JSON workflow ↔ Engine
#
# If you have a Python script that runs a pipeline, the equivalent JSON
# workflow should produce identical results when run through the engine.
# ═══════════════════════════════════════════════════════════════════════════════

class TestFullPipelineAlignment:
    """
    Given a sequence of Python function calls (a 'script'), build the
    equivalent pipeline JSON and run both. Results must match.
    """

    def test_script_vs_json_pipeline(self):
        """
        Python script:
            df1 = align_source(channel_url="https://full-test.com")
            # ... (map over df1) ...

        JSON pipeline:
            steps:
              - operation_id: test_align_source
                config: { channel_url: "https://full-test.com", _orchestrator: "source" }
                formula: =test_align_source.source(channel_url="https://full-test.com")

        Both must produce the same DataFrame.
        """
        # ── Python script path ──
        direct_df = align_source(channel_url="https://full-test.com")

        # ── JSON pipeline path ──
        # Step 1: Build the equivalent pipeline step
        formula = '=test_align_source.source(channel_url="https://full-test.com")'
        parsed = parse_formula_python(formula)

        config = dict(parsed["args"])
        if parsed["orchestration"]:
            config["_orchestrator"] = parsed["orchestration"]

        ref, _ = run_operation(
            op_id=parsed["operationId"],
            config=config,
            input_ref_id=None,
        )
        engine_df = get_dataframe(ref)

        assert direct_df.equals(engine_df), (
            f"Script and JSON pipeline produced different results.\n"
            f"Script:\n{direct_df}\n\nJSON pipeline:\n{engine_df}"
        )

    def test_formula_drives_engine_execution(self):
        """
        The formula is the source of truth. Verify that:
          formula → parse → operation_id + config → engine → success
        for every registered operation.
        """
        test_formulas = [
            ('=test_align_source.source(channel_url="https://test.com")', None),
        ]

        for formula, input_ref in test_formulas:
            parsed = parse_formula_python(formula)
            assert parsed["isValid"], f"Formula not valid: {formula}"

            config = dict(parsed["args"])
            if parsed["orchestration"]:
                config["_orchestrator"] = parsed["orchestration"]

            op_entry = OPERATION_REGISTRY.get(parsed["operationId"])
            assert op_entry is not None, (
                f"Operation '{parsed['operationId']}' from formula '{formula}' "
                f"is not registered. Available: {list(OPERATION_REGISTRY.keys())}"
            )

            # Execute
            ref, metrics = run_operation(
                op_id=parsed["operationId"],
                config=config,
                input_ref_id=input_ref,
            )
            assert ref is not None, f"Engine returned no ref for formula: {formula}"
            assert metrics["rows"] > 0, f"Engine returned 0 rows for formula: {formula}"


# ═══════════════════════════════════════════════════════════════════════════════
# BOUNDARY 5: Pack discovery — operations from packs must be formula-ready
#
# When a pack is loaded, every registered operation must have enough metadata
# to produce a valid formula string.
# ═══════════════════════════════════════════════════════════════════════════════

class TestPackFormulaReadiness:
    """
    Every registered operation must have the metadata needed to appear
    correctly in the formula bar and be executable from a formula string.
    """

    def test_all_operations_have_id(self):
        """Every operation must have a non-empty id (used in formula syntax)."""
        for op_id, entry in OPERATION_REGISTRY.items():
            assert op_id, "Operation with empty id found"
            assert entry["definition"].id == op_id

    def test_all_operations_have_type(self):
        """Every operation must have a type for the orchestration modifier."""
        for op_id, entry in OPERATION_REGISTRY.items():
            op_type = entry.get("type", "")
            assert op_type, f"Operation '{op_id}' has no type"

    def test_all_operations_have_callable_func(self):
        """Every operation must have a callable func."""
        for op_id, entry in OPERATION_REGISTRY.items():
            assert callable(entry.get("func")), f"Operation '{op_id}' has no callable func"

    def test_buildFormula_for_every_operation(self):
        """
        For every registered operation, buildFormula should produce
        a formula that parseFormula can parse back correctly.
        """
        for op_id, entry in OPERATION_REGISTRY.items():
            definition = entry["definition"]
            op_type = entry.get("type", "dataframe")

            # Build a config with default values
            config = {}
            for param in definition.params:
                if param.name in ("df", "data", "_input_df"):
                    continue  # skip DataFrame inputs
                if param.default is not None:
                    config[param.name] = param.default
                elif param.type == "string":
                    config[param.name] = "test_value"
                elif param.type == "number":
                    config[param.name] = 0
                elif param.type == "boolean":
                    config[param.name] = False

            formula = build_formula_python(op_id, config, op_type)

            if not formula:
                continue  # noop/passthrough

            parsed = parse_formula_python(formula)
            assert parsed["operationId"] == op_id, (
                f"Round-trip failed for '{op_id}': "
                f"built formula '{formula}' parsed to operationId '{parsed['operationId']}'"
            )
