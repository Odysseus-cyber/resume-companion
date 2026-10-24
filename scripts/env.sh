#!/usr/bin/env bash
# Source this file from project commands. No global installs or shell changes.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PROJECT_ROOT

if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22+ is required. Install it, add it to PATH, then retry.' >&2
  return 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22+ is required"); process.exit(1) }'

if ! command -v pnpm >/dev/null 2>&1; then
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/bin/fallback/pnpm; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done
fi
if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'pnpm is required. Use the version in package.json and add it to PATH.' >&2
  return 1
fi

# Refuse redirected artifact directories rather than writing outside the checkout.
for relative in .dev .dev/cache .dev/cache/npm .dev/tmp .dev/browsers .dev/profiles .dev/reports .dev/pnpm-store; do
  if [ -L "$PROJECT_ROOT/$relative" ]; then
    printf 'Refusing symlinked project artifact directory: %s\n' "$relative" >&2
    return 1
  fi
done
export XDG_CACHE_HOME="$PROJECT_ROOT/.dev/cache"
export npm_config_cache="$PROJECT_ROOT/.dev/cache/npm"
export npm_config_store_dir="$PROJECT_ROOT/.dev/pnpm-store"
export pnpm_config_store_dir="$PROJECT_ROOT/.dev/pnpm-store"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_ROOT/.dev/browsers"
export PLAYWRIGHT_PROFILE_DIR="$PROJECT_ROOT/.dev/profiles"
export PLAYWRIGHT_HTML_OUTPUT_DIR="$PROJECT_ROOT/.dev/reports/playwright"
export TMPDIR="$PROJECT_ROOT/.dev/tmp"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
mkdir -p "$XDG_CACHE_HOME" "$npm_config_cache" "$npm_config_store_dir" "$PLAYWRIGHT_BROWSERS_PATH" "$PLAYWRIGHT_PROFILE_DIR" "$PLAYWRIGHT_HTML_OUTPUT_DIR" "$TMPDIR"
