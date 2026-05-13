#!/usr/bin/env bash
# coordinator/agent-base entrypoint.
#
# Runs the target repo's `.coordinator/setup.sh` if present (see ADR 0019),
# then drops into an interactive shell. The coordinator's dispatch path uses
# `docker exec` to invoke the agent — this CMD is only for ad-hoc shells.

set -euo pipefail

if [ -x /workspace/.coordinator/setup.sh ]; then
  echo "[coordinator-entrypoint] running /workspace/.coordinator/setup.sh"
  /workspace/.coordinator/setup.sh
fi

exec "$@"
