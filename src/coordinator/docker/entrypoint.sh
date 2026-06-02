#!/usr/bin/env bash
# coordinator/agent-base entrypoint.
#
# Runs the target repo's `.coordinator/setup.sh` if present (see ADR 0019),
# then keeps the container alive. The coordinator's dispatch path uses
# `docker exec` to invoke the agent — so the entrypoint must NOT exit.
#
# If args are passed (`docker run image cmd...`), exec them; otherwise idle
# with `sleep infinity` so `docker exec` has time to run.

set -euo pipefail

if [ -x /workspace/.coordinator/setup.sh ]; then
  echo "[coordinator-entrypoint] running /workspace/.coordinator/setup.sh"
  /workspace/.coordinator/setup.sh || echo "[coordinator-entrypoint] setup.sh exited non-zero (continuing)"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
else
  exec sleep infinity
fi
