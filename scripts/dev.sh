#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$PROJECT_ROOT"
if [ "${1:-}" = '--env' ]; then
  printf 'Project: %s\nNode: %s (%s)\npnpm: %s (%s)\nArtifacts: %s\n' "$PROJECT_ROOT" "$(command -v node)" "$(node --version)" "$(command -v pnpm)" "$(pnpm --version)" "$PROJECT_ROOT/.dev"
  exit 0
fi
if [ "$#" -eq 0 ]; then
  set -- run dev
fi
exec pnpm "$@"
