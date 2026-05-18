"""Apply pending SQL migrations against Supabase via the Management API.

Replaces the previous manual "paste this SQL into the dashboard" step.
Uses a Supabase Personal Access Token (PAT) — generated once at
https://supabase.com/dashboard/account/tokens — stored as the
SUPABASE_PAT env var.

Tracks applied migrations in a `schema_migrations` table created on first
run. Files in schema/migrations/*.sql are applied in lexical order and
skipped if already in the tracker.

Usage:
  python -m ingest.migrate              # apply all pending
  python -m ingest.migrate --dry-run    # list what would apply
  python -m ingest.migrate --status     # show applied + pending

Cadence: daily, BEFORE other ingest jobs (so new columns exist before
parsers run).
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_PAT = os.environ.get("SUPABASE_PAT")

if not SUPABASE_PAT:
    sys.exit(
        "Missing SUPABASE_PAT. Generate one at "
        "https://supabase.com/dashboard/account/tokens and set it in .env"
    )

# Extract project ref from URL — https://{ref}.supabase.co
m = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL)
if not m:
    sys.exit(f"Cannot parse project ref from SUPABASE_URL={SUPABASE_URL}")
PROJECT_REF = m.group(1)

API_BASE = "https://api.supabase.com"
QUERY_URL = f"{API_BASE}/v1/projects/{PROJECT_REF}/database/query"
HEADERS = {
    "Authorization": f"Bearer {SUPABASE_PAT}",
    "Content-Type": "application/json",
}

MIGRATIONS_DIR = PROJECT_ROOT / "schema" / "migrations"

# Bootstrap: the tracker table itself
TRACKER_SQL = """
create table if not exists schema_migrations (
  filename     text primary key,
  sha256       text not null,
  applied_at   timestamptz not null default now()
);
"""


def run_sql(sql: str) -> dict[str, Any]:
    """Execute SQL via the Management API. Returns response JSON."""
    r = requests.post(QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=60)
    if r.status_code != 201 and r.status_code != 200:
        raise RuntimeError(f"SQL failed ({r.status_code}): {r.text[:500]}")
    return r.json() if r.text else {}


def ensure_tracker() -> None:
    run_sql(TRACKER_SQL)


def applied_set() -> dict[str, str]:
    """Return {filename: sha256} of already-applied migrations."""
    rows = run_sql("select filename, sha256 from schema_migrations")
    if isinstance(rows, list):
        return {r["filename"]: r["sha256"] for r in rows}
    return {}


def discover_migrations() -> list[tuple[str, Path, str]]:
    """Return [(filename, path, sha256)] sorted lexically."""
    out = []
    for p in sorted(MIGRATIONS_DIR.glob("*.sql")):
        content = p.read_text()
        sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
        out.append((p.name, p, sha))
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--status", action="store_true")
    args = p.parse_args()

    print(f"Project: {PROJECT_REF}.supabase.co", flush=True)
    ensure_tracker()
    applied = applied_set()
    migrations = discover_migrations()

    if args.status:
        print(f"\nApplied: {len(applied)}")
        for fname in sorted(applied):
            print(f"  ✓ {fname}")
        pending = [m for m in migrations if m[0] not in applied]
        print(f"\nPending: {len(pending)}")
        for fname, _, _ in pending:
            print(f"  ▸ {fname}")
        return

    pending = [(fname, path, sha) for fname, path, sha in migrations if fname not in applied]
    drift = [(f, applied[f], s) for f, _, s in migrations if f in applied and applied[f] != hashlib.sha256(_ if False else b"").hexdigest()]
    # Quick drift check: report files whose content changed after being applied
    real_drift = []
    for fname, path, sha in migrations:
        if fname in applied and applied[fname] != sha:
            real_drift.append(fname)
    if real_drift:
        print(f"\n⚠ Migration content changed after apply: {real_drift}")
        print("  (we don't re-apply automatically; rename to a new migration if you need to amend)")

    if not pending:
        print(f"\nUp to date. {len(applied)} migrations applied.")
        return

    print(f"\nPending migrations: {len(pending)}")
    for fname, _, _ in pending:
        print(f"  ▸ {fname}")

    if args.dry_run:
        print("\n(dry-run) not applying.")
        return

    for fname, path, sha in pending:
        print(f"\nApplying {fname}…", flush=True)
        sql = path.read_text()
        run_sql(sql)
        run_sql(
            f"insert into schema_migrations (filename, sha256) values "
            f"('{fname}', '{sha}') on conflict (filename) do update set sha256 = excluded.sha256, applied_at = now()"
        )
        print(f"  ✓ {fname} applied", flush=True)

    print(f"\nDone. {len(pending)} migration(s) applied.")


if __name__ == "__main__":
    main()
