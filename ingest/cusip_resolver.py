"""Resolve every distinct CUSIP in holdings_13f → ticker via OpenFIGI.

WHY (caught May 22): name-based resolution can't disambiguate ETFs (many
iShares funds share the same "ISHARES TR" prefix) or SEC-truncated names
("ACACIA RESH" instead of "ACACIA RESEARCH"). CUSIP is globally unique per
security and OpenFIGI maps CUSIPs → tickers for free at 25 req/min.

Idempotent — only resolves CUSIPs we haven't seen yet, plus refreshes
last_seen_in_holdings for any that appeared in today's ingest.

Usage:
  python -m ingest.cusip_resolver              # resolve all unmapped
  python -m ingest.cusip_resolver --limit 200  # cap (smoke test)
  python -m ingest.cusip_resolver --refresh CUSIP1,CUSIP2  # force re-resolve specific
"""
from __future__ import annotations

import argparse
import os
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"
# OpenFIGI anonymous: 25 req/min, MAX 10 jobs per request (not 100 — 413
# caught in smoke test). With a free API key the limits go up to 250 req/min
# and 100 jobs per request — worth wiring later if we hit volume.
RATE_LIMIT_S = 60.0 / 25  # 2.4s between batches anonymous
BATCH_SIZE = 10


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def paginated(sb: Client, table: str, sel: str, **filters: Any) -> list[dict[str, Any]]:
    out, off = [], 0
    while True:
        q = sb.table(table).select(sel)
        for k, v in filters.items():
            q = q.eq(k, v)
        b = q.range(off, off + 999).execute()
        if not b.data:
            break
        out.extend(b.data)
        if len(b.data) < 1000:
            break
        off += 1000
    return out


def openfigi_lookup(cusips: list[str]) -> dict[str, dict[str, str] | None]:
    """POST a batch of CUSIPs to OpenFIGI; return {cusip → {ticker, name, ...} or None}."""
    if not cusips:
        return {}
    body = [{"idType": "ID_CUSIP", "idValue": c} for c in cusips]
    r = requests.post(OPENFIGI_URL, json=body, headers={"Content-Type": "application/json"}, timeout=30)
    if r.status_code == 429:
        # rate-limited: back off and retry once
        time.sleep(60)
        r = requests.post(OPENFIGI_URL, json=body, headers={"Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    rows = r.json()
    out: dict[str, dict[str, str] | None] = {}
    for cusip, row in zip(cusips, rows, strict=False):
        # row format: {"data": [{"ticker":"...","name":"...","exchCode":"...","securityType2":"..."}]} OR {"warning":"..."}
        data = row.get("data") if isinstance(row, dict) else None
        if not data:
            out[cusip] = None
            continue
        # Prefer US-exchange common-stock / ADR / ETP matches; OpenFIGI returns
        # cross-listed copies (e.g. London, Frankfurt). Pick the first US one.
        us = [d for d in data if d.get("exchCode") == "US"]
        chosen = (us or data)[0]
        out[cusip] = {
            "ticker": chosen.get("ticker"),
            "name": chosen.get("name"),
            "exchange": chosen.get("exchCode"),
            "security_type": chosen.get("securityType2") or chosen.get("securityType"),
        }
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None, help="max unmapped CUSIPs to resolve this run")
    p.add_argument("--refresh", type=str, default=None, help="comma-sep CUSIPs to force re-resolve")
    args = p.parse_args()

    sb = _supabase()

    # 1. Unique CUSIPs in holdings_13f, with latest period each appeared in
    print("Loading distinct CUSIPs from holdings_13f…", flush=True)
    holdings = paginated(sb, "holdings_13f", "cusip,period_of_report")
    last_seen: dict[str, str] = {}
    for h in holdings:
        c, p_ = h["cusip"], h["period_of_report"]
        if c and (c not in last_seen or p_ > last_seen[c]):
            last_seen[c] = p_
    print(f"  {len(last_seen):,} distinct CUSIPs", flush=True)

    # 2. Already-resolved CUSIPs
    print("Loading already-resolved CUSIPs from cusip_ticker_map…", flush=True)
    existing = {row["cusip"]: row for row in paginated(sb, "cusip_ticker_map", "cusip,ticker")}
    print(f"  {len(existing):,} already mapped", flush=True)

    refresh_set = set((args.refresh or "").split(",")) if args.refresh else set()
    refresh_set.discard("")

    todo = [c for c in last_seen if c not in existing or c in refresh_set]
    if args.limit:
        todo = todo[: args.limit]
    print(f"  {len(todo):,} to resolve via OpenFIGI", flush=True)

    # 3. Batch through OpenFIGI
    resolved = 0
    nomatch = 0
    for i in range(0, len(todo), BATCH_SIZE):
        batch = todo[i : i + BATCH_SIZE]
        try:
            results = openfigi_lookup(batch)
        except Exception as e:
            print(f"  batch {i // BATCH_SIZE} FAILED: {e}", flush=True)
            time.sleep(RATE_LIMIT_S * 2)
            continue
        rows = []
        for cusip in batch:
            r = results.get(cusip)
            rows.append({
                "cusip": cusip,
                "ticker": r["ticker"] if r else None,
                "name": r["name"] if r else None,
                "exchange": r["exchange"] if r else None,
                "security_type": r["security_type"] if r else None,
                "resolved_via": "openfigi" if r else "openfigi_nomatch",
                "last_seen_in_holdings": last_seen[cusip],
            })
            if r and r["ticker"]:
                resolved += 1
            else:
                nomatch += 1
        sb.table("cusip_ticker_map").upsert(rows, on_conflict="cusip").execute()
        if (i // BATCH_SIZE) % 5 == 0:
            print(f"  [{i + len(batch):>5}/{len(todo):>5}]  resolved={resolved} nomatch={nomatch}", flush=True)
        time.sleep(RATE_LIMIT_S)

    # 4. Update last_seen for already-resolved CUSIPs that appeared this run
    if existing:
        bulk = [
            {"cusip": c, "last_seen_in_holdings": last_seen[c]}
            for c in existing
            if c in last_seen
        ]
        for chunk in (bulk[i : i + 500] for i in range(0, len(bulk), 500)):
            sb.table("cusip_ticker_map").upsert(chunk, on_conflict="cusip").execute()

    print(f"\nDone. Newly resolved: {resolved}.  No match: {nomatch}.  Total mapped: {len(existing) + resolved}.", flush=True)


if __name__ == "__main__":
    main()
