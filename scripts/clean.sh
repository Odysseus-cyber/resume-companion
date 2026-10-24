#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_ROOT"
if [ ! -f package.json ] || ! grep -q '"name": "resume-companion"' package.json; then
  printf '%s\n' 'Refusing cleanup: project marker not found.' >&2
  exit 1
fi
mode="${1:---dry-run}"
case "$mode" in
  --dry-run|--generated|--all) ;;
  *) printf '%s\n' 'Usage: scripts/clean.sh [--dry-run|--generated|--all]' >&2; exit 2 ;;
esac
targets=(.output .wxt .dev/cache .dev/tmp .dev/profiles .dev/reports test-results playwright-report coverage)
if [ "$mode" = '--all' ]; then
  targets=(.output .wxt .dev node_modules test-results playwright-report coverage .pnpm-store)
fi
for target in "${targets[@]}"; do
  # Never traverse a symlinked parent or erase anything outside this allowlist.
  if [ -L .dev ] && [[ "$target" == .dev/* ]]; then
    printf '%s\n' 'Refusing cleanup through symlinked .dev.' >&2
    exit 1
  fi
done
for target in "${targets[@]}"; do
  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ "$mode" = '--dry-run' ]; then
      printf 'Would remove: %s/%s\n' "$PROJECT_ROOT" "$target"
    else
      rm -rf -- "$PROJECT_ROOT/$target"
      printf 'Removed: %s/%s\n' "$PROJECT_ROOT" "$target"
    fi
  fi
done
