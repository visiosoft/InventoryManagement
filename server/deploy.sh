#!/usr/bin/env bash
# API deploy, run ON the Linux server by the GitHub Action (or by hand).
# Idempotent: recovers from stuck rebases and diverged history by taking
# origin/main exactly. server/.env is untracked and never touched.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/InventoryManagement}"
PM2_NAME="${PM2_NAME:-purplebox-api}"

cd "$APP_DIR"

echo "── Sync code ──"
# A previously interrupted rebase leaves .git/rebase-merge behind and blocks
# every git command after it — clear any half-done state first.
git rebase --abort 2>/dev/null || true
git merge --abort 2>/dev/null || true
rm -rf .git/rebase-merge .git/rebase-apply

git fetch origin main
git reset --hard origin/main
echo "Now at: $(git log --oneline -1)"

echo "── Install deps ──"
cd server
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "── Restart API ──"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  # First run (or the process was registered under another name): take over.
  pm2 delete all 2>/dev/null || true
  pm2 start src/index.js --name "$PM2_NAME"
fi
pm2 save

echo "── Health check ──"
# The server's port comes from its .env (production runs on a non-default port)
API_PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')
API_PORT="${API_PORT:-${PORT:-5010}}"
echo "probing http://localhost:${API_PORT}/api/health"
# The API listens only once Atlas has connected, and a cold connect takes
# 25-30 s on its own — more when two deploys land a minute apart and the
# second restart interrupts the first connect. Five probes over ~40 s was
# tight enough to fail a deploy whose process came up fine seconds later.
sleep 4
for i in $(seq 1 20); do
  BODY=$(curl -s -m 5 "http://localhost:${API_PORT}/api/health" || true)
  case "$BODY" in
    *'"ok":true'*) echo "API healthy after ~$((4 + i * 5))s: $BODY"; exit 0;;
  esac
  echo "attempt $i: ${BODY:-no response yet}"
  sleep 5
done
echo "API did not come up healthy" >&2
pm2 logs "$PM2_NAME" --lines 30 --nostream || true
exit 1
