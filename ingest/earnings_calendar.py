"""Upcoming earnings dates + short-horizon returns for the /earnings tab.

Universe = large-caps (market_cap >= $10B in `tickers`) UNION every ticker our
tracked filers hold (distinct tickers in cusip_ticker_map, which only contains
CUSIPs seen in holdings_13f). For each, pull from Yahoo:
  - next scheduled earnings date
  - trailing 1-week and 1-month price return
and upsert into earnings_calendar.

Observable schedule data only — the page sorts by date, not return (no FOMO
leaderboard; CLAUDE.md §2.2).

Cadence: daily (Yahoo job). Idempotent — upsert on ticker. Per-ticker Yahoo
calls are paced to stay polite / avoid rate-limit bans.

Usage:
  python -m ingest.earnings_calendar               # full union
  python -m ingest.earnings_calendar --limit 400   # cap (smoke / quick populate)
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

LARGE_CAP_FLOOR = 10_000_000_000  # $10B
PACE_S = 0.4                      # between tickers — politeness / rate-limit guard


def _sb() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def paginate(sb: Client, table: str, sel: str) -> list[dict[str, Any]]:
    out, off = [], 0
    while True:
        b = sb.table(table).select(sel).range(off, off + 999).execute()
        if not b.data:
            break
        out.extend(b.data)
        if len(b.data) < 1000:
            break
        off += 1000
    return out


def build_universe(sb: Client) -> list[dict[str, Any]]:
    """[{ticker, name, market_cap_usd, in_smart_money}], smart-money names first
    (so a --limit run still covers the on-theme stocks)."""
    uni = paginate(sb, "tickers", "ticker,name,market_cap_usd")
    meta = {u["ticker"]: u for u in uni if u.get("ticker")}

    # tickers our filers hold: distinct tickers in cusip_ticker_map (CUSIPs there
    # only exist because they appeared in holdings_13f).
    smart = {c["ticker"] for c in paginate(sb, "cusip_ticker_map", "ticker") if c.get("ticker")}
    large = {t for t, m in meta.items() if (m.get("market_cap_usd") or 0) >= LARGE_CAP_FLOOR}

    # Largest market cap first, so a --limit run covers the recognizable names
    # (and generally the most-watched earnings) before the long tail / ETFs.
    union = {t for t in (smart | large) if t}
    ordered = sorted(union, key=lambda t: meta.get(t, {}).get("market_cap_usd") or 0, reverse=True)
    rows, seen = [], set()
    for t in ordered:
        if t in seen:
            continue
        seen.add(t)
        m = meta.get(t, {})
        rows.append({
            "ticker": t,
            "name": m.get("name"),
            "market_cap_usd": m.get("market_cap_usd"),
            "in_smart_money": t in smart,
        })
    return rows


def next_earnings_date(t: yf.Ticker, today: date) -> date | None:
    # .calendar is the light path (a dict with 'Earnings Date' in recent yfinance).
    try:
        cal = t.calendar
        ed = cal.get("Earnings Date") if isinstance(cal, dict) else None
        if ed:
            dates = ed if isinstance(ed, (list, tuple)) else [ed]
            ds = []
            for d in dates:
                try:
                    ds.append(d if isinstance(d, date) else pd.Timestamp(d).date())
                except Exception:
                    continue
            fut = sorted(d for d in ds if d >= today)
            if fut:
                return fut[0]
            if ds:
                return sorted(ds)[-1]
    except Exception:
        pass
    # Fallback: the earnings-dates table (heavier).
    try:
        df = t.get_earnings_dates(limit=12)
        if df is not None and len(df):
            fut = sorted({i.date() for i in df.index if i.date() >= today})
            if fut:
                return fut[0]
    except Exception:
        pass
    return None


def short_returns(t: yf.Ticker) -> tuple[float | None, float | None, float | None]:
    """(price, return_1w, return_1m) from ~2 months of daily closes."""
    try:
        hist = t.history(period="2mo", auto_adjust=True)
    except Exception:
        return None, None, None
    if hist is None or len(hist) < 2 or "Close" not in hist:
        return None, None, None
    closes = hist["Close"].dropna()
    if len(closes) < 2:
        return None, None, None
    cur = float(closes.iloc[-1])
    last_ts = closes.index[-1]

    def ret_since(days: int) -> float | None:
        cutoff = last_ts - pd.Timedelta(days=days)
        prior = closes[closes.index <= cutoff]
        if len(prior) == 0:
            return None
        base = float(prior.iloc[-1])
        return (cur / base - 1) if base else None

    return cur, ret_since(7), ret_since(30)


def _flush(sb: Client, rows: list[dict]) -> None:
    if not rows:
        return
    try:
        sb.table("earnings_calendar").upsert(rows, on_conflict="ticker").execute()
    except Exception as e:
        print(f"  flush error: {e}", flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None, help="cap number of tickers this run")
    args = p.parse_args()

    sb = _sb()
    today = date.today()
    universe = build_universe(sb)
    if args.limit:
        universe = universe[: args.limit]
    print(f"universe: {len(universe)} tickers (smart-money first)", flush=True)

    ok = fail = 0
    batch: list[dict] = []
    for i, u in enumerate(universe):
        sym = u["ticker"]
        try:
            t = yf.Ticker(sym)
            ne = next_earnings_date(t, today)
            price, r1w, r1m = short_returns(t)
            batch.append({
                "ticker": sym,
                "name": u.get("name"),
                "next_earnings": ne.isoformat() if ne else None,
                "return_1w": round(r1w, 4) if r1w is not None else None,
                "return_1m": round(r1m, 4) if r1m is not None else None,
                "price": round(price, 2) if price is not None else None,
                "market_cap_usd": u.get("market_cap_usd"),
                "in_smart_money": bool(u.get("in_smart_money")),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            ok += 1
        except Exception:
            fail += 1
        if len(batch) >= 50:
            _flush(sb, batch)
            batch = []
        if i % 100 == 0:
            print(f"  [{i:>4}/{len(universe)}] ok={ok} fail={fail}", flush=True)
        time.sleep(PACE_S)
    _flush(sb, batch)
    print(f"done. ok={ok} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
