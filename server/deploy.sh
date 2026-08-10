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
sleep 4
for i in 1 2 3 4 5; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT:-5010}/api/agreement-template" || true)
  # 401 = up and auth-gated; 404 would mean the old code is still running
  if [ "$CODE" = "401" ]; then echo "API healthy (401 auth-gated as expected)"; exit 0; fi
  echo "attempt $i: got $CODE, retrying…"
  sleep 3
done
echo "API did not come up healthy" >&2
pm2 logs "$PM2_NAME" --lines 30 --nostream || true
exit 1
