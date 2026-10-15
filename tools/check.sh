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
npm run build
node --input-type=module <<'JS'
import { readFileSync, readdirSync, statSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const initial = new Set(['index.html']);
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  initial.add(chunk.file);
  for (const css of chunk.css ?? []) initial.add(css);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
const entries = Object.keys(manifest).filter(key => manifest[key].isEntry);
if (!entries.length) throw Error('Missing build entry');
entries.forEach(visit);
const bytes = [...initial].reduce((sum, file) => sum + statSync(`dist/${file}`).size, 0);
const total = readdirSync('dist', { recursive: true }).reduce((sum, file) => {
  const stat = statSync(`dist/${file}`);
  return sum + (stat.isFile() ? stat.size : 0);
}, 0);
console.log(`Initial bundle: ${(bytes / 1024).toFixed(1)}KB / 1500KB; dist: ${(total / 1024 / 1024).toFixed(2)}MB / 30MB`);
if (bytes > 1500 * 1024 || total > 30 * 1024 * 1024) throw Error('Build exceeds size limit');
JS
if ! "$fast"; then node tools/shot.mjs --smoke; fi
if ! "$fast"; then for scenario in tests/play/*.mjs; do node "$scenario"; done; fi
if [[ -n "$card" ]]; then node tools/scope-check.mjs "$card"; fi
