echo "Running backend tests with coverage..."
#!/usr/bin/env bash
set -euo pipefail

# Usage:
#  ./scripts/run_coverage.sh         # run backend + frontend
#  SKIP_FRONTEND=1 ./scripts/run_coverage.sh  # skip frontend

# Prefer Python from active virtualenv if available
PY_BIN=${VIRTUAL_ENV:+"$VIRTUAL_ENV/bin/python"}
PY_BIN=${PY_BIN:-$(command -v python3 || command -v python)}

echo "Using Python: ${PY_BIN}"

echo "Running backend tests with coverage (if coverage.py available)..."
# If coverage.py is installed in the venv, use it to run pytest and produce a report
if "${PY_BIN}" -c "import coverage" >/dev/null 2>&1; then
  echo "coverage.py found — running 'coverage run -m pytest'"
  "${PY_BIN}" -m coverage run -m pytest -q
  "${PY_BIN}" -m coverage report -m
else
  echo "coverage.py not found in the active environment. Running pytest without coverage."
  echo "To get coverage, install 'coverage' (pip install coverage) or 'pytest-cov' (pip install pytest-cov)."
  "${PY_BIN}" -m pytest -q
fi

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  # Run frontend tests with vitest coverage (requires node + npm install in frontend/)
  if [ -f frontend/package.json ]; then
    echo "Running frontend tests with coverage (vitest)..."
    pushd frontend > /dev/null
    if [ ! -d node_modules ]; then
      echo "Installing frontend dev dependencies (npm install)..."
      npm install
    fi
    # You can also run only coverage: npm run test -- --coverage
    npm run test -- --coverage
    popd > /dev/null
  else
    echo "No frontend package.json found; skipping frontend tests"
  fi
else
  echo "SKIP_FRONTEND=1 set — skipping frontend tests"
fi

echo "All coverage runs finished."
