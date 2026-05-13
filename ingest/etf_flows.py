"""ETF flow ingester using SEC N-PORT filings.

For each ticker in config/etf_universe.yml:
  - Resolve ticker → (CIK, seriesId) via SEC's company_tickers_mf.json
    (or company_tickers.json fallback for single-fund trusts)
  - Fetch all NPORT-P filings for that CIK
  - For each filing, fetch primary_doc.xml, parse for netAssets + repPdDate
  - For multi-series trusts, match the seriesId to filter to our ETF
  - Compute net flow as month-over-month AUM delta minus return contribution

Result: ~quarterly data points (NPORT-P is filed every 3 months) going back
~7 years. Coarser than daily but right resolution for sector rotation.

Caveat: commodity trusts (GLD) and crypto trusts (IBIT) don't file N-PORT
(they're under different SEC rules). These are skipped — fallback to yfinance
totalAssets snapshot is added separately.

Usage:
  python -m ingest.etf_flows               # default: 2 years back, all tickers
  python -m ingest.etf_flows --years 2     # explicit years
  python -m ingest.etf_flows --ticker SPY  # one ticker
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
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

HEADERS_JSON = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
HEADERS_XML = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/xml,text/xml,*/*"}

CONFIG_PATH = PROJECT_ROOT / "config" / "etf_universe.yml"

MIN_INTERVAL_S = 1.0 / 8
_last_request_at = 0.0


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _polite_get(url: str, headers: dict[str, str] = HEADERS_JSON) -> requests.Response | None:
    global _last_request_at
    for attempt in range(3):
        delta = time.monotonic() - _last_request_at
        if delta < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - delta)
        try:
            r = requests.get(url, headers=headers, timeout=30)
            _last_request_at = time.monotonic()
            if 500 <= r.status_code < 600:
                time.sleep(1.5 * (attempt + 1))
                continue
            return r
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(1.5 * (attempt + 1))
    return None


def load_universe() -> list[dict[str, Any]]:
    with CONFIG_PATH.open() as f:
        data = yaml.safe_load(f)
    return data.get("etfs", [])


def fetch_ticker_lookup() -> dict[str, tuple[str, str | None]]:
    """ticker → (cik_padded_10, series_id_or_None).

    Tries company_tickers_mf.json first (has series_id), falls back to
    company_tickers.json for single-fund trusts (SPY, GLD, IBIT, etc.).
    """
    lookup: dict[str, tuple[str, str | None]] = {}

    # MF list — has series IDs
    r = _polite_get("https://www.sec.gov/files/company_tickers_mf.json")
    if r and r.status_code == 200:
        data = r.json()
        for row in data.get("data", []):
            cik, series_id, _class_id, ticker = row
            lookup[ticker] = (str(cik).zfill(10), series_id)

    # Plain tickers — no series IDs, used as fallback for single-fund trusts
    r = _polite_get("https://www.sec.gov/files/company_tickers.json")
    if r and r.status_code == 200:
        data = r.json()
        for entry in data.values():
            ticker = entry.get("ticker")
            cik = entry.get("cik_str")
            if ticker and ticker not in lookup:
                lookup[ticker] = (str(cik).zfill(10), None)

    return lookup


def _localname(t: str) -> str:
    return t.rsplit("}", 1)[-1] if "}" in t else t


def _text_of(elem: ET.Element | None, *path: str) -> str | None:
    cur = elem
    for name in path:
        if cur is None:
            return None
        nxt = None
        for c in cur:
            if _localname(c.tag) == name:
                nxt = c
                break
        cur = nxt
    if cur is None:
        return None
    return (cur.text or "").strip() or None


def fetch_nport_filings(cik: str) -> list[dict[str, Any]]:
    """Return list of N-PORT-P filings for this CIK from EDGAR submissions API."""
    r = _polite_get(f"https://data.sec.gov/submissions/CIK{cik}.json")
    if not r or r.status_code != 200:
        return []
    try:
        recent = r.json()["filings"]["recent"]
    except (KeyError, ValueError):
        return []
    out = []
    for i in range(len(recent["form"])):
        if recent["form"][i] not in ("NPORT-P", "NPORT-EX", "NPORT-NP"):
            continue
        acc = recent["accessionNumber"][i]
        out.append({
            "accession": acc,
            "filed_date": recent["filingDate"][i],
            "period": recent["reportDate"][i],
            "primary_doc": recent["primaryDocument"][i],
            "cik": cik,
        })
    return out


def fetch_nport_xml(cik: str, accession: str) -> bytes | None:
    """Fetch the raw N-PORT XML, stripping any xsl wrapper."""
    acc_no_dashes = accession.replace("-", "")
    # The raw XML is at primary_doc.xml in the filing dir (no xsl segment)
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_no_dashes}/primary_doc.xml"
    r = _polite_get(url, HEADERS_XML)
    if r and r.status_code == 200 and b"<edgarSubmission" in r.content[:500]:
        return r.content
    return None


def parse_nport(xml_bytes: bytes) -> dict[str, Any] | None:
    """Extract the key fields from an N-PORT XML."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None
    form_data = next((c for c in root if _localname(c.tag) == "formData"), None)
    if form_data is None:
        return None
    gen_info = next((c for c in form_data if _localname(c.tag) == "genInfo"), None)
    fund_info = next((c for c in form_data if _localname(c.tag) == "fundInfo"), None)
    if gen_info is None or fund_info is None:
        return None

    series_id = _text_of(gen_info, "seriesId") or _text_of(gen_info, "seriesLei")
    series_name = _text_of(gen_info, "seriesName")
    reg_name = _text_of(gen_info, "regName")
    rep_pd_date = _text_of(gen_info, "repPdDate")  # snapshot date

    net_assets = _text_of(fund_info, "netAssets")
    tot_assets = _text_of(fund_info, "totAssets")

    # Monthly returns over the 3 months covered by this filing
    ret_elem = next((c for c in fund_info if _localname(c.tag) == "returnInfo"), None)
    monthly_returns: list[float] = []
    if ret_elem is not None:
        for tot_returns in ret_elem:
            if _localname(tot_returns.tag) == "monthlyTotReturns":
                for mr in tot_returns:
                    if _localname(mr.tag) == "monthlyTotReturn":
                        for k in ("rtn1", "rtn2", "rtn3"):
                            v = mr.attrib.get(k)
                            if v:
                                try:
                                    monthly_returns.append(float(v))
                                except ValueError:
                                    pass

    return {
        "series_id": series_id,
        "series_name": series_name,
        "reg_name": reg_name,
        "rep_pd_date": rep_pd_date,
        "net_assets": float(net_assets) if net_assets else None,
        "tot_assets": float(tot_assets) if tot_assets else None,
        "monthly_returns_pct": monthly_returns,
    }


