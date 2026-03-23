"""
OperationPack — failsafe registration of a set of related operations.

A developer creates a Pack to bundle related functions with:
  - Dependency validation (missing packages caught at import, not at runtime)
  - Input/output contract declarations (what shape of data goes in/out)
  - Health checks (verify API keys, DB connections, etc.)
  - Graceful degradation (individual ops can be marked unavailable without
    crashing the entire backend)

Usage:

    from SIMPLE_STEPS.operation_pack import OperationPack

    pack = OperationPack(
        name="YouTube Analysis",
        version="1.0.0",
        description="Fetch, enrich, and analyze YouTube channel data.",
        required_packages=["google-api-python-client", "pandas"],
        required_env_vars=["YOUTUBE_API_KEY"],
    )

    @pack.step(id="yt_fetch", name="Fetch Videos", operation_type="source")
    def fetch_videos(channel_url: str) -> list:
        ...

    @pack.step(id="yt_enrich", name="Enrich Metadata", operation_type="map")
    def enrich(url: str) -> dict:
        ...

    # At the bottom of the file — this triggers registration + validation
    pack.register()
"""

from __future__ import annotations

import os
import inspect
import traceback
from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Sequence,
    Tuple,
)

from .decorators import simple_step, register_operation, OPERATION_REGISTRY
from .models import OperationDefinition


# ── Health‐check result ─────────────────────────────────────────────────────

@dataclass
class HealthStatus:
    ok: bool
    checks: Dict[str, bool] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)

    def summary(self) -> str:
        if self.ok:
            return "✅ All checks passed"
        return "❌ " + "; ".join(self.errors)


# ── Deferred step descriptor ────────────────────────────────────────────────

@dataclass
class _DeferredStep:
    """Holds metadata about a function until pack.register() is called."""
    func: Callable
    op_id: str
    name: str
    category: str                 # will be overridden by pack.name if not set
    operation_type: str
    description: Optional[str]
    params: Optional[list]        # explicit params or None → infer
    input_contract: Optional[Dict[str, str]]   # {col_name: expected_dtype}
    output_contract: Optional[Dict[str, str]]


# ── Global pack registry (all packs that have been .register()'d) ───────────

PACK_REGISTRY: Dict[str, "OperationPack"] = {}


# ── The Pack ─────────────────────────────────────────────────────────────────

