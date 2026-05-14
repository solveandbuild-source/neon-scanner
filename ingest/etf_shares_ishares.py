"""Scrape iShares' daily fund-stats XLS for each tracked iShares ETF.
Compute real daily flow (Δshares × NAV) and upsert into etf_shares_daily.

iShares publishes a free, no-auth XML-spreadsheet at:
  https://www.ishares.com/us/products/{productId}/fund/1521942788811.ajax
    ?fileType=xls&fileName={TICKER}_fund&dataType=fund

The "Historical" sheet contains daily NAV per Share + Shares Outstanding
back to fund inception, refreshed daily after market close.

Flow convention (matches etf.com / Bloomberg standard):
  daily_flow_usd = (shares[t] − shares[t-1]) × NAV[t]
  positive = creation (money in), negative = redemption (money out).

Why this calc is independent of dividends: when a fund pays a dividend, NAV
drops but shares outstanding don't change (no AP transaction). Conversely
when an AP creates new shares, shares change but NAV doesn't. So Δshares
isolates creation/redemption activity from price/dividend movement.

Usage:
  python -m ingest.etf_shares_ishares                    # all 10, last 60 days
  python -m ingest.etf_shares_ishares --days 365         # last 1 year
  python -m ingest.etf_shares_ishares --ticker TLT --days 800
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

# Ticker → BlackRock product ID (resolved from product-screener-v3.1.jsn).
# To refresh: see ingest/_ishares_product_lookup.py (or re-fetch from
# https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?... )
ISHARES_PRODUCT_IDS: dict[str, str] = {
    "TLT":  "239454",
    "IEF":  "239456",
    "EEM":  "239637",
    "EFA":  "239623",
    "IBB":  "239699",
    "IGV":  "239771",
    "ITA":  "239502",
    "SOXX": "239705",
    "ICLN": "239738",
    "IBIT": "333011",
}

USER_AGENT = "Mozilla/5.0 portfolio-scanner riya1910jain@gmail.com"


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def fetch_ishares_xls(ticker: str, product_id: str) -> bytes | None:
    url = (
        f"https://www.ishares.com/us/products/{product_id}/fund/1521942788811.ajax"
        f"?fileType=xls&fileName={ticker}_fund&dataType=fund"
    )
    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
            if r.ok and len(r.content) > 50_000:
                return r.content
            time.sleep(1.5 * (attempt + 1))
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(1.5 * (attempt + 1))
    return None


def parse_historical_sheet(xls_bytes: bytes) -> list[dict[str, Any]]:
    """Parse the 'Historical' worksheet from iShares XML-spreadsheet.
    Returns list of {as_of_date, nav_per_share, shares_outstanding}, oldest-first.
    """
    text = xls_bytes.decode("utf-8-sig", errors="replace")
    m = re.search(r'<ss:Worksheet ss:Name="Historical">(.*?)</ss:Worksheet>', text, re.DOTALL)
    if not m:
        return []
    block = m.group(1)
    raw_rows = re.findall(r"<ss:Row[^>]*>(.*?)</ss:Row>", block, re.DOTALL)
    out: list[dict[str, Any]] = []
    for r in raw_rows:
        cells = re.findall(r"<ss:Data[^>]*>([^<]*)</ss:Data>", r)
        if len(cells) < 4:
            continue
        as_of_str, nav_str, _ex_div, shares_str = cells[0], cells[1], cells[2], cells[3]
        if as_of_str.strip().lower() in {"as of", ""}:
            continue
        try:
            d = datetime.strptime(as_of_str.strip(), "%b %d, %Y").date()
        except ValueError:
            continue
        try:
            nav = float(nav_str)
            shares = float(shares_str)
        except (ValueError, TypeError):
            continue
        if shares <= 0 or nav <= 0:
            continue
        out.append({
            "as_of_date": d.isoformat(),
            "nav_per_share": nav,
            "shares_outstanding": shares,
        })
    # iShares emits newest-first; reverse to ascending
    out.sort(key=lambda x: x["as_of_date"])
    return out


def compute_daily_flows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute daily_flow_usd = (shares[t] - shares[t-1]) * nav[t].
    First row has flow=None (no prior). Returns same rows with daily_flow_usd added.
    """
    out: list[dict[str, Any]] = []
    prev: dict[str, Any] | None = None
    for r in rows:
        flow: float | None = None
        if prev is not None:
            d_shares = r["shares_outstanding"] - prev["shares_outstanding"]
            flow = d_shares * r["nav_per_share"]
        out.append({**r, "daily_flow_usd": flow, "source": "ishares"})
        prev = r
    return out


def process_ticker(sb: Client, ticker: str, product_id: str, days: int) -> int:
    xls = fetch_ishares_xls(ticker, product_id)
    if not xls:
        print(f"  {ticker}: fetch failed", flush=True)
        return 0
    rows = parse_historical_sheet(xls)
    if not rows:
        print(f"  {ticker}: no Historical rows parsed", flush=True)
        return 0
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = [r for r in rows if r["as_of_date"] >= cutoff]
    if len(rows) < 2:
        print(f"  {ticker}: only {len(rows)} rows in window, skipping", flush=True)
        return 0
    enriched = compute_daily_flows(rows)
    # Drop the first row (no flow) so daily_flow_usd is always populated downstream
    enriched_with_flow = [r for r in enriched if r["daily_flow_usd"] is not None]
    # Add ticker to every row
    for r in enriched_with_flow:
        r["ticker"] = ticker
    # Upsert
    inserted = 0
    for i in range(0, len(enriched_with_flow), 500):
        batch = enriched_with_flow[i:i + 500]
        result = sb.table("etf_shares_daily").upsert(
            batch, on_conflict="ticker,as_of_date"
        ).execute()
        inserted += len(result.data) if result.data else 0
    print(
        f"  {ticker}: {len(enriched_with_flow)} daily rows "
        f"({enriched_with_flow[0]['as_of_date']} → {enriched_with_flow[-1]['as_of_date']})",
        flush=True,
    )
    return inserted


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=60, help="History window in days")
    p.add_argument("--ticker", type=str, help="Only this ticker")
    args = p.parse_args()

    items = list(ISHARES_PRODUCT_IDS.items())
    if args.ticker:
        items = [(t, p) for t, p in items if t == args.ticker]
    print(f"Scraping {len(items)} iShares ETFs, last {args.days} days each\n", flush=True)
    sb = _supabase()
    t0 = time.monotonic()
    total = 0
    for ticker, pid in items:
        try:
            total += process_ticker(sb, ticker, pid, args.days)
        except Exception as e:
            print(f"  {ticker}: ERR {type(e).__name__}: {e}", flush=True)
        # Be polite — small inter-request delay
        time.sleep(0.5)
    print(f"\nDone. {total} rows upserted in {time.monotonic()-t0:.0f}s.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
