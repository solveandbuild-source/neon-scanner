"""Compute multi-timeframe price returns + flow % values per ETF and write to
the etf_metrics read model. This powers the /flows dashboard.

Reads:
  - etf_shares_daily (per-issuer daily shares-outstanding × NAV; fresh to
    yesterday): real daily flow = Δshares × NAV. Highest priority when
    available. Currently covers iShares ETFs.
  - etf_flows (per-filing public N-PORT, scraped continuously; fresh to ~2-3
    month-lag): cumulative 3-month flow per filing, back-solved from
    ΔAUM − prevAUM × total_return.
  - etf_flows_monthly (SEC DERA bulk dataset): true monthly creation/redemption,
    accurate but lagged by ~1 full quarter (~4-5 months).
  - yfinance daily price + dividend history.

Writes:
  - etf_metrics (one row per ticker)

Flow source priority chain (FRESH FIRST):
  1) etf_shares_daily — iShares issuer-direct daily flow (10 tickers).
     Used for all windows when available.
  2) etf_aum_daily — Yahoo-captured daily netAssets for all 34 tickers.
     Forward-fresh from when nightly capture started. Flow computed at
     read-time: flow_t = aum_t − aum_{t-1} × (close_t / close_{t-1}).
     Auto-handles dividends.
  3) etf_flows quarterly (DIVIDEND-CORRECTED) — fills the gap between the
     last Yahoo capture date and historical N-PORT data. Correction:
     back_solved + (prev_AUM/prev_NAV) × Σ(dividends_per_share).
  4) etf_flows_monthly (DERA) — fallback when nothing fresher exists, and
     primary source for 1M when daily isn't available.

Cadence: daily after market close. Idempotent (upsert on ticker).
"""
from __future__ import annotations

import os
import sys
import time
from datetime import date, datetime, timedelta
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


def price_return_n_days(hist, n_days: int) -> float | None:
    """price[today] / price[n trading days ago] - 1."""
    if hist is None or len(hist) < 2:
        return None
    last = float(hist["Close"].iloc[-1])
    if last <= 0:
        return None
    # ~21 trading days per month
    trading_idx = max(0, len(hist) - 1 - n_days)
    prior = float(hist["Close"].iloc[trading_idx])
    if prior <= 0:
        return None
    return (last - prior) / prior


def compute_flow_window(flows: list[dict[str, Any]], days_back: int) -> tuple[float | None, float | None]:
    """[FALLBACK] Sum daily_flow_usd over the trailing N days from etf_flows
    quarterly snapshots. Returns (total_flow_usd, latest_aum). Only used when
    monthly data isn't available for this ticker.
    """
    if not flows:
        return None, None
    cutoff = (date.today() - timedelta(days=days_back)).isoformat()
    latest_aum = flows[-1].get("aum_usd")
    in_window = [f for f in flows if f["snapshot_date"] >= cutoff and f.get("daily_flow_usd") is not None]
    if not in_window:
        return None, latest_aum
    total = sum(f["daily_flow_usd"] for f in in_window)
    return total, latest_aum


def _yf_close_at(hist, target_date_str: str) -> float | None:
    """Return yfinance Close at or just before target date. Returns None
    if no data in range (e.g. target_date is older than hist)."""
    import pandas as pd
    if hist is None or len(hist) == 0:
        return None
    target = pd.Timestamp(target_date_str).tz_localize(None)
    # Make hist index naive for comparison
    idx = hist.index
    if hasattr(idx, "tz") and idx.tz is not None:
        idx = idx.tz_localize(None)
    # Find last index <= target
    matches = idx[idx <= target]
    if len(matches) == 0:
        return None
    last_match = matches[-1]
    val = hist.loc[idx == last_match, "Close"].iloc[0]
    return float(val)


