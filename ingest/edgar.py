"""EDGAR ingestion: fetches recent filings for tracked filers.

Driven by config/tracked_filers.yml. For each filer with a CIK, hits
EDGAR's official JSON submissions API, filters to tracked form types,
and upserts into filings_raw deduped by accession_number.

Entry points:
  python -m ingest.edgar          # ingest all filers with CIKs
  python -m ingest.edgar smoke    # Berkshire-only debug run

Per CLAUDE.md:
  §2.4 — raw_payload is the source of truth; we persist what EDGAR returned,
         we do not summarize or invent.
  §2.6 — period_of_report is captured so the UI can compute and display
         the 13F 45-day delay caveat.
  §5   — ingest workers connect with SUPABASE_SECRET_KEY and bypass RLS.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from ruamel.yaml import YAML
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

EDGAR_USER_AGENT = os.environ["EDGAR_USER_AGENT"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

EDGAR_HEADERS = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}

FILERS_PATH = PROJECT_ROOT / "config" / "tracked_filers.yml"

# Forms we care about. Anything else returned by EDGAR is ignored at this layer.
TRACKED_FORM_TYPES = {
    "13F-HR", "13F-HR/A",
    "SC 13D", "SC 13D/A",
    "SC 13G", "SC 13G/A",
    "4", "4/A",
    "8-K", "8-K/A",
}

# 8-Ks are filed for many reasons; most are noise (routine SOX governance,
# auditor changes, etc.). We keep only those reporting *material* item numbers.
# Item map (SEC's 8-K item structure):
#   1.01 — Entry into a Material Definitive Agreement (M&A LOIs, partnerships)
#   2.01 — Completion of Acquisition or Disposition of Assets
#   5.02 — Departure / Election of Directors or Officers (CEO/CFO changes)
#   8.01 — Other Material Events (catch-all for material disclosures, often
#          investment announcements when no other item fits)
# Add more if you want broader coverage; remove to tighten.
MATERIAL_8K_ITEMS = {"1.01", "2.01", "5.02", "8.01"}

# EDGAR allows 10 req/s. We target 8 to leave headroom.
MIN_INTERVAL_S = 1.0 / 8

_last_request_at = 0.0


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _polite_get(url: str) -> requests.Response:
    """GET with rate-limiting + retry on 5xx (EDGAR is mostly stable but
    submissions endpoint occasionally returns 5xx under load)."""
    global _last_request_at
    last_exc: Exception | None = None
    for attempt in range(3):
        delta = time.monotonic() - _last_request_at
        if delta < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - delta)
        try:
            resp = requests.get(url, headers=EDGAR_HEADERS, timeout=30)
            _last_request_at = time.monotonic()
            if 500 <= resp.status_code < 600:
                raise requests.HTTPError(f"{resp.status_code} server error", response=resp)
            resp.raise_for_status()
            return resp
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            time.sleep(1.5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


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
    items_col = recent.get("items", [""] * n)  # missing on some old filings
    for i in range(n):
        form = recent["form"][i]
        if form not in TRACKED_FORM_TYPES:
            continue
        # 8-K item-number gate: drop noise like auditor changes, routine governance.
        if form in ("8-K", "8-K/A"):
            raw_items = (items_col[i] or "") if i < len(items_col) else ""
            items_list = [x.strip() for x in raw_items.split(",") if x.strip()]
            if not any(item in MATERIAL_8K_ITEMS for item in items_list):
                continue
        acc = recent["accessionNumber"][i]
        primary_doc = recent["primaryDocument"][i]
        acc_nodash = acc.replace("-", "")
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

    Returns (newly_inserted, total_seen).
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


def load_filers_with_ciks() -> list[dict[str, Any]]:
    """Read tracked_filers.yml, return entries that have a non-null CIK.

    Filers with cik: null are skipped here and logged as TODOs by the caller.
    """
    yaml = YAML()
    with FILERS_PATH.open() as f:
        data = yaml.load(f)
    out: list[dict[str, Any]] = []
    for entry in data["filers"]:
        cik = entry.get("cik")
        name = entry.get("name", "")
        if not name or name.startswith("TODO"):
            continue
        out.append({"cik": cik, "name": name, "category": entry.get("category")})
    return out


def ingest_filer(cik: str, name: str) -> dict[str, Any]:
    """Fetch + extract + upsert for one filer. Returns a summary dict."""
    submissions = fetch_filer_submissions(cik)
    rows = extract_filing_rows(submissions)
    inserted, total = upsert_filings(rows)
    return {
        "name": name,
        "cik": cik.zfill(10),
        "edgar_name": submissions.get("name"),
        "total_seen": total,
        "newly_inserted": inserted,
    }


def smoke_test_berkshire() -> None:
    """Single-filer debug run."""
    cik = "0001067983"
    print(f"Smoke test: Berkshire (CIK {cik})…")
    summary = ingest_filer(cik, "Berkshire Hathaway")
    print(f"  EDGAR name: {summary['edgar_name']}")
    print(f"  Inserted {summary['newly_inserted']} new "
          f"({summary['total_seen'] - summary['newly_inserted']} dedup'd).")


def ingest_all_filers() -> None:
    """Loop over every filer in tracked_filers.yml with a non-null CIK."""
    filers = load_filers_with_ciks()
    todos: list[str] = [f["name"] for f in filers if f["cik"] is None]
    actionable = [f for f in filers if f["cik"] is not None]

    print(f"Ingesting {len(actionable)} filers ({len(todos)} skipped, CIK still null).\n")

    grand_inserted = 0
    grand_seen = 0
    errors: list[tuple[str, str]] = []

    for i, f in enumerate(actionable, 1):
        cik = f["cik"]
        name = f["name"]
        print(f"[{i}/{len(actionable)}] {name}")
        try:
            summary = ingest_filer(cik, name)
        except Exception as e:
            errors.append((name, str(e)))
            print(f"    ERROR: {e}")
            continue
        grand_inserted += summary["newly_inserted"]
        grand_seen += summary["total_seen"]
        print(f"    {summary['newly_inserted']} new, "
              f"{summary['total_seen'] - summary['newly_inserted']} dedup'd "
              f"(EDGAR name: {summary['edgar_name']})")

    print(f"\n=== Summary ===")
    print(f"Filers ingested : {len(actionable) - len(errors)}/{len(actionable)}")
    print(f"Total filings   : {grand_seen}")
    print(f"Newly inserted  : {grand_inserted}")
    print(f"Dedup'd         : {grand_seen - grand_inserted}")
    if todos:
        print(f"\nSkipped (CIK still null in YAML):")
        for n in todos:
            print(f"  - {n}")
    if errors:
        print(f"\nErrors:")
        for n, msg in errors:
            print(f"  - {n}: {msg}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "smoke":
        smoke_test_berkshire()
    else:
        ingest_all_filers()
