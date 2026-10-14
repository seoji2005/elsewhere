#!/usr/bin/env bash
# Environment check before a work session (run as dev). Catches the setup
# problems that each cost a round trip before: logins, PATH, writable caches,
# browser launch, disk.
#   sudo -iu dev bash ~/game/tools/preflight.sh
set -uo pipefail
cd "$(dirname "$0")/.."
source ~/.nvm/nvm.sh >/dev/null 2>&1
fail=0
ok() { echo "OK   $1"; }
bad() { echo "FAIL $1"; fail=1; }

command -v node >/dev/null && ok "node $(node -v)" || bad "node not on PATH (source ~/.nvm/nvm.sh)"
[ -d node_modules ] && ok "node_modules" || bad "node_modules missing (npm ci)"
codex login status 2>&1 | grep -q "Logged in" && ok "codex login" || bad "codex not logged in (codex login --device-auth)"
git ls-remote -q origin HEAD >/dev/null 2>&1 && ok "github push key" || bad "github: ssh key/remote"
touch .vite-cache/.w 2>/dev/null && rm -f .vite-cache/.w && ok "vite cache writable" || { mkdir -p .vite-cache && ok "vite cache created"; }
timeout 60 node -e "import('playwright').then(async({chromium})=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});await b.close()})" \
  && ok "chromium launch" || bad "chromium launch"
avail=$(df -BG --output=avail ~ | tail -1 | tr -dc 0-9)
[ "$avail" -ge 5 ] && ok "disk ${avail}G free" || bad "disk only ${avail}G free"
mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
[ "$mem" -ge 800 ] && ok "memory ${mem}MB available" || bad "memory only ${mem}MB available"
exit $fail