def _sum_dividends_in(divs, start_date_str: str, end_date_str: str) -> float:
    """Sum yfinance dividend Series for (start, end]. Returns 0.0 if no divs
    or out-of-range. yfinance auto_adjust=True scales back dividends so we
    need to NOT use auto_adjust for this calc — caller passes raw divs.
    """
    import pandas as pd
    if divs is None or len(divs) == 0:
        return 0.0
    start = pd.Timestamp(start_date_str).tz_localize(None)
    end = pd.Timestamp(end_date_str).tz_localize(None)
    idx = divs.index
    if hasattr(idx, "tz") and idx.tz is not None:
        idx = idx.tz_localize(None)
    mask = (idx > start) & (idx <= end)
    if not mask.any():
        return 0.0
    return float(divs.values[mask].sum())


def _corrected_snapshot_flow(
    snap: dict[str, Any],
    prev_snap: dict[str, Any] | None,
    hist,
    divs,
) -> float | None:
    """Apply dividend-bias correction to a back-solved flow snapshot.
    Returns None if the raw flow is None.

    Correction: real_flow ≈ back_solved + distributions_paid
    where distributions_paid ≈ prev_shares × Σ(dividends_per_share in period)
    and prev_shares ≈ prev_aum / prev_NAV.
    """
    raw = snap.get("daily_flow_usd")
    if raw is None:
        return None
    if prev_snap is None:
        return raw  # No prior period — can't compute correction; return uncorrected
    prev_aum = prev_snap.get("aum_usd")
    if not prev_aum or prev_aum <= 0:
        return raw
    prev_price = _yf_close_at(hist, prev_snap["snapshot_date"])
    if not prev_price or prev_price <= 0:
        return raw
    period_divs = _sum_dividends_in(divs, prev_snap["snapshot_date"], snap["snapshot_date"])
    if period_divs == 0:
        return raw  # No dividends paid → no correction needed
    prev_shares = prev_aum / prev_price
    distributions = period_divs * prev_shares
    return raw + distributions


def compute_flow_window_quarterly(
    snapshots: list[dict[str, Any]],
    hist,
    divs,
    n_quarters: int,
) -> tuple[float | None, str | None]:
    """Sum the corrected back-solved flows of the latest n_quarters snapshots.
    Returns (total_flow_usd, latest_snapshot_date) or (None, None) if insufficient.
    snapshots are ordered ascending by snapshot_date.
    """
    if len(snapshots) < n_quarters:
        return None, None
    recent = snapshots[-n_quarters:]
    total = 0.0
    for i, snap in enumerate(recent):
        full_idx = len(snapshots) - n_quarters + i
        prev = snapshots[full_idx - 1] if full_idx > 0 else None
        corrected = _corrected_snapshot_flow(snap, prev, hist, divs)
        if corrected is None:
            return None, None
        total += corrected
    return total, recent[-1]["snapshot_date"]


def compute_flow_window_daily(
    daily: list[dict[str, Any]], days_back: int
) -> tuple[float | None, str | None]:
    """Sum daily_flow_usd over the trailing N calendar days from etf_shares_daily.
    `daily` is ascending by as_of_date. Returns (total_flow_usd, latest_date) or
    (None, None) if no rows in window.
    """
    if not daily:
        return None, None
    latest = daily[-1]["as_of_date"]
    # cutoff = latest - days_back  (anchored to latest data, not today)
    y, m, d = (int(latest[0:4]), int(latest[5:7]), int(latest[8:10]))
    cutoff_dt = date(y, m, d) - timedelta(days=days_back)
    cutoff = cutoff_dt.isoformat()
    in_window = [r for r in daily if r["as_of_date"] > cutoff and r.get("daily_flow_usd") is not None]
    if not in_window:
        return None, latest
    return sum(r["daily_flow_usd"] for r in in_window), latest


