"""Capture daily net assets + close for all tracked ETFs from Yahoo Finance.

Why: Yahoo aggregates current netAssets daily for every ETF — including the
22 in our universe that don't have a free issuer-direct feed (SPDR XL*
sectors, SPY, QQQ, GLD, SMH, ESPO, GDX, BOTZ, URA, KWEB, KRE, TAN, XBI, XAR).
By snapshotting nightly and storing, we build a forward-fresh time series.

Flow is NOT stored here — it's computed at read-time in etf_metrics.py as:
  flow_t = aum_t − aum_{t-1} × (close_t / close_{t-1})

This formula auto-handles dividend-payment days (close drops, aum drops
proportionally, ratio cancels) without needing an explicit correction.

Run cadence: daily, after US market close (≥ 4:30 PM ET).

Usage:
  python -m ingest.etf_aum_yahoo                 # all 34, today's snapshot
  python -m ingest.etf_aum_yahoo --ticker SPY    # one ticker
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

warnings.filterwarnings("ignore")  # yfinance is noisy

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def load_tickers() -> list[str]:
    import yaml
    with (PROJECT_ROOT / "config" / "etf_universe.yml").open() as f:
        data = yaml.safe_load(f)
    return [e["ticker"] for e in data.get("etfs", [])]


def capture_one(ticker: str, yf_module) -> dict[str, Any] | None:
    """Returns {ticker, as_of_date, net_assets, close, source} or None on failure."""
    t = yf_module.Ticker(ticker)
    try:
        info = t.info
    except Exception as e:
        print(f"  {ticker}: info call failed: {type(e).__name__}: {e}", flush=True)
        return None
    net_assets = info.get("netAssets") or info.get("totalAssets")
    if not net_assets or net_assets <= 0:
        print(f"  {ticker}: no netAssets in Yahoo info", flush=True)
        return None
    # Use the most recent close from history (more reliable than info)
    try:
        h = t.history(period="5d", auto_adjust=False)
        if h.empty:
            print(f"  {ticker}: empty price history", flush=True)
            return None
        close = float(h["Close"].iloc[-1])
        last_date = h.index[-1].date()
    except Exception as e:
        print(f"  {ticker}: history call failed: {type(e).__name__}: {e}", flush=True)
        return None
    if close <= 0:
        return None
    return {
        "ticker": ticker,
        "as_of_date": last_date.isoformat(),
        "net_assets": float(net_assets),
        "close": close,
        "source": "yahoo",
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ticker", type=str, help="Only this ticker")
    args = p.parse_args()

    import yfinance as yf

    tickers = load_tickers()
    if args.ticker:
        tickers = [t for t in tickers if t == args.ticker]
    print(f"Capturing Yahoo AUM for {len(tickers)} tickers\n", flush=True)

    sb = _supabase()
    rows: list[dict[str, Any]] = []
    t0 = time.monotonic()
    for i, ticker in enumerate(tickers, 1):
        r = capture_one(ticker, yf)
        if r:
            rows.append(r)
            print(f"  [{i}/{len(tickers)}] {ticker}: aum=${r['net_assets']/1e9:.2f}B close=${r['close']:.2f} ({r['as_of_date']})", flush=True)
        # Be polite — Yahoo rate-limits aggressively
        time.sleep(0.4)

    if not rows:
        print("Nothing captured.", flush=True)
        return

    print(f"\nUpserting {len(rows)} rows ({time.monotonic()-t0:.0f}s elapsed)…", flush=True)
    for i in range(0, len(rows), 100):
        sb.table("etf_aum_daily").upsert(rows[i:i+100], on_conflict="ticker,as_of_date").execute()
    print("Done.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
