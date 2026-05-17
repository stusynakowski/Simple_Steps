"""
Tests for the safe AST-based formula interpreter.
"""
import pandas as pd
import pytest

from SIMPLE_STEPS.decorators import simple_step, OPERATION_REGISTRY
from SIMPLE_STEPS.safe_formula import (
    FormulaError,
    parse,
    validate,
    run_formula,
    describe,
)


# ── A tiny set of test ops, registered once for the module ────────────────
@simple_step(id="sf_upper", category="Test")
def sf_upper(text: str) -> str:
    """Uppercase a string."""
    return text.upper()


@simple_step(id="sf_add", category="Test")
def sf_add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


@simple_step(id="sf_length", category="Test")
def sf_length(text: str) -> int:
    return len(text)


@simple_step(id="sf_concat", category="Test")
def sf_concat(a: str, b: str) -> str:
    return f"{a}{b}"


# ── Fixtures ──────────────────────────────────────────────────────────────
@pytest.fixture
def df1():
    return pd.DataFrame({"name": ["alice", "bob"], "score": [10, 20]})


@pytest.fixture
def steps(df1):
    return {"step1": df1}


# ── Parsing & validation ──────────────────────────────────────────────────
def test_parse_strips_equals():
    tree = parse("=sf_upper(text='hi')")
    assert tree is not None


def test_parse_empty_raises():
    with pytest.raises(FormulaError):
        parse("")
    with pytest.raises(FormulaError):
        parse("=")


def test_validate_accepts_simple_call(steps):
    errs = validate("=sf_upper(text=step1.name)", available_steps={"step1"})
    assert errs == []


def test_validate_accepts_nested_calls(steps):
    errs = validate(
        "=sf_concat(a=sf_upper(text=step1.name), b='!')",
        available_steps={"step1"},
    )
    assert errs == []


def test_validate_rejects_unknown_op():
    errs = validate("=does_not_exist(x=1)", available_steps=set())
    assert any("Unknown operation" in e for e in errs)


def test_validate_rejects_method_calls():
    errs = validate("=step1.name.upper()", available_steps={"step1"})
    assert any("direct calls" in e.message.lower() or "method" in e.message.lower() for e in errs)


def test_validate_rejects_dunder_attribute():
    errs = validate("=sf_upper(text=step1.__class__)", available_steps={"step1"})
    assert any("Private/dunder" in e for e in errs)


def test_validate_rejects_import_attempt():
    # __import__ parses as a Name; not in registry → rejected
    errs = validate("=__import__('os')", available_steps=set())
    assert errs  # any error is fine


def test_validate_rejects_lambda():
    errs = validate("=sf_add(a=1, b=(lambda: 2)())", available_steps=set())
    assert any("Disallowed syntax" in e for e in errs)


def test_validate_rejects_comprehension():
    errs = validate("=sf_add(a=[x for x in [1,2]], b=0)", available_steps=set())
    assert any("Disallowed syntax" in e for e in errs)


def test_validate_rejects_star_args():
    errs = validate("=sf_add(*[1,2])", available_steps=set())
    assert any("unpacking" in e.message.lower() for e in errs)


def test_validate_rejects_unknown_step_attribute_target():
    errs = validate("=sf_upper(text=stepX.foo)", available_steps={"step1"})
    assert any("step references" in e for e in errs) or any("Unknown name" in e for e in errs)


# ── Execution ─────────────────────────────────────────────────────────────
def test_run_simple_call_on_column(steps):
    # Broadcasting over a ColumnProxy returns a StepProxy whose DataFrame
    # contains the original columns plus an "<op>_output" column.
    result = run_formula("=sf_upper(text=step1.name)", steps=steps)
    df = result.df
    assert list(df["sf_upper_output"]) == ["ALICE", "BOB"]
    assert set(df.columns) >= {"name", "score", "sf_upper_output"}


def test_run_nested_call_scalar():
    # Nested calls work cleanly when all leaves are literals (no broadcast).
    result = run_formula("=sf_concat(a=sf_upper(text='hi'), b='!')", steps={})
    assert result == "HI!"