def compute_flow_window_yahoo(
    aum_rows: list[dict[str, Any]], days_back: int
) -> tuple[float | None, str | None]:
    """Compute flow over trailing N days from Yahoo-captured daily AUM.

    Uses: flow_t = aum_t − aum_{t-1} × (close_t / close_{t-1})
    Auto-handles dividends: close drops on ex-date, aum drops proportionally,
    the ratio cancels and the formula isolates true creation/redemption flow.

    aum_rows is ascending by as_of_date. Each row has net_assets + close.
    Returns (total_flow_usd, latest_date) or (None, None) if insufficient data.
    """
    if len(aum_rows) < 2:
        return None, None
    latest = aum_rows[-1]["as_of_date"]
    y, m, d = (int(latest[0:4]), int(latest[5:7]), int(latest[8:10]))
    cutoff_dt = date(y, m, d) - timedelta(days=days_back)
    cutoff = cutoff_dt.isoformat()

    # We need at least one row BEFORE cutoff (for the t-1 reference) plus rows in window
    in_window_idx = [i for i, r in enumerate(aum_rows) if r["as_of_date"] > cutoff]
    if not in_window_idx:
        return None, latest
    # Must have a prior row to compare against
    first_in = in_window_idx[0]
    if first_in == 0:
        return None, latest  # No prior; can't compute first flow

    total = 0.0
    for i in in_window_idx:
        cur = aum_rows[i]
        prev = aum_rows[i - 1]
        if prev["close"] is None or prev["close"] <= 0 or cur["close"] is None:
            continue
        if prev["net_assets"] is None or cur["net_assets"] is None:
            continue
        price_ratio = cur["close"] / prev["close"]
        flow = cur["net_assets"] - prev["net_assets"] * price_ratio
        total += flow
    return total, latest


def compute_flow_window_monthly(
    monthly: list[dict[str, Any]], months_back: int
) -> float | None:
    """Sum net_flow_usd over the trailing N months from etf_flows_monthly.
    `monthly` is the per-ticker list ordered ascending by month_end. The window
    is anchored to the LATEST month_end available, not to today — DERA data is
    ~60-day-lagged, and anchoring to today would silently drop the most recent
    real data point. Returns None if no rows in the window.
    """
    if not monthly:
        return None
    latest = monthly[-1]["month_end"]
    # Compute cutoff = latest - (months_back) months
    y, m = int(latest[:4]), int(latest[5:7])
    m_target = m - months_back + 1
    y_target = y
    while m_target <= 0:
        m_target += 12
        y_target -= 1
    cutoff = f"{y_target:04d}-{m_target:02d}-01"
    in_window = [r for r in monthly if r["month_end"] >= cutoff and r.get("net_flow_usd") is not None]
    if not in_window:
        return None
    return sum(r["net_flow_usd"] for r in in_window)


