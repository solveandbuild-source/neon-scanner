#!/usr/bin/env bash
# Deploy Neon Scanner — ships the web app to Vercel AND commits+pushes to git.
#
# ⚠️  THE GIT PUSH IS NOT OPTIONAL. GitHub auto-disables the daily-ingest
# scheduled workflow after 60 days with no commits to this repo, and Vercel
# deploys do NOT count as git activity. Deploy without committing and the data
# pipeline silently dies ~60 days later. This bit us once: last commit
# 2026-06-02 → ingest cron disabled ~2026-08-02, two weeks of stale data.
# Every deploy MUST leave a commit on main. That is the whole point of this
# script — never run a bare `vercel --prod` again.
#
# Usage:  scripts/deploy.sh "commit message"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MSG="${1:-chore: deploy web + keep-alive commit}"

# 1) Ship the frontend to Vercel production.
( cd web && vercel --prod --yes )

# 2) Commit + push so the repo stays active and the ingest cron isn't disabled.
git add -A
if git diff --cached --quiet; then
  # No file changes — still stamp an empty keep-alive commit so the 60-day
  # inactivity clock resets even on a no-op redeploy.
  git commit --allow-empty -m "$MSG"
else
  git commit -m "$MSG"
fi
git push origin HEAD

echo "✓ Deployed to Vercel and pushed $(git rev-parse --short HEAD) to $(git rev-parse --abbrev-ref HEAD)"
