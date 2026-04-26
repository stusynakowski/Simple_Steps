#!/usr/bin/env bash
# run_checks.sh — Local dev workflow (mirrors CI)
# Usage:
#   ./run_checks.sh            # run all checks
#   ./run_checks.sh backend    # only backend checks
#   ./run_checks.sh frontend   # only frontend checks
#   ./run_checks.sh lint       # only linters
#   ./run_checks.sh precommit  # commit-safe checks (skip backend ruff)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

# ─── Resolve Python and Node from simple_steps conda env if available ─────────
CONDA_ENV_NAME="${CONDA_ENV_NAME:-simple_steps}"
CONDA_BASE="${CONDA_BASE:-/home/stu/anaconda3}"
CONDA_ENV_BIN="$CONDA_BASE/envs/$CONDA_ENV_NAME/bin"

if [[ -x "$CONDA_ENV_BIN/python" ]]; then
    PYTHON_BIN="${PYTHON_BIN:-$CONDA_ENV_BIN/python}"
else
    PYTHON_BIN="${PYTHON_BIN:-python3}"
fi

if [[ -x "$CONDA_ENV_BIN/node" ]]; then
    export PATH="$CONDA_ENV_BIN:$PATH"
fi

VENV_DIR="$REPO_ROOT/.venv"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

_header() { echo -e "\n${CYAN}${BOLD}==> $1${NC}"; }
_ok()     { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)) || true; }
_err()    { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)) || true; }
_skip()   { echo -e "  ${YELLOW}~${NC} $1 (skipped)"; ((SKIP++)) || true; }

run_step() {
    local label="$1"; shift
    if "$@" ; then
        _ok "$label"
    else
        _err "$label"
    fi
}

# ─── Python env ──────────────────────────────────────────────────────────────

check_python_env() {
    _header "Python environment"

    if [[ -f "$VENV_DIR/bin/activate" ]]; then
        # shellcheck source=/dev/null
        source "$VENV_DIR/bin/activate"
        _ok "venv activated ($VENV_DIR)"
    else
        _skip "No .venv found — using system Python ($PYTHON_BIN)"
    fi

    run_step "Package installed (simple-steps)" \
        "$PYTHON_BIN" -c "import SIMPLE_STEPS" 2>/dev/null || \
        { echo "    Installing dev deps…"; "$PYTHON_BIN" -m pip install -q -e "$REPO_ROOT[dev]"; }
}

# ─── Backend checks ───────────────────────────────────────────────────────────

check_backend_lint() {
    _header "Backend — lint (ruff)"
    if command -v ruff &>/dev/null || "$PYTHON_BIN" -m ruff --version &>/dev/null 2>&1; then
        run_step "ruff check src/" \
            "$PYTHON_BIN" -m ruff check "$REPO_ROOT/src" --quiet
    else
        _skip "ruff not installed"
    fi
}

check_backend_tests() {
    _header "Backend — pytest"
    run_step "pytest -q" \
        "$PYTHON_BIN" -m pytest "$REPO_ROOT/tests" -q --tb=short 2>&1 | tee /tmp/pytest_out.txt
    # re-parse exit code from subshell
    local exit_code=${PIPESTATUS[0]}
    if [[ $exit_code -ne 0 ]]; then
        ((FAIL++)) || true; ((PASS--)) || true
    fi
}

check_guardrails() {
    _header "Guardrails"
    if [[ -f "$REPO_ROOT/scripts/guardrails.py" ]]; then
        run_step "guardrails (impl phase)" \
            "$PYTHON_BIN" "$REPO_ROOT/scripts/guardrails.py" --phase impl \
            --allow "README.md,pyproject.toml,run_checks.sh"
    else
        _skip "guardrails.py not found"
    fi
}

# ─── Frontend checks ──────────────────────────────────────────────────────────