def test_run_literal_args():
    result = run_formula("=sf_add(a=2, b=3)", steps={})
    assert result == 5


def test_run_with_subscript(steps):
    result = run_formula("=sf_upper(text=step1['name'])", steps=steps)
    assert list(result.df["sf_upper_output"]) == ["ALICE", "BOB"]


def test_run_passthrough_step_ref(steps):
    # Bare step ref returns the StepProxy itself.
    result = run_formula("=step1", steps=steps)
    assert list(result.columns) == ["name", "score"]


def test_run_rejects_eval_attack():
    with pytest.raises(FormulaError):
        run_formula("=__import__('os').system('echo hi')", steps={})


def test_run_rejects_method_call(steps):
    with pytest.raises(FormulaError):
        run_formula("=step1.name.upper()", steps=steps)


# ── Describe (for the UI) ─────────────────────────────────────────────────
def test_describe_returns_top_level_op():
    info = describe("=sf_concat(a=sf_upper(text=step1.name), b='!')")
    assert info["valid"] is True
    assert info["top_level_op"] == "sf_concat"
    ops = [c["op"] for c in info["calls"]]
    assert "sf_concat" in ops and "sf_upper" in ops
    assert "step1.name" in info["step_refs"]


def test_describe_handles_syntax_error():
    info = describe("=sf_upper(text=")
    assert info["valid"] is False
    assert info["errors"]


# ── Arithmetic & comparison operators ────────────────────────────────────
def test_run_arithmetic_in_kwargs():
    # +, -, *, /, //, %, ** as arguments to a registered op
    assert run_formula("=sf_add(a=2+3, b=4*5)", steps={}) == 25
    assert run_formula("=sf_add(a=10-3, b=2**3)", steps={}) == 15
    assert run_formula("=sf_add(a=10//3, b=10%3)", steps={}) == 4


def test_run_arithmetic_top_level():
    # Top-level expression need not be a call.
    assert run_formula("=2 + 3 * 4", steps={}) == 14


def test_run_comparison():
    assert run_formula("=sf_add(a=1, b=1)", steps={}) == 2
    # Comparison as top-level
    assert run_formula("=10 > 3", steps={}) is True
    assert run_formula("=10 == 11", steps={}) is False


def test_validate_rejects_chained_comparison_at_runtime():
    # Validate allows it (it's valid syntax), but interpret rejects it
    # to avoid pandas truthiness issues.
    with pytest.raises(FormulaError):
        run_formula("=1 < 2 < 3", steps={})


# ── Signature-aware validation ───────────────────────────────────────────
def test_validate_unknown_kwarg():
    errs = validate("=sf_add(a=1, b=2, c=3)", available_steps=set())
    codes = {e.code for e in errs}
    assert "unknown_kwarg" in codes


def test_validate_missing_required_kwarg():
    errs = validate("=sf_add(a=1)", available_steps=set())
    codes = {e.code for e in errs}
    assert "missing_required" in codes


def test_validate_too_many_positional():
    errs = validate("=sf_add(1, 2, 3)", available_steps=set())
    codes = {e.code for e in errs}
    assert "too_many_positional" in codes


def test_validate_clean_call_has_no_diagnostics():
    errs = validate("=sf_add(a=1, b=2)", available_steps=set())
    assert errs == []


# ── Diagnostic offsets (for UI squiggles) ────────────────────────────────
def test_diagnostics_carry_offsets():
    errs = validate("=does_not_exist(x=1)", available_steps=set())
    assert errs
    # At least one diagnostic should pinpoint a character range.
    assert any(
        e.col_offset is not None and e.end_col_offset is not None
        for e in errs
    )


def test_diagnostic_to_dict_shape():
    errs = validate("=does_not_exist(x=1)", available_steps=set())
    d = errs[0].to_dict()
    assert set(d.keys()) >= {"message", "code", "col_offset", "end_col_offset"}