def process_ticker(
    sb: Client,
    ticker: str,
    cik: str,
    series_id: str | None,
    cutoff_date: str,
) -> tuple[int, int]:
    """Ingest N-PORT history for one ticker. Returns (rows_inserted, filings_scanned)."""
    filings = fetch_nport_filings(cik)
    filings = [f for f in filings if f["period"] >= cutoff_date]
    if not filings:
        return 0, 0

    rows_to_insert: list[dict[str, Any]] = []
    # Sort oldest-first for net-flow computation
    filings.sort(key=lambda f: f["period"])
    prev_net_assets: float | None = None

    scanned = 0
    for f in filings:
        xml = fetch_nport_xml(cik, f["accession"])
        scanned += 1
        if not xml:
            continue
        parsed = parse_nport(xml)
        if not parsed:
            continue
        # Series filter: if our target ETF has a series_id, ensure it matches
        if series_id and parsed["series_id"] and parsed["series_id"] != series_id:
            continue
        # Compute net flow: ΔAUM - (returns × prevAUM)
        net_assets = parsed["net_assets"]
        if net_assets is None:
            continue
        flow = None
        if prev_net_assets is not None and parsed["monthly_returns_pct"]:
            # Compound the monthly returns into a quarterly return
            compound = 1.0
            for r in parsed["monthly_returns_pct"]:
                compound *= 1 + (r / 100.0)
            flow = net_assets - prev_net_assets * compound
        rows_to_insert.append({
            "ticker": ticker,
            "snapshot_date": parsed["rep_pd_date"],
            "price": None,  # filled in by separate price-overlay step
            "shares_out": None,
            "aum_usd": net_assets,
            "daily_flow_usd": flow,
        })
        prev_net_assets = net_assets

    if not rows_to_insert:
        return 0, scanned

    # Upsert
    inserted = 0
    for i in range(0, len(rows_to_insert), 500):
        batch = rows_to_insert[i:i + 500]
        result = sb.table("etf_flows").upsert(
            batch, on_conflict="ticker,snapshot_date"
        ).execute()
        inserted += len(result.data) if result.data else 0
    return inserted, scanned


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--years", type=float, default=2.0, help="Years of history to backfill")
    p.add_argument("--ticker", type=str, help="Only process this ticker")
    args = p.parse_args()

    cutoff = (date.today() - timedelta(days=int(args.years * 365))).isoformat()
    universe = load_universe()
    if args.ticker:
        universe = [e for e in universe if e["ticker"] == args.ticker]

    print("Fetching ticker → CIK lookup from SEC…", flush=True)
    lookup = fetch_ticker_lookup()
    print(f"  {len(lookup)} ticker mappings loaded\n", flush=True)

    sb = _supabase()
    t0 = time.monotonic()
    skipped: list[tuple[str, str]] = []
    ok = 0
    total_rows = 0

    for i, etf in enumerate(universe, 1):
        ticker = etf["ticker"]
        if ticker not in lookup:
            skipped.append((ticker, "no CIK in SEC mappings"))
            continue
        cik, series_id = lookup[ticker]
        try:
            inserted, scanned = process_ticker(sb, ticker, cik, series_id, cutoff)
        except Exception as e:
            skipped.append((ticker, f"{type(e).__name__}: {e}"))
            continue
        if scanned == 0:
            skipped.append((ticker, "no N-PORT filings found (commodity/crypto trust?)"))
            continue
        ok += 1
        total_rows += inserted
        elapsed = time.monotonic() - t0
        print(f"[{i}/{len(universe)}] {ticker:6}  {inserted} snapshots from {scanned} N-PORTs  ({elapsed:.0f}s)", flush=True)

    print(f"\n=== Summary ===", flush=True)
    print(f"OK            : {ok}/{len(universe)}", flush=True)
    print(f"Rows upserted : {total_rows}", flush=True)
    if skipped:
        print(f"Skipped ({len(skipped)}):", flush=True)
        for t, reason in skipped:
            print(f"  {t:6}  {reason}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