check_frontend_install() {
    _header "Frontend — dependencies"
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        echo "    Running npm install…"
        run_step "npm install" \
            npm --prefix "$FRONTEND_DIR" install --silent
    else
        _ok "node_modules present"
    fi
}

check_frontend_lint() {
    _header "Frontend — lint (eslint)"
    run_step "eslint" \
        npm --prefix "$FRONTEND_DIR" run lint -- --max-warnings 0 2>&1
}

check_frontend_typecheck() {
    _header "Frontend — type-check (tsc)"
    run_step "tsc --noEmit" \
        "$FRONTEND_DIR/node_modules/.bin/tsc" --noEmit -p "$FRONTEND_DIR/tsconfig.app.json"
}

check_frontend_tests() {
    _header "Frontend — vitest"
    run_step "vitest run" \
        npm --prefix "$FRONTEND_DIR" run test -- --run 2>&1
}

check_frontend_build() {
    _header "Frontend — build"
    run_step "vite build" \
        npm --prefix "$FRONTEND_DIR" run build 2>&1
}

# ─── Integration smoke test ──────────────────────────────────────────────────

check_backend_startup() {
    _header "Backend — startup smoke test"

    local port=18765
    local pid

    # Start backend in background on a throwaway port
    SIMPLE_STEPS_PORT=$port "$PYTHON_BIN" -m uvicorn \
        SIMPLE_STEPS.server.app:app \
        --host 127.0.0.1 --port "$port" \
        --log-level warning &
    pid=$!

    # Wait up to 8 s for it to accept connections
    local ready=0
    for i in $(seq 1 16); do
        sleep 0.5
        if curl -sf "http://127.0.0.1:$port/api/health" &>/dev/null; then
            ready=1; break
        fi
    done

    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    if [[ $ready -eq 1 ]]; then
        _ok "backend /api/health responded"
    else
        _err "backend did not become ready on port $port"
    fi
}

# ─── Summary ─────────────────────────────────────────────────────────────────

print_summary() {
    echo -e "\n${BOLD}────────────────────────────────${NC}"
    echo -e " ${GREEN}Passed:${NC}  $PASS"
    [[ $FAIL -gt 0 ]] && echo -e " ${RED}Failed:${NC}  $FAIL"
    [[ $SKIP -gt 0 ]] && echo -e " ${YELLOW}Skipped:${NC} $SKIP"
    echo -e "${BOLD}────────────────────────────────${NC}"

    if [[ $FAIL -gt 0 ]]; then
        echo -e "${RED}${BOLD}CHECKS FAILED${NC}"
        exit 1
    else
        echo -e "${GREEN}${BOLD}ALL CHECKS PASSED${NC}"
    fi
}

# ─── Entry point ─────────────────────────────────────────────────────────────

TARGET="${1:-all}"

cd "$REPO_ROOT"

case "$TARGET" in
    backend)
        check_python_env
        check_backend_lint
        check_backend_tests
        check_guardrails
        ;;
    frontend)
        check_frontend_install
        check_frontend_lint
        check_frontend_typecheck
        check_frontend_tests
        check_frontend_build
        ;;
    lint)
        check_python_env
        check_backend_lint
        check_frontend_install
        check_frontend_lint
        check_frontend_typecheck
        ;;
    smoke)
        check_python_env
        check_backend_startup
        ;;
    precommit)
        check_python_env
        check_backend_tests
        check_guardrails
        check_frontend_install
        check_frontend_lint
        check_frontend_typecheck
        check_frontend_tests
        ;;
    all)
        check_python_env
        check_backend_lint
        check_backend_tests
        check_guardrails
        check_frontend_install
        check_frontend_lint
        check_frontend_typecheck
        check_frontend_tests
        check_frontend_build
        ;;
    *)
        echo "Unknown target: $TARGET"
        echo "Usage: $0 [all|backend|frontend|lint|smoke|precommit]"
        exit 1
        ;;
esac

print_summary
