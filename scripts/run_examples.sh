#!/usr/bin/env bash
# Run every runnable documentation example against a locally served API.
#
# The examples in examples/ are the source of the snippets in
# docs/INTEGRATION.md. Running them here is what stops the documentation from
# drifting away from working code: a snippet that no longer matches the API
# fails the build rather than misleading a reader.
#
# Usage: scripts/run_examples.sh <python-executable>
set -euo pipefail

PORT="${EOTC_EXAMPLE_PORT:-8099}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The Makefile passes a venv interpreter relative to py/; resolve it to an
# absolute path now, because the examples are run from the repository root.
PY="${1:-python3}"
case "$PY" in
  /*) ;;
  */*) PY="$(cd "$ROOT/py" && cd "$(dirname "$PY")" && pwd)/$(basename "$PY")" ;;
esac

cd "$ROOT/py"
"$PY" -m uvicorn eotc.api:app --port "$PORT" --log-level warning &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to accept requests before running anything against it.
for _ in $(seq 1 100); do
  if curl -sf "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
if ! curl -sf "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then
  echo "examples: server did not start on port $PORT" >&2
  exit 1
fi

export EOTC_API="http://127.0.0.1:$PORT"
cd "$ROOT"

failed=0
for example in examples/*.js; do
  printf 'node %-28s' "$example"
  if node "$example" >/dev/null 2>"$ROOT/.example-error"; then
    echo 'ok'
  else
    echo 'FAILED'; cat "$ROOT/.example-error" >&2; failed=1
  fi
done
for example in examples/*.py; do
  printf '%s %-28s' "$(basename "$PY")" "$example"
  if "$PY" "$example" >/dev/null 2>"$ROOT/.example-error"; then
    echo 'ok'
  else
    echo 'FAILED'; cat "$ROOT/.example-error" >&2; failed=1
  fi
done
rm -f "$ROOT/.example-error"

if [ "$failed" -ne 0 ]; then
  echo 'examples: at least one example failed against the local API' >&2
  exit 1
fi
echo "examples: all passed against $EOTC_API"
