"""EDGAR ingestion: fetches recent filings for tracked filers.

Phase A (this file's current state): smoke test against Berkshire only.
Phase B (CIK resolution for the 24 nulls) and Phase C (loop over all 30)
are layered on once A is verified end-to-end.

Per CLAUDE.md:
  §2.4 — raw_payload is the source of truth; we persist what EDGAR returned,
         we do not summarize or invent.
  §2.6 — period_of_report is captured so the UI can compute and display
         the 13F 45-day delay caveat.
  §5   — ingest workers connect with SUPABASE_SECRET_KEY and bypass RLS.
  §6.0 — ARK's daily disclosure path lives in a separate (future) module;
         here we only fetch ARK's quarterly 13F via the standard path.
         TODO(ARK-daily): pull ark-funds.com daily trade CSVs in ingest/ark.py.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

EDGAR_USER_AGENT = os.environ["EDGAR_USER_AGENT"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

EDGAR_HEADERS = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}

# Forms we care about. Anything else returned by EDGAR is ignored at this layer.
TRACKED_FORM_TYPES = {
    "13F-HR", "13F-HR/A",
    "SC 13D", "SC 13D/A",
    "SC 13G", "SC 13G/A",
    "4", "4/A",
}

# EDGAR allows 10 req/s. We target 8 to leave headroom.
MIN_INTERVAL_S = 1.0 / 8

_last_request_at = 0.0


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _polite_get(url: str) -> requests.Response:
    """GET with rate-limiting and EDGAR-required User-Agent."""
    global _last_request_at
    delta = time.monotonic() - _last_request_at
    if delta < MIN_INTERVAL_S:
        time.sleep(MIN_INTERVAL_S - delta)
    resp = requests.get(url, headers=EDGAR_HEADERS, timeout=30)
    _last_request_at = time.monotonic()
    resp.raise_for_status()
    return resp


def fetch_filer_submissions(cik: str) -> dict[str, Any]:
    """Pull the submissions index for one filer via EDGAR's official JSON API.

    The 'recent' block in the response contains up to ~1000 most recent
    filings inline. Older filings are paginated into separate files which
    we don't fetch here — recent activity is what drives signals.
    """
    cik_padded = cik.zfill(10)
    url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
    return _polite_get(url).json()


def extract_filing_rows(submissions: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten EDGAR's column-oriented 'recent' filings block into rows.

    EDGAR returns parallel arrays (accessionNumber[], form[], filingDate[], ...).
    We zip into one row per filing and keep only TRACKED_FORM_TYPES.
    """
    cik = str(submissions["cik"]).zfill(10)
    filer_name = submissions.get("name")
    recent = submissions["filings"]["recent"]
    n = len(recent["accessionNumber"])

    rows: list[dict[str, Any]] = []
    for i in range(n):
        form = recent["form"][i]
        if form not in TRACKED_FORM_TYPES:
            continue
        acc = recent["accessionNumber"][i]
        primary_doc = recent["primaryDocument"][i]
        acc_nodash = acc.replace("-", "")
        # EDGAR's archive URL pattern: /Archives/edgar/data/<int_cik>/<acc_nodash>/<file>
        primary_doc_url = (
            f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}/{primary_doc}"
        )
        report_date = recent["reportDate"][i] or None
        rows.append({
            "accession_number": acc,
            "cik": cik,
            "filer_name": filer_name,
            "form_type": form,
            "filed_at": recent["filingDate"][i] + "T00:00:00Z",
            "period_of_report": report_date if report_date else None,
            "primary_doc_url": primary_doc_url,
            # raw_payload: every column EDGAR returned for this row. Source of truth (§2.4).
            "raw_payload": {col: recent[col][i] for col in recent.keys()},
        })
    return rows


def upsert_filings(rows: list[dict[str, Any]]) -> tuple[int, int]:
    """Upsert rows into filings_raw, deduping by accession_number.

    Returns (newly_inserted, total_seen). We pre-query existing accession
    numbers so the smoke-test summary can distinguish new vs. dedup'd.
    """
    if not rows:
        return 0, 0
    sb = _supabase()
    accs = [r["accession_number"] for r in rows]
    existing = (
        sb.table("filings_raw")
        .select("accession_number")
        .in_("accession_number", accs)
        .execute()
    )
    existing_set = {r["accession_number"] for r in existing.data}
    new_rows = [r for r in rows if r["accession_number"] not in existing_set]
    if new_rows:
        sb.table("filings_raw").upsert(new_rows, on_conflict="accession_number").execute()
    return len(new_rows), len(rows)


def smoke_test_berkshire() -> None:
    """Phase A smoke test: end-to-end against one known filer."""
    cik = "0001067983"
    print(f"Fetching EDGAR submissions for Berkshire (CIK {cik})…")
    submissions = fetch_filer_submissions(cik)
    print(f"  Filer name from EDGAR: {submissions.get('name')}")

    rows = extract_filing_rows(submissions)
    print(f"  Found {len(rows)} filings in tracked form types.")
    if rows:
        forms: dict[str, int] = {}
        for r in rows:
            forms[r["form_type"]] = forms.get(r["form_type"], 0) + 1
        print(f"  By form: {forms}")
        most_recent = max(rows, key=lambda r: r["filed_at"])
        print(
            f"  Most recent: {most_recent['form_type']} filed "
            f"{most_recent['filed_at'][:10]} (period {most_recent['period_of_report']})"
        )

    inserted, total = upsert_filings(rows)
    print(f"  Inserted {inserted} new ({total - inserted} already in filings_raw).")


if __name__ == "__main__":
    smoke_test_berkshire()
