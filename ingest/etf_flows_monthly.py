"""Backfill etf_flows_monthly from SEC DERA's N-PORT structured datasets.

Why: the public N-PORT XML omits Part D (shareholder flow info) by SEC rule —
sales_flow_mon{1,2,3}, redemption_flow_mon{1,2,3}, and reinvestment_flow_mon{1,2,3}
are absent from the per-filing primary_doc.xml. They ARE published in the
DERA quarterly bulk datasets at
  https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets
inside FUND_REPORTED_INFO.tsv. This script downloads each quarterly zip,
extracts the 3 small TSVs we need (~8MB out of ~400MB per zip), joins
REGISTRANT → SUBMISSION → FUND_REPORTED_INFO, filters to our universe,
computes net_flow per month, and upserts into etf_flows_monthly.

Each N-PORT filing covers a 3-month reporting period:
  MON3 = report_date (end of reporting period)
  MON2 = report_date − 1 calendar month
  MON1 = report_date − 2 calendar months
Each month_end is the last day of that calendar month.

Data has ~60-day lag (Q1 2026 filings due May 30, 2026). UI must surface this.

Usage:
  python -m ingest.etf_flows_monthly                 # default: 2y back
  python -m ingest.etf_flows_monthly --years 3
  python -m ingest.etf_flows_monthly --quarters 2026q1
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import sys
import time
import zipfile
from datetime import date, datetime, timedelta
from io import TextIOWrapper
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
EDGAR_USER_AGENT = os.environ["EDGAR_USER_AGENT"]

CACHE_DIR = Path("/tmp/dera_nport")
CACHE_DIR.mkdir(exist_ok=True)

DERA_URL_TMPL = "https://www.sec.gov/files/dera/data/form-n-port-data-sets/{q}_nport.zip"

# We only need 3 of the 32 TSVs in each zip
NEEDED_TSVS = ("SUBMISSION.tsv", "REGISTRANT.tsv", "FUND_REPORTED_INFO.tsv")


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


# ─── ticker → (cik, series_id) lookup (same approach as etf_flows.py) ──
def fetch_ticker_lookup() -> dict[str, tuple[str, str | None]]:
    headers = {"User-Agent": EDGAR_USER_AGENT}
    lookup: dict[str, tuple[str, str | None]] = {}
    r = requests.get("https://www.sec.gov/files/company_tickers_mf.json", headers=headers, timeout=30)
    if r.ok:
        for row in r.json().get("data", []):
            cik, series_id, _class_id, ticker = row
            lookup[ticker] = (str(cik).zfill(10), series_id)
    r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=headers, timeout=30)
    if r.ok:
        for entry in r.json().values():
            ticker = entry.get("ticker")
            cik = entry.get("cik_str")
            if ticker and ticker not in lookup:
                lookup[ticker] = (str(cik).zfill(10), None)
    return lookup


def load_universe_tickers() -> list[str]:
    import yaml
    with (PROJECT_ROOT / "config" / "etf_universe.yml").open() as f:
        data = yaml.safe_load(f)
    return [e["ticker"] for e in data.get("etfs", [])]


# ─── quarter list ───────────────────────────────────────────────────────
def quarters_back(years: float) -> list[str]:
    today = date.today()
    cutoff = today - timedelta(days=int(years * 365))
    # All released DERA quarters from 2019Q4 → most recent (~current_quarter − 1)
    out: list[str] = []
    y = cutoff.year
    q = (cutoff.month - 1) // 3 + 1
    while True:
        # Stop one quarter behind the current quarter (DERA publishes ~60d after q-end)
        if (y, q) > _latest_published_quarter(today):
            break
        out.append(f"{y}q{q}")
        q += 1
        if q > 4:
            q = 1
            y += 1
    return out


def _latest_published_quarter(today: date) -> tuple[int, int]:
    """DERA publishes one quarter behind. Returns (year, quarter) of the most
    recent quarter we expect to be downloadable. If the download 404s we just
    skip it — being slightly too aggressive is fine.
    """
    cur_y = today.year
    cur_q = (today.month - 1) // 3 + 1
    prev_q = cur_q - 1
    prev_y = cur_y
    if prev_q == 0:
        prev_q = 4
        prev_y -= 1
    return (prev_y, prev_q)


# ─── download / extract ────────────────────────────────────────────────
def download_quarter(q: str) -> Path | None:
    """Download one DERA quarterly zip if not cached. Return path or None."""
    out = CACHE_DIR / f"{q}_nport.zip"
    if out.exists() and out.stat().st_size > 1_000_000:
        return out
    url = DERA_URL_TMPL.format(q=q)
    print(f"  fetching {url}", flush=True)
    headers = {"User-Agent": EDGAR_USER_AGENT}
    with requests.get(url, headers=headers, stream=True, timeout=300) as r:
        if not r.ok:
            print(f"  HTTP {r.status_code} for {q}", flush=True)
            return None
        with out.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    return out


# ─── parse one quarter zip → list of monthly flow rows for our tickers ─
def process_quarter(
    zip_path: Path,
    ticker_by_series: dict[str, str],
    ticker_by_cik_only: dict[str, str],
) -> list[dict[str, Any]]:
    """Extract our universe's monthly flows from this quarterly DERA zip.

    ticker_by_series:  series_id → ticker  (for multi-series trusts)
    ticker_by_cik_only: cik → ticker       (for single-fund trusts w/o series_id)
    """
    with zipfile.ZipFile(zip_path) as z:
        # 1) REGISTRANT: accession → cik
        acc_to_cik: dict[str, str] = {}
        with z.open("REGISTRANT.tsv") as raw:
            reader = csv.DictReader(TextIOWrapper(raw, "utf-8"), delimiter="\t")
            for row in reader:
                acc_to_cik[row["ACCESSION_NUMBER"]] = row["CIK"]

        # 2) SUBMISSION: accession → report_date (we want only NPORT-P)
        acc_to_report: dict[str, str] = {}
        with z.open("SUBMISSION.tsv") as raw:
            reader = csv.DictReader(TextIOWrapper(raw, "utf-8"), delimiter="\t")
            for row in reader:
                if row.get("SUB_TYPE") not in ("NPORT-P", "NPORT-P/A"):
                    continue
                acc_to_report[row["ACCESSION_NUMBER"]] = row["REPORT_DATE"]

        # 3) FUND_REPORTED_INFO: extract flow rows for tickers we care about
        out: list[dict[str, Any]] = []
        with z.open("FUND_REPORTED_INFO.tsv") as raw:
            reader = csv.DictReader(TextIOWrapper(raw, "utf-8"), delimiter="\t")
            for row in reader:
                acc = row["ACCESSION_NUMBER"]
                series_id = row.get("SERIES_ID") or ""
                # Match by series first, fall back to CIK-only (single-series trusts)
                ticker = ticker_by_series.get(series_id)
                if not ticker:
                    cik = acc_to_cik.get(acc)
                    if cik:
                        ticker = ticker_by_cik_only.get(cik)
                if not ticker:
                    continue
                report_date_str = acc_to_report.get(acc)
                if not report_date_str:
                    continue
                # REPORT_DATE format like "31-MAR-2026"
                try:
                    rd = datetime.strptime(report_date_str, "%d-%b-%Y").date()
                except ValueError:
                    continue
                # MON3 = report month, MON2 = -1 month, MON1 = -2 months
                month_ends = [
                    _month_end(rd, offset=-2),
                    _month_end(rd, offset=-1),
                    _month_end(rd, offset=0),
                ]
                for i, me in enumerate(month_ends, 1):
                    sales = _f(row.get(f"SALES_FLOW_MON{i}"))
                    redem = _f(row.get(f"REDEMPTION_FLOW_MON{i}"))
                    reinv = _f(row.get(f"REINVESTMENT_FLOW_MON{i}"))
                    if sales is None and redem is None and reinv is None:
                        continue
                    net = (sales or 0) + (reinv or 0) - (redem or 0)
                    out.append({
                        "ticker": ticker,
                        "month_end": me.isoformat(),
                        "net_flow_usd": net,
                        "sales_flow_usd": sales,
                        "redemption_flow_usd": redem,
                        "reinvestment_flow_usd": reinv,
                        "source_accession": acc,
                    })
        return out


def _f(v: str | None) -> float | None:
    if v is None or v == "" or v == "N/A":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _month_end(d: date, offset: int) -> date:
    """End of month for the calendar month containing (d shifted by `offset` months)."""
    y, m = d.year, d.month + offset
    while m <= 0:
        y -= 1
        m += 12
    while m > 12:
        y += 1
        m -= 12
    # Last day of month
    if m == 12:
        return date(y, 12, 31)
    return date(y, m + 1, 1) - timedelta(days=1)


# ─── main ───────────────────────────────────────────────────────────────
def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--years", type=float, default=2.0)
    p.add_argument("--quarters", nargs="+", help="Override: specific quarters e.g. 2026q1 2025q4")
    p.add_argument("--keep-zips", action="store_true", help="Don't delete zip files after extraction")
    args = p.parse_args()

    tickers = load_universe_tickers()
    print(f"Universe: {len(tickers)} tickers", flush=True)

    print("Fetching ticker → CIK/series lookup…", flush=True)
    lookup = fetch_ticker_lookup()
    # Build inverse indexes
    ticker_by_series: dict[str, str] = {}
    ticker_by_cik_only: dict[str, str] = {}
    for t in tickers:
        if t not in lookup:
            continue
        cik, sid = lookup[t]
        if sid:
            ticker_by_series[sid] = t
        else:
            ticker_by_cik_only[cik] = t
    print(f"  {len(ticker_by_series)} series-indexed, {len(ticker_by_cik_only)} CIK-only-indexed", flush=True)

    qs = args.quarters or quarters_back(args.years)
    print(f"Quarters to ingest: {qs}\n", flush=True)

    sb = _supabase()
    all_rows: list[dict[str, Any]] = []
    t0 = time.monotonic()
    for q in qs:
        print(f"[{q}] downloading…", flush=True)
        path = download_quarter(q)
        if not path:
            print(f"  skip {q}: download failed", flush=True)
            continue
        print(f"[{q}] parsing…", flush=True)
        try:
            rows = process_quarter(path, ticker_by_series, ticker_by_cik_only)
        except (KeyError, zipfile.BadZipFile) as e:
            print(f"  skip {q}: {type(e).__name__}: {e}", flush=True)
            if not args.keep_zips:
                path.unlink(missing_ok=True)
            continue
        print(f"[{q}] {len(rows)} monthly rows extracted ({time.monotonic()-t0:.0f}s elapsed)", flush=True)
        all_rows.extend(rows)
        if not args.keep_zips:
            path.unlink(missing_ok=True)

    if not all_rows:
        print("Nothing to upsert.", flush=True)
        return

    # Dedup: same (ticker, month_end) can appear in 2 quarters' filings (filing
    # period overlap). Keep the row from the LATER source_accession (more recent
    # filing = more recent restatement).
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for r in all_rows:
        k = (r["ticker"], r["month_end"])
        prev = by_key.get(k)
        if prev is None or r["source_accession"] > prev["source_accession"]:
            by_key[k] = r
    deduped = list(by_key.values())
    print(f"\nUpserting {len(deduped)} unique (ticker, month_end) rows…", flush=True)
    for i in range(0, len(deduped), 500):
        batch = deduped[i:i + 500]
        sb.table("etf_flows_monthly").upsert(batch, on_conflict="ticker,month_end").execute()
    print("Done.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
