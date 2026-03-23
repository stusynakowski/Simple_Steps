"""
Tests for OperationPack — validates the failsafe registration pattern.
"""
import os
import sys
import pytest
import pandas as pd

# Ensure src/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from SIMPLE_STEPS.operation_pack import OperationPack, PACK_REGISTRY
from SIMPLE_STEPS.decorators import OPERATION_REGISTRY
from SIMPLE_STEPS.engine import run_operation, save_dataframe


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_pack(**overrides) -> OperationPack:
    defaults = dict(
        name=f"Test Pack {id(overrides)}",
        version="0.0.1",
        description="A test pack",
        required_packages=["pandas"],       # should always pass
        required_env_vars=[],
    )
    defaults.update(overrides)
    return OperationPack(**defaults)


# ── Test: basic registration ─────────────────────────────────────────────────

class TestBasicRegistration:
    def test_step_decorator_queues_without_registering(self):
        pack = _make_pack(name="Queue Test")

        @pack.step(id="q_test_op", name="Q Test", operation_type="source")
        def dummy() -> list:
            return [1, 2, 3]

        # Before .register() the op should NOT be in the global registry
        assert "q_test_op" not in OPERATION_REGISTRY

    def test_register_puts_ops_in_global_registry(self):
        pack = _make_pack(name="Register Test")

        @pack.step(id="reg_test_op", name="Reg Test", operation_type="source")
        def dummy() -> list:
            return [1, 2, 3]

        status = pack.register()
        assert status.ok
        assert "reg_test_op" in OPERATION_REGISTRY
        assert pack.name in PACK_REGISTRY
        assert pack.is_available

    def test_registered_function_is_executable_via_engine(self):
        pack = _make_pack(name="Engine Test")

        @pack.step(id="eng_test_source", name="Engine Source", operation_type="source")
        def make_data() -> pd.DataFrame:
            return pd.DataFrame({"x": [10, 20, 30]})

        pack.register()

        out_ref, metrics = run_operation("eng_test_source", {}, input_ref_id=None)
        assert metrics["rows"] == 3
        assert "x" in metrics["columns"]


# ── Test: dependency validation ──────────────────────────────────────────────

class TestDependencyValidation:
    def test_missing_package_marks_pack_unavailable(self):
        pack = _make_pack(
            name="Missing Pkg Pack",
            required_packages=["nonexistent_pkg_xyz_99"],
        )

        @pack.step(id="mp_test_op", name="MP Test", operation_type="source")
        def dummy() -> list:
            return [1]

        status = pack.register()
        assert not status.ok
        assert not pack.is_available
        assert "nonexistent_pkg_xyz_99" in status.errors[0]

    def test_unavailable_op_raises_on_execution(self):
        pack = _make_pack(
            name="Unavail Exec Pack",
            required_packages=["nonexistent_pkg_abc_42"],
        )

        @pack.step(id="ue_test_op", name="UE Test", operation_type="source")
        def dummy() -> list:
            return [1]

        pack.register()

        # The op IS in the registry (so the UI can show it) but calling it raises
        assert "ue_test_op" in OPERATION_REGISTRY
        with pytest.raises(Exception, match="unavailable"):
            run_operation("ue_test_op", {}, input_ref_id=None)

    def test_missing_env_var_marks_pack_unavailable(self):
        # Make sure the var is NOT set
        os.environ.pop("__TEST_MISSING_VAR__", None)

        pack = _make_pack(
            name="Missing Env Pack",
            required_env_vars=["__TEST_MISSING_VAR__"],
        )

        @pack.step(id="me_test_op", name="ME Test", operation_type="source")
        def dummy() -> list:
            return [1]

        status = pack.register()
        assert not status.ok
        assert any("__TEST_MISSING_VAR__" in e for e in status.errors)

    def test_env_var_present_passes(self):
        os.environ["__TEST_PRESENT_VAR__"] = "some_key"

        pack = _make_pack(
            name="Present Env Pack",
            required_env_vars=["__TEST_PRESENT_VAR__"],
        )

        @pack.step(id="pe_test_op", name="PE Test", operation_type="source")
        def dummy() -> list:
            return [42]

        status = pack.register()
        assert status.ok
        assert pack.is_available

        # Cleanup
        del os.environ["__TEST_PRESENT_VAR__"]


# ── Test: input / output contracts ───────────────────────────────────────────

