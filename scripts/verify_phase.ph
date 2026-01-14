#!/usr/bin/env bash
set -euo pipefail

PHASE="${PHASE:-${1:-}}"
if [[ -z "${PHASE}" ]]; then
  echo "Usage: PHASE=spec ./scripts/verify_phase.sh"
  echo "Or: ./scripts/verify_phase.sh spec"
  exit 2
fi

python ./scripts/guardrails.py --phase "${PHASE}"
