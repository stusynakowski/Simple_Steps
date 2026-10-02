#!/usr/bin/env bash
set -euo pipefail

PHASE="${PHASE:-${1:-}}"
if [[ -z "${PHASE}" ]]; then
  echo "Usage: PHASE=impl ./scripts/verify_phase.sh"
  echo "Or:    ./scripts/verify_phase.sh impl"
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve an interpreter. Bare `python` does not exist on a stock macOS or on
# many Linux setups, so prefer the repo venv, then python3.
if [[ -x "${REPO_ROOT}/.venv/bin/python" ]]; then
  PY="${REPO_ROOT}/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY="$(command -v python)"
else
  echo "No Python interpreter found (tried .venv/bin/python, python3, python)." >&2
  exit 1
fi

exec "${PY}" "${REPO_ROOT}/scripts/guardrails.py" --phase "${PHASE}"