class TestContracts:
    def test_input_contract_passes_with_correct_columns(self):
        pack = _make_pack(name="Input OK Pack")

        @pack.step(
            id="ic_ok_op",
            name="IC OK",
            operation_type="dataframe",
            input_contract={"url": "str"},
        )
        def process(df: pd.DataFrame) -> pd.DataFrame:
            df = df.copy()
            df["processed"] = True
            return df

        pack.register()

        df_in = pd.DataFrame({"url": ["http://a.com", "http://b.com"]})
        ref_in = save_dataframe(df_in)
        out_ref, metrics = run_operation("ic_ok_op", {}, input_ref_id=ref_in)
        assert metrics["rows"] == 2

    def test_input_contract_fails_with_missing_columns(self):
        pack = _make_pack(name="Input Fail Pack")

        @pack.step(
            id="ic_fail_op",
            name="IC Fail",
            operation_type="dataframe",
            input_contract={"url": "str", "views": "int"},
        )
        def process(df: pd.DataFrame) -> pd.DataFrame:
            return df

        pack.register()

        # Pass a DF that's missing "views"
        df_in = pd.DataFrame({"url": ["http://a.com"]})
        ref_in = save_dataframe(df_in)
        with pytest.raises(Exception, match="Input contract violation"):
            run_operation("ic_fail_op", {}, input_ref_id=ref_in)

    def test_output_contract_fails_when_columns_missing(self):
        pack = _make_pack(name="Output Fail Pack")

        @pack.step(
            id="oc_fail_op",
            name="OC Fail",
            operation_type="dataframe",
            output_contract={"result_col": "str"},
        )
        def process(df: pd.DataFrame) -> pd.DataFrame:
            # Intentionally does NOT add 'result_col'
            return df

        pack.register()

        df_in = pd.DataFrame({"x": [1]})
        ref_in = save_dataframe(df_in)
        with pytest.raises(Exception, match="Output contract violation"):
            run_operation("oc_fail_op", {}, input_ref_id=ref_in)


# ── Test: custom health checks ──────────────────────────────────────────────

class TestCustomHealthChecks:
    def test_custom_check_passes(self):
        def check_db() -> tuple:
            return (True, "DB connection OK")

        pack = _make_pack(
            name="Custom Check OK Pack",
            health_checks=[check_db],
        )

        @pack.step(id="cc_ok_op", name="CC OK", operation_type="source")
        def dummy() -> list:
            return [1]

        status = pack.register()
        assert status.ok

    def test_custom_check_fails(self):
        def check_api_key() -> tuple:
            return (False, "OpenAI API key is invalid or expired")

        pack = _make_pack(
            name="Custom Check Fail Pack",
            health_checks=[check_api_key],
        )

        @pack.step(id="cc_fail_op", name="CC Fail", operation_type="source")
        def dummy() -> list:
            return [1]

        status = pack.register()
        assert not status.ok
        assert "OpenAI API key" in status.errors[0]
        assert not pack.is_available

    def test_custom_check_exception_is_caught(self):
        def check_explode() -> tuple:
            raise ConnectionError("Cannot reach server")

        pack = _make_pack(
            name="Custom Check Explode Pack",
            health_checks=[check_explode],
        )

        @pack.step(id="cc_ex_op", name="CC EX", operation_type="source")
        def dummy() -> list:
            return [1]

        # Should NOT raise — the exception is caught and reported
        status = pack.register()
        assert not status.ok
        assert "Cannot reach server" in status.errors[0]


# ── Test: pack introspection ─────────────────────────────────────────────────

class TestIntrospection:
    def test_operation_ids_populated_after_register(self):
        pack = _make_pack(name="Introspect Pack")

        @pack.step(id="intr_a", name="A", operation_type="source")
        def a() -> list:
            return []

        @pack.step(id="intr_b", name="B", operation_type="map")
        def b(x: str) -> dict:
            return {"x": x}

        pack.register()
        assert set(pack.operation_ids) == {"intr_a", "intr_b"}

    def test_repr(self):
        pack = _make_pack(name="Repr Pack")

        @pack.step(id="repr_op", name="R", operation_type="source")
        def dummy() -> list:
            return []

        pack.register()
        r = repr(pack)
        assert "Repr Pack" in r
        assert "1 ops" in r
        assert "available" in r
