#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
HOST="127.0.0.1"
PORT="8000"
MAX_PORT_SCAN="50"
RELOAD="1"
AUTO_INSTALL="1"
WORKSPACE=""
PROJECTS_DIR=""
EXTRA_PACKS=()
EXTRA_OPS=()

usage() {
    cat <<'EOF'
Simple Steps backend launcher

Usage:
    ./start_backend.sh [options]

Options:
    --host <host>            Bind host (default: 127.0.0.1)
    --port <port>            Preferred port (default: 8000)
    --max-port-scan <n>      How many upward ports to try (default: 50)
    --python <bin>           Python executable (default: python3)
    --workspace <dir>        Workspace root (sets SIMPLE_STEPS_WORKSPACE)
    --projects-dir <dir>     Projects directory (sets SIMPLE_STEPS_PROJECTS_DIR)
    --packs <dir>            Extra pack dir; repeatable
    --ops <dir>              Extra ops dir; repeatable
    --no-reload              Disable uvicorn reload mode
    --no-install             Do not auto-install missing Python deps
    -h, --help               Show this help

Examples:
    ./start_backend.sh
    ./start_backend.sh --port 8765 --workspace /path/to/repo
    ./start_backend.sh --no-reload --packs ./packs --ops ./ops
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)
            HOST="$2"; shift 2 ;;
        --port)
            PORT="$2"; shift 2 ;;
        --max-port-scan)
            MAX_PORT_SCAN="$2"; shift 2 ;;
        --python)
            PYTHON_BIN="$2"; shift 2 ;;
        --workspace)
            WORKSPACE="$2"; shift 2 ;;
        --projects-dir)
            PROJECTS_DIR="$2"; shift 2 ;;
        --packs)
            EXTRA_PACKS+=("$2"); shift 2 ;;
        --ops)
            EXTRA_OPS+=("$2"); shift 2 ;;
        --no-reload)
            RELOAD="0"; shift ;;
        --no-install)
            AUTO_INSTALL="0"; shift ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 2 ;;
    esac
done

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "❌ Python executable not found: $PYTHON_BIN" >&2
    exit 127
fi

if [[ ! -d "$REPO_ROOT/src" ]]; then
    echo "❌ Expected src/ under repo root: $REPO_ROOT" >&2
    exit 1
fi

if [[ -n "$WORKSPACE" ]]; then
    export SIMPLE_STEPS_WORKSPACE
    SIMPLE_STEPS_WORKSPACE="$(cd "$WORKSPACE" && pwd)"
fi

if [[ -n "$PROJECTS_DIR" ]]; then
    export SIMPLE_STEPS_PROJECTS_DIR
    SIMPLE_STEPS_PROJECTS_DIR="$(cd "$(dirname "$PROJECTS_DIR")" && pwd)/$(basename "$PROJECTS_DIR")"
fi

if [[ ${#EXTRA_PACKS[@]} -gt 0 ]]; then
    PACKS_JOINED=""
    for p in "${EXTRA_PACKS[@]}"; do
        abs_p="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
        if [[ -z "$PACKS_JOINED" ]]; then
            PACKS_JOINED="$abs_p"
        else
            PACKS_JOINED="$PACKS_JOINED;$abs_p"
        fi
    done
    export SIMPLE_STEPS_PACKS_DIR="$PACKS_JOINED"
fi

if [[ ${#EXTRA_OPS[@]} -gt 0 ]]; then
    OPS_JOINED=""
    for p in "${EXTRA_OPS[@]}"; do
        abs_p="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
        if [[ -z "$OPS_JOINED" ]]; then
            OPS_JOINED="$abs_p"
        else
            OPS_JOINED="$OPS_JOINED;$abs_p"
        fi
    done
    export SIMPLE_STEPS_EXTRA_OPS="$OPS_JOINED"
fi

if [[ "$AUTO_INSTALL" == "1" ]]; then
    if ! "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import fastapi, uvicorn, pydantic, pandas, numpy
PY
    then
        echo "Installing missing backend dependencies..."
        "$PYTHON_BIN" -m pip install fastapi 'uvicorn[standard]' pydantic pandas numpy
    fi
fi

FREE_PORT="$PORT"
FREE_PORT="$($PYTHON_BIN - "$HOST" "$PORT" "$MAX_PORT_SCAN" <<'PY'
import socket
import sys

host = sys.argv[1]
start = int(sys.argv[2])
attempts = int(sys.argv[3])

for offset in range(attempts):
        candidate = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                try:
                        sock.bind((host, candidate))
                        print(candidate)
                        raise SystemExit(0)
                except OSError:
                        pass

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        print(sock.getsockname()[1])
PY
)"

if [[ "$FREE_PORT" != "$PORT" ]]; then
    echo "⚠️  Port $PORT is in use, using $FREE_PORT"
fi

echo ""
echo "Starting Simple Steps Backend"
echo "  Host:      $HOST"
echo "  Port:      $FREE_PORT"
echo "  Reload:    $([[ "$RELOAD" == "1" ]] && echo yes || echo no)"
if [[ -n "${SIMPLE_STEPS_WORKSPACE:-}" ]]; then
    echo "  Workspace: ${SIMPLE_STEPS_WORKSPACE}"
fi
echo ""

UVICORN_ARGS=(
    -m uvicorn
    SIMPLE_STEPS.main:app
    --host "$HOST"
    --port "$FREE_PORT"
    --app-dir "$REPO_ROOT/src"
)

if [[ "$RELOAD" == "1" ]]; then
    UVICORN_ARGS+=(--reload)
fi

exec "$PYTHON_BIN" "${UVICORN_ARGS[@]}"
