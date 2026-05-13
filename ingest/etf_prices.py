"""Enrich etf_flows rows with price + 1y_return per snapshot.

The base ingester (ingest/etf_flows.py) extracts AUM and flow data from
N-PORT filings but doesn't include price (N-PORT isn't a price source).
This enrichment script fetches yfinance daily prices and:
  - Sets etf_flows.price = closing price on snapshot_date
  - Computes 1y return per ticker (latest_price / 1y_ago_price - 1)

The 1y return is stored as a separate small table (etf_returns) so the
/flows page can join it cheaply. We don't denormalize into etf_flows.

Usage: python -m ingest.etf_prices
"""
from __future__ import annotations

import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def load_tickers() -> list[str]:
    with (PROJECT_ROOT / "config" / "etf_universe.yml").open() as f:
        data = yaml.safe_load(f)
    return [e["ticker"] for e in data.get("etfs", [])]


def main() -> None:
    import yfinance as yf

    sb = _supabase()
    tickers = load_tickers()
    print(f"Enriching {len(tickers)} tickers with price data\n", flush=True)
    t0 = time.monotonic()

    # Pull current etf_flows rows so we know which snapshot dates need prices.
    snapshots: dict[str, list[dict[str, Any]]] = {}
    off = 0
    while True:
        b = sb.table("etf_flows").select("id,ticker,snapshot_date,price").range(off, off + 999).execute()
        if not b.data:
            break
        for r in b.data:
            snapshots.setdefault(r["ticker"], []).append(r)
        if len(b.data) < 1000:
            break
        off += 1000

    for i, ticker in enumerate(tickers, 1):
        rows = snapshots.get(ticker, [])
        try:
            t = yf.Ticker(ticker)
            # Fetch enough history to cover all our snapshots (~2yr)
            hist = t.history(period="3y", auto_adjust=True)
            if hist.empty:
                print(f"[{i}/{len(tickers)}] {ticker}: no price history", flush=True)
                continue
            # Map date → close. Strip timezone from index for comparison.
            close_by_date: dict[str, float] = {}
            for ts, row in hist.iterrows():
                d = ts.date().isoformat()
                close_by_date[d] = float(row["Close"])
        except Exception as e:
            print(f"[{i}/{len(tickers)}] {ticker}: yfinance error: {e}", flush=True)
            continue

        # Backfill price into each snapshot row
        updated = 0
        for row in rows:
            snap = row["snapshot_date"]
            # Find the closest trading day <= snap (in case snap is a non-trading day)
            close = close_by_date.get(snap)
            if close is None:
                # Walk back up to 5 days
                d = date.fromisoformat(snap)
                for back in range(1, 6):
                    cand = (d - timedelta(days=back)).isoformat()
                    if cand in close_by_date:
                        close = close_by_date[cand]
                        break
            if close is not None and row["price"] != close:
                sb.table("etf_flows").update({"price": close}).eq("id", row["id"]).execute()
                updated += 1
        elapsed = time.monotonic() - t0
        print(f"[{i}/{len(tickers)}] {ticker:6}  updated {updated} prices  ({elapsed:.0f}s)", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
