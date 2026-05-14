"""Price data + investable universe ingester.

Builds the `tickers` table:
  - One row per US-listed common stock above a market-cap floor.
  - Captures market cap, price, 3mo / 6mo / 12mo returns.
  - Classifies each ticker as 'tradeable' / 'late_stage' / 'too_illiquid'
    using thresholds from config/signal_weights.yml.

Data sources:
  - SEC's company_tickers.json — canonical ticker ↔ CIK map (free, no key).
  - yfinance — daily OHLCV for the price/return computations.

Scope decisions:
  - We pull info for ~10K US-listed tickers from SEC's mapping; yfinance fails
    silently for delisted/private ones (we skip those).
  - This is INFRA for downstream filters & issuer-side Form 4 detection; it
    does NOT emit signals.

Cadence: daily after market close. Idempotent — uses upsert on ticker.

Usage:
  python -m ingest.prices            # full universe pass
  python -m ingest.prices --limit 50 # smoke test
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
import yaml
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
EDGAR_USER_AGENT = os.environ["EDGAR_USER_AGENT"]

with (PROJECT_ROOT / "config" / "signal_weights.yml").open() as f:
    CFG = yaml.safe_load(f)
LATE_STAGE_6MO = CFG["universe"]["late_stage_threshold_6mo"]
MIN_MKT_CAP = CFG["universe"]["min_market_cap_usd"]
MIN_DOLLAR_VOL = CFG["universe"]["min_avg_dollar_volume_usd"]


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def fetch_ticker_map() -> list[dict[str, Any]]:
    """Pull SEC's canonical ticker ↔ CIK map. ~10K US-listed companies."""
    r = requests.get(
        "https://www.sec.gov/files/company_tickers.json",
        headers={"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    # SEC returns a numbered-key dict: {"0": {cik_str, ticker, title}, "1": ...}
    return [
        {"ticker": v["ticker"], "name": v["title"], "cik": str(v["cik_str"]).zfill(10)}
        for v in data.values()
    ]


def classify(market_cap: float | None, dollar_vol: float | None, ret_6mo: float | None) -> str:
    """Return one of: tradeable, late_stage, too_illiquid, untracked."""
    if market_cap is None or ret_6mo is None:
        return "untracked"
    if market_cap < MIN_MKT_CAP:
        return "too_illiquid"
    if dollar_vol is not None and dollar_vol < MIN_DOLLAR_VOL:
        return "too_illiquid"
    if ret_6mo > LATE_STAGE_6MO:
        return "late_stage"
    return "tradeable"


def fetch_price_for_ticker(yf_module, ticker: str) -> dict[str, Any] | None:
    """One ticker's stats from yfinance. Returns None on any failure."""
    try:
        t = yf_module.Ticker(ticker)
        # 13mo of daily prices — enough to compute 3/6/12mo returns
        hist = t.history(period="13mo", auto_adjust=True)
        if hist.empty or len(hist) < 20:
            return None
        last_close = float(hist["Close"].iloc[-1])
        # mean dollar volume over last 20 days = avg(Close * Volume)
        recent = hist.tail(20)
        avg_dollar_vol = float((recent["Close"] * recent["Volume"]).mean())
        # returns (handle short histories)
        def _ret(days: int) -> float | None:
            if len(hist) < days + 1:
                return None
            prior = float(hist["Close"].iloc[-(days + 1)])
            if prior <= 0:
                return None
            return last_close / prior - 1.0
        ret_3mo = _ret(63)   # ~63 trading days = 3mo
        ret_6mo = _ret(126)
        ret_12mo = _ret(252)
        # market cap from .info (may rate-limit or fail; handle gracefully)
        market_cap = None
        try:
            info = t.info
            mc = info.get("marketCap")
            if isinstance(mc, (int, float)) and mc > 0:
                market_cap = float(mc)
        except Exception:
            pass
        return {
            "price": last_close,
            "market_cap_usd": market_cap,
            "avg_dollar_volume_20d": avg_dollar_vol,
            "return_3mo": ret_3mo,
            "return_6mo": ret_6mo,
            "return_12mo": ret_12mo,
        }
    except Exception:
        return None


def upsert_ticker(sb: Client, ticker: str, name: str, stats: dict[str, Any] | None) -> None:
    row = {
        "ticker": ticker,
        "name": name,
        "market_cap_usd": stats["market_cap_usd"] if stats else None,
        "avg_dollar_volume_20d": stats["avg_dollar_volume_20d"] if stats else None,
        "price": stats["price"] if stats else None,
        "return_3mo": stats["return_3mo"] if stats else None,
        "return_6mo": stats["return_6mo"] if stats else None,
        "return_12mo": stats["return_12mo"] if stats else None,
        "classification": classify(
            stats["market_cap_usd"] if stats else None,
            stats["avg_dollar_volume_20d"] if stats else None,
            stats["return_6mo"] if stats else None,
        ),
    }
    sb.table("tickers").upsert(row, on_conflict="ticker").execute()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None)
    args = p.parse_args()

    # import yfinance lazily — heavy
    import yfinance as yf

    print("Fetching SEC ticker map…", flush=True)
    tickers = fetch_ticker_map()
    print(f"  {len(tickers):,} US-listed tickers", flush=True)
    if args.limit:
        tickers = tickers[: args.limit]

    sb = _supabase()
    t0 = time.monotonic()
    ok = fail = 0
    for i, t in enumerate(tickers, 1):
        # Polite to Yahoo: 0.3s/ticker = ~3 req/sec. For 10K tickers this is
        # ~50 min — within job timeout. Without pacing we'd get banned.
        if i > 1:
            time.sleep(0.3)
        stats = fetch_price_for_ticker(yf, t["ticker"])
        try:
            upsert_ticker(sb, t["ticker"], t["name"], stats)
            if stats:
                ok += 1
            else:
                fail += 1
        except Exception as e:
            fail += 1
        if i <= 10 or i % 200 == 0:
            elapsed = time.monotonic() - t0
            rate = i / elapsed if elapsed > 0 else 0
            print(
                f"[{i}/{len(tickers)}] {t['ticker']:6} ok={ok} fail={fail}  ({elapsed:.0f}s @ {rate:.1f}/s)",
                flush=True,
            )

    print("\n=== Summary ===", flush=True)
    print(f"Processed   : {len(tickers)}", flush=True)
    print(f"  with data : {ok}", flush=True)
    print(f"  no data   : {fail}", flush=True)

    # Classification breakdown
    from collections import Counter
    counts: Counter[str] = Counter()
    offset = 0
    while True:
        b = sb.table("tickers").select("classification").range(offset, offset + 999).execute()
        if not b.data:
            break
        for r in b.data:
            counts[r["classification"] or "null"] += 1
        if len(b.data) < 1000:
            break
        offset += 1000
    print(f"Classifications: {dict(counts)}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