def main() -> None:
    import yfinance as yf

    sb = _supabase()
    tickers = load_tickers()
    print(f"Computing metrics for {len(tickers)} ETFs\n", flush=True)
    t0 = time.monotonic()

    # Pre-load all etf_flows grouped by ticker (quarterly fallback)
    flows_by_ticker: dict[str, list[dict[str, Any]]] = {}
    off = 0
    while True:
        b = sb.table("etf_flows").select("ticker,snapshot_date,aum_usd,daily_flow_usd").order("snapshot_date").range(off, off + 999).execute()
        if not b.data:
            break
        for r in b.data:
            flows_by_ticker.setdefault(r["ticker"], []).append(r)
        if len(b.data) < 1000:
            break
        off += 1000

    # Pre-load all etf_flows_monthly grouped by ticker (DERA, ~4-5mo lag)
    monthly_by_ticker: dict[str, list[dict[str, Any]]] = {}
    off = 0
    while True:
        b = sb.table("etf_flows_monthly").select("ticker,month_end,net_flow_usd").order("month_end").range(off, off + 999).execute()
        if not b.data:
            break
        for r in b.data:
            monthly_by_ticker.setdefault(r["ticker"], []).append(r)
        if len(b.data) < 1000:
            break
        off += 1000
    print(f"Loaded monthly flow data for {len(monthly_by_ticker)} tickers", flush=True)

    # Pre-load etf_shares_daily grouped by ticker (iShares issuer-direct)
    daily_by_ticker: dict[str, list[dict[str, Any]]] = {}
    off = 0
    while True:
        b = sb.table("etf_shares_daily").select(
            "ticker,as_of_date,shares_outstanding,nav_per_share,daily_flow_usd"
        ).order("as_of_date").range(off, off + 999).execute()
        if not b.data:
            break
        for r in b.data:
            daily_by_ticker.setdefault(r["ticker"], []).append(r)
        if len(b.data) < 1000:
            break
        off += 1000
    print(f"Loaded iShares daily flow data for {len(daily_by_ticker)} tickers", flush=True)

    # Pre-load etf_aum_daily grouped by ticker (Yahoo nightly capture, all 34)
    aum_by_ticker: dict[str, list[dict[str, Any]]] = {}
    off = 0
    while True:
        b = sb.table("etf_aum_daily").select(
            "ticker,as_of_date,net_assets,close"
        ).order("as_of_date").range(off, off + 999).execute()
        if not b.data:
            break
        for r in b.data:
            aum_by_ticker.setdefault(r["ticker"], []).append(r)
        if len(b.data) < 1000:
            break
        off += 1000
    print(f"Loaded Yahoo daily AUM data for {len(aum_by_ticker)} tickers", flush=True)

    rows: list[dict[str, Any]] = []
    for i, ticker in enumerate(tickers, 1):
        # Polite to Yahoo — ~2.5 req/sec sustained, well under their burst limit
        if i > 1:
            time.sleep(0.4)
        try:
            t = yf.Ticker(ticker)
            # 2y history covers our deepest 1Y window + previous-snapshot lookback
            hist = t.history(period="2y", auto_adjust=False)
            divs = t.dividends  # pandas Series, indexed by ex-date
            if hist.empty:
                print(f"[{i}/{len(tickers)}] {ticker}: no price history", flush=True)
                continue
        except Exception as e:
            print(f"[{i}/{len(tickers)}] {ticker}: yfinance error {e}", flush=True)
            continue

        # Price returns at various lookbacks (trading days)
        ret_1m = price_return_n_days(hist, 21)
        ret_3m = price_return_n_days(hist, 63)
        ret_6m = price_return_n_days(hist, 126)
        ret_1y = price_return_n_days(hist, 252)

        quarterly = flows_by_ticker.get(ticker, [])
        monthly_rows = monthly_by_ticker.get(ticker, [])
        daily_rows = daily_by_ticker.get(ticker, [])
        aum_rows = aum_by_ticker.get(ticker, [])

        # AUM: prefer the freshest source — Yahoo > iShares daily > N-PORT
        if aum_rows:
            aum = aum_rows[-1]["net_assets"]
        elif daily_rows:
            d_latest = daily_rows[-1]
            aum = d_latest["shares_outstanding"] * d_latest["nav_per_share"]
        else:
            aum = quarterly[-1]["aum_usd"] if quarterly else None

        # ── Flow window priority chain ─────────────────────────────────
        # Each window picks the freshest source that has ENOUGH history for it
        # (e.g. 1M window needs ≥30d of Yahoo data; falls back if not yet).

        def pick_window(days_target: int) -> tuple[float | None, str | None, str]:
            """Return (flow, as_of, source_label). Tries Tier 1 → Tier 4."""
            # Tier 1: iShares daily (10 tickers)
            if daily_rows and len(daily_rows) >= 2:
                first_d = date.fromisoformat(daily_rows[0]["as_of_date"])
                last_d = date.fromisoformat(daily_rows[-1]["as_of_date"])
                if (last_d - first_d).days >= days_target - 1:
                    f, a = compute_flow_window_daily(daily_rows, days_target)
                    if f is not None:
                        return f, a, "ishares"
            # Tier 2: Yahoo netAssets daily (all 34, growing forward)
            if aum_rows and len(aum_rows) >= 2:
                first_a = date.fromisoformat(aum_rows[0]["as_of_date"])
                last_a = date.fromisoformat(aum_rows[-1]["as_of_date"])
                if (last_a - first_a).days >= days_target - 1:
                    f, a = compute_flow_window_yahoo(aum_rows, days_target)
                    if f is not None:
                        return f, a, "yahoo"
            return None, None, "fallback"

        # Try fresh sources first per-window
        flow_usd_1m, asof_1m, _ = pick_window(30)
        flow_usd_3m, asof_3m, _ = pick_window(90)
        flow_usd_6m, asof_6m, _ = pick_window(180)
        flow_usd_1y, asof_1y, _ = pick_window(365)

        # Fall back per-window to N-PORT for any that didn't resolve
        # TIER 3: etf_flows quarterly + dividend correction
        qf3, qa3 = compute_flow_window_quarterly(quarterly, hist, divs, 1)
        qf6, qa6 = compute_flow_window_quarterly(quarterly, hist, divs, 2)
        qf1y, qa1y = compute_flow_window_quarterly(quarterly, hist, divs, 4)
        # TIER 4: DERA monthly
        dera_latest = monthly_rows[-1]["month_end"] if monthly_rows else None
        df1 = compute_flow_window_monthly(monthly_rows, 1) if monthly_rows else None
        df3 = compute_flow_window_monthly(monthly_rows, 3) if monthly_rows else None
        df6 = compute_flow_window_monthly(monthly_rows, 6) if monthly_rows else None
        df1y = compute_flow_window_monthly(monthly_rows, 12) if monthly_rows else None
        quarterly_latest = quarterly[-1]["snapshot_date"] if quarterly else None

        # Per-window fallback: prefer DERA if it's fresher than quarterly
        def pick_fallback(window_flow_qtr, qtr_asof, window_flow_dera, dera_asof):
            if window_flow_qtr is None and window_flow_dera is None:
                return None, None
            if window_flow_qtr is None:
                return window_flow_dera, dera_asof
            if window_flow_dera is None:
                return window_flow_qtr, qtr_asof
            # Both available: pick the fresher
            if dera_asof and qtr_asof and dera_asof > qtr_asof:
                return window_flow_dera, dera_asof
            return window_flow_qtr, qtr_asof

        if flow_usd_1m is None:
            flow_usd_1m, asof_1m = df1, dera_latest    # 1M: DERA only (no quarterly resolution)
        if flow_usd_3m is None:
            flow_usd_3m, asof_3m = pick_fallback(qf3, qa3, df3, dera_latest)
        if flow_usd_6m is None:
            flow_usd_6m, asof_6m = pick_fallback(qf6, qa6, df6, dera_latest)
        if flow_usd_1y is None:
            flow_usd_1y, asof_1y = pick_fallback(qf1y, qa1y, df1y, dera_latest)

        # Top-level freshness annotation = max of resolved as_ofs
        all_asofs = [a for a in [asof_1m, asof_3m, asof_6m, asof_1y] if a]
        flow_data_as_of = max(all_asofs) if all_asofs else None

        def pct(flow: float | None, aum: float | None) -> float | None:
            if flow is None or aum is None or aum <= 0:
                return None
            return (flow / aum) * 100

        rows.append({
            "ticker": ticker,
            "aum_usd": aum,
            "price_return_1m": ret_1m,
            "price_return_3m": ret_3m,
            "price_return_6m": ret_6m,
            "price_return_1y": ret_1y,
            "flow_usd_1m": flow_usd_1m,
            "flow_usd_3m": flow_usd_3m,
            "flow_usd_6m": flow_usd_6m,
            "flow_usd_1y": flow_usd_1y,
            "flow_pct_1m": pct(flow_usd_1m, aum),
            "flow_pct_3m": pct(flow_usd_3m, aum),
            "flow_pct_6m": pct(flow_usd_6m, aum),
            "flow_pct_1y": pct(flow_usd_1y, aum),
            "flow_data_as_of": flow_data_as_of,
            "flow_1m_as_of": asof_1m,
        })
        if i % 10 == 0 or i == len(tickers):
            elapsed = time.monotonic() - t0
            print(f"[{i}/{len(tickers)}] {ticker} done ({elapsed:.0f}s)", flush=True)

    # Upsert
    print(f"\nUpserting {len(rows)} rows", flush=True)
    for i in range(0, len(rows), 100):
        sb.table("etf_metrics").upsert(rows[i:i + 100], on_conflict="ticker").execute()
    print("Done.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