class OperationPack:
    """
    A failsafe bundle of related operations.

    Lifecycle:
      1. Instantiate:   pack = OperationPack(name=..., ...)
      2. Decorate:      @pack.step(...)  def my_func(): ...
      3. Register:      pack.register()   ← validates deps, registers ops

    If any required package or env var is missing, registration still succeeds
    but affected operations are marked *unavailable* with a human‐readable
    reason.  The UI can display them grayed‐out instead of crashing the backend.
    """

    def __init__(
        self,
        name: str,
        version: str = "0.1.0",
        description: str = "",
        required_packages: Optional[List[str]] = None,
        required_env_vars: Optional[List[str]] = None,
        health_checks: Optional[List[Callable[[], Tuple[bool, str]]]] = None,
    ):
        self.name = name
        self.version = version
        self.description = description
        self.required_packages = required_packages or []
        self.required_env_vars = required_env_vars or []
        self.health_checks = health_checks or []

        self._deferred: List[_DeferredStep] = []
        self._registered = False
        self._available = True
        self._unavailable_reason: Optional[str] = None
        self._registered_ops: List[str] = []   # op IDs successfully registered

    # ── Decorator ────────────────────────────────────────────────────────

    def step(
        self,
        id: str,
        name: str,
        operation_type: str = "map",
        category: Optional[str] = None,
        description: Optional[str] = None,
        params: Optional[list] = None,
        input_contract: Optional[Dict[str, str]] = None,
        output_contract: Optional[Dict[str, str]] = None,
    ):
        """
        Decorator that queues a function for registration when
        ``pack.register()`` is called.

        Parameters
        ----------
        id : str
            Unique operation ID used in the formula bar.
        name : str
            Human-readable label shown in the UI.
        operation_type : str
            Default orchestration mode (source, map, filter, expand,
            dataframe, raw_output).
        category : str, optional
            Sidebar group. Defaults to ``self.name``.
        description : str, optional
            Overrides the function docstring.
        params : list, optional
            Explicit param list. If None, inferred from type hints.
        input_contract : dict, optional
            Expected input columns and their dtypes,
            e.g. ``{"url": "str", "views": "int"}``.
        output_contract : dict, optional
            Promised output columns and their dtypes.
        """
        def decorator(func: Callable) -> Callable:
            self._deferred.append(_DeferredStep(
                func=func,
                op_id=id,
                name=name,
                category=category or self.name,
                operation_type=operation_type,
                description=description,
                params=params,
                input_contract=input_contract,
                output_contract=output_contract,
            ))
            return func   # return unmodified — same as @simple_step
        return decorator

    # ── Registration ─────────────────────────────────────────────────────

    def register(self) -> HealthStatus:
        """
        Validate dependencies and register all queued operations.

        Returns a HealthStatus so the caller (or the plugin loader) can
        log/surface any issues.
        """
        if self._registered:
            return self.health()

        status = self._validate()

        if not status.ok:
            # Mark the whole pack unavailable but *don't crash*.
            self._available = False
            self._unavailable_reason = status.summary()
            print(f"  ⚠️  Pack '{self.name}' v{self.version}: {self._unavailable_reason}")
            # Still register stubs so the UI can show them grayed-out
            for ds in self._deferred:
                self._register_one(ds, available=False)
        else:
            print(f"  📦 Pack '{self.name}' v{self.version}: {len(self._deferred)} operations")
            for ds in self._deferred:
                self._register_one(ds, available=True)

        self._registered = True
        PACK_REGISTRY[self.name] = self
        return status

    def _register_one(self, ds: _DeferredStep, available: bool) -> None:
        """Register a single deferred step into the global registry."""
        try:
            if available:
                # Wrap with contract validation if contracts are declared
                wrapped = self._wrap_with_contracts(ds) if (ds.input_contract or ds.output_contract) else ds.func
            else:
                # Replace the function with an error stub
                reason = self._unavailable_reason or "Pack dependencies not met"
                def _unavailable_stub(**kwargs):
                    raise RuntimeError(
                        f"Operation '{ds.op_id}' is unavailable: {reason}"
                    )
                wrapped = _unavailable_stub

            register_operation(
                func=wrapped,
                op_id=ds.op_id,
                name=ds.name,
                category=ds.category,
                operation_type=ds.operation_type,
                params=ds.params,
                description=ds.description or (ds.func.__doc__ if available else f"[UNAVAILABLE] {reason}"),
            )
            self._registered_ops.append(ds.op_id)
        except Exception as e:
            print(f"    ❌ Failed to register '{ds.op_id}': {e}")
            traceback.print_exc()

    # ── Contract wrapper ─────────────────────────────────────────────────

    def _wrap_with_contracts(self, ds: _DeferredStep) -> Callable:
        """
        Return a wrapper that validates input/output DataFrames against
        the declared contracts before/after calling the real function.
        """
        import pandas as pd

        func = ds.func
        input_contract = ds.input_contract
        output_contract = ds.output_contract
        func_sig = inspect.signature(func)
        func_params = set(func_sig.parameters.keys())

        def _validated(*args, **kwargs):
            # ── Map engine-injected _input_df to the function's DF param ──
            if '_input_df' in kwargs and '_input_df' not in func_params:
                df_arg = kwargs.pop('_input_df')
                # Inject as the conventional df/data parameter
                for name in ('df', 'data', '_input_df'):
                    if name in func_params:
                        kwargs[name] = df_arg
                        break
                else:
                    # If no conventional name, try the first DataFrame-annotated param
                    for pname, p in func_sig.parameters.items():
                        if p.annotation is pd.DataFrame:
                            kwargs[pname] = df_arg
                            break

            # ── Filter kwargs to only what the function accepts ──────
            # (avoid "unexpected keyword argument" errors)
            if not any(
                p.kind == inspect.Parameter.VAR_KEYWORD
                for p in func_sig.parameters.values()
            ):
                kwargs = {k: v for k, v in kwargs.items() if k in func_params}

            # ── Validate input ──────────────────────────────────────
            if input_contract:
                df_in = None
                for v in kwargs.values():
                    if isinstance(v, pd.DataFrame):
                        df_in = v
                        break
                if df_in is not None:
                    missing = [
                        col for col in input_contract
                        if col not in df_in.columns
                    ]
                    if missing:
                        raise ValueError(
                            f"[{ds.op_id}] Input contract violation: "
                            f"missing columns {missing}. "
                            f"Available: {list(df_in.columns)}"
                        )

            # ── Call the real function ───────────────────────────────
            result = func(*args, **kwargs)

            # ── Validate output ─────────────────────────────────────
            if output_contract and isinstance(result, pd.DataFrame):
                missing = [
                    col for col in output_contract
                    if col not in result.columns
                ]
                if missing:
                    raise ValueError(
                        f"[{ds.op_id}] Output contract violation: "
                        f"promised columns {missing} not in result. "
                        f"Got: {list(result.columns)}"
                    )

            return result

        # Preserve function metadata for introspection
        _validated.__name__ = func.__name__
        _validated.__doc__ = func.__doc__
        _validated.__module__ = func.__module__
        try:
            _validated.__annotations__ = func.__annotations__
            _validated.__wrapped__ = func  # type: ignore
        except Exception:
            pass

        return _validated

    # ── Validation ───────────────────────────────────────────────────────

    def _validate(self) -> HealthStatus:
        """Check packages, env vars, and custom health checks."""
        checks: Dict[str, bool] = {}
        errors: List[str] = []

        # 1. Python packages
        for pkg in self.required_packages:
            try:
                __import__(pkg.replace("-", "_"))
                checks[f"pkg:{pkg}"] = True
            except ImportError:
                checks[f"pkg:{pkg}"] = False
                errors.append(f"Missing package: {pkg}  →  pip install {pkg}")

        # 2. Environment variables
        for var in self.required_env_vars:
            val = os.environ.get(var)
            if val:
                checks[f"env:{var}"] = True
            else:
                checks[f"env:{var}"] = False
                errors.append(f"Missing env var: {var}")

        # 3. Custom health checks
        for check_fn in self.health_checks:
            try:
                ok, msg = check_fn()
                label = getattr(check_fn, "__name__", "custom_check")
                checks[label] = ok
                if not ok:
                    errors.append(msg)
            except Exception as e:
                label = getattr(check_fn, "__name__", "custom_check")
                checks[label] = False
                errors.append(f"{label} raised: {e}")

        return HealthStatus(ok=len(errors) == 0, checks=checks, errors=errors)

    # ── Public introspection ─────────────────────────────────────────────

    def health(self) -> HealthStatus:
        """Re-run all validation checks."""
        return self._validate()

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def operation_ids(self) -> List[str]:
        return list(self._registered_ops)

    def __repr__(self) -> str:
        status = "available" if self._available else "UNAVAILABLE"
        return (
            f"<OperationPack '{self.name}' v{self.version} "
            f"[{len(self._deferred)} ops, {status}]>"
        )
