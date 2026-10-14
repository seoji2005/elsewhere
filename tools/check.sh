#!/usr/bin/env bash
set -euo pipefail
trap 'status=$?; if (( status == 0 )); then echo PASS; else echo FAIL; fi' EXIT
cd "$(dirname "$0")/.."
fast=false
card=''
while (( $# )); do
  case "$1" in
    --fast) fast=true; shift ;;
    --card) [[ $# -ge 2 ]] || { echo 'Missing card path' >&2; exit 1; }; card=$2; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
npx --no-install tsc --noEmit
if [[ -d tests ]] && [[ -n $(find tests -type f \( -name '*.test.*' -o -name '*.spec.*' \) -print -quit) ]]; then
  npx --no-install vitest run --configLoader runner  # runner: no temp files in the (shared, read-only for Codex) node_modules
fi
npm run build:single
node --input-type=module <<'JS'
import { readdirSync, statSync } from 'node:fs';
const files = readdirSync('dist-single');
if (files.length !== 1 || files[0] !== 'index.html') throw Error('Expected only index.html');
const bytes = statSync('dist-single/index.html').size;
console.log(`Build size: ${(bytes / 1024).toFixed(1)}KB / 10240KB`);
if (bytes > 10240 * 1024) throw Error('Build exceeds size limit');
JS
if ! "$fast"; then node tools/shot.mjs --smoke; fi
if ! "$fast"; then for scenario in tests/play/*.mjs; do node "$scenario"; done; fi
if [[ -n "$card" ]]; then node tools/scope-check.mjs "$card"; fi
