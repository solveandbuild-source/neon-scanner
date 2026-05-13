"""Form 4 XML parser.

For each Form 4 / Form 4-A filing in filings_raw, fetches the XML body
and writes one row per non-derivative transaction into events_form4.

Each Form 4 has:
  - One issuer (the public company whose stock is being traded)
  - One or more reportingOwners (the insiders — officers, directors, 10%+ holders)
  - Zero or more non-derivative transactions (common stock buys/sells)
  - Zero or more derivative transactions (options/RSUs — we ignore for v1)

Transaction codes worth knowing:
  P = open-market or private purchase (the signal-bearing kind)
  S = open-market or private sale
  A = grant/award (RSU vesting, etc. — mostly noise)
  D = disposition non-open-market
  F = payment of tax via shares
  M = exercise of derivative
  G = gift
We persist all codes; downstream code can filter.

Idempotent via delete-by-filing_id-then-insert per filing.

Usage:
  python -m ingest.parse_form4              # all unparsed
  python -m ingest.parse_form4 --limit 10   # smoke test
  python -m ingest.parse_form4 --reparse    # ignore parsed state
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import xml.etree.ElementTree as ET
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

HEADERS_JSON = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
HEADERS_XML = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/xml,text/xml,*/*"}

MIN_INTERVAL_S = 1.0 / 8
_last_request_at = 0.0


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _polite_get(url: str, headers: dict[str, str]) -> requests.Response:
    global _last_request_at
    last_exc: Exception | None = None
    for attempt in range(3):
        delta = time.monotonic() - _last_request_at
        if delta < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - delta)
        try:
            r = requests.get(url, headers=headers, timeout=30)
            _last_request_at = time.monotonic()
            if 500 <= r.status_code < 600:
                raise requests.HTTPError(f"{r.status_code} server error", response=r)
            return r
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            time.sleep(1.5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _text_of(elem: ET.Element | None, *path: str) -> str | None:
    """Walk a tag-name path; return text or None."""
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


def fetch_form4_xml(cik: str, accession: str, primary_doc_url: str | None) -> bytes | None:
    """Try the stored primary_doc_url first; fall back to index.json to find XML."""
    # Most Form 4s have a structured XML as primary doc — fast path.
    if primary_doc_url and primary_doc_url.endswith(".xml"):
        r = _polite_get(primary_doc_url, HEADERS_XML)
        if r.status_code == 200:
            return r.content
    # Fallback: index.json → find the form4 XML
    acc_nodash = accession.replace("-", "")
    cik_int = int(cik)
    idx_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/index.json"
    r = _polite_get(idx_url, HEADERS_JSON)
    if r.status_code != 200:
        return None
    files = r.json().get("directory", {}).get("item", [])
    xmls = [f["name"] for f in files if f["name"].endswith(".xml")]
    if not xmls:
        return None
    pick = next(
        (n for n in xmls if "form4" in n.lower() or "wf-form" in n.lower() or "ownership" in n.lower()),
        xmls[0],
    )
    url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{pick}"
    r = _polite_get(url, HEADERS_XML)
    return r.content if r.status_code == 200 else None


def parse_form4(xml_bytes: bytes) -> list[dict[str, Any]]:
    """Parse Form 4 XML into a list of (one row per non-derivative transaction)."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    # Issuer (one)
    issuer_elem = next((c for c in root if _localname(c.tag) == "issuer"), None)
    issuer_cik = _text_of(issuer_elem, "issuerCik")
    issuer_name = _text_of(issuer_elem, "issuerName")
    ticker = _text_of(issuer_elem, "issuerTradingSymbol")

    # Reporting owner (usually one, sometimes more for joint filings)
    owners = []
    for c in root:
        if _localname(c.tag) != "reportingOwner":
            continue
        owners.append({
            "cik": _text_of(c, "reportingOwnerId", "rptOwnerCik"),
            "name": _text_of(c, "reportingOwnerId", "rptOwnerName"),
        })
    primary_owner = owners[0] if owners else {"cik": None, "name": None}

    # Walk non-derivative transactions
    rows: list[dict[str, Any]] = []
    for table in root:
        if _localname(table.tag) != "nonDerivativeTable":
            continue
        for tx in table:
            if _localname(tx.tag) != "nonDerivativeTransaction":
                continue
            tx_date = _text_of(tx, "transactionDate", "value")
            tx_code = _text_of(tx, "transactionCoding", "transactionCode")
            shares = _text_of(tx, "transactionAmounts", "transactionShares", "value")
            price = _text_of(tx, "transactionAmounts", "transactionPricePerShare", "value")
            if not tx_date or not tx_code:
                continue
            try:
                shares_num = float(shares) if shares else None
            except ValueError:
                shares_num = None
            try:
                price_num = float(price) if price else None
            except ValueError:
                price_num = None
            rows.append({
                "reporter_cik": (primary_owner["cik"] or "").zfill(10) if primary_owner["cik"] else None,
                "reporter_name": primary_owner["name"],
                "issuer_cik": (issuer_cik or "").zfill(10) if issuer_cik else None,
                "issuer_name": issuer_name,
                "ticker": ticker,
                "transaction_date": tx_date,
                "transaction_code": tx_code,
                "shares": shares_num,
                "price": price_num,
            })
    return rows


def parse_one_filing(filing: dict[str, Any]) -> tuple[int, str | None]:
    body = fetch_form4_xml(
        filing["cik"], filing["accession_number"], filing.get("primary_doc_url")
    )
    if not body:
        return 0, "couldn't fetch xml"
    rows = parse_form4(body)
    if not rows:
        # Genuinely zero non-derivative transactions is legal (filing might be
        # all derivatives), so this isn't strictly an error. But we still
        # don't write anything.
        sb = _supabase()
        sb.table("events_form4").delete().eq("filing_id", filing["id"]).execute()
        return 0, None

    sb = _supabase()
    sb.table("events_form4").delete().eq("filing_id", filing["id"]).execute()

    for r in rows:
        r["filing_id"] = filing["id"]

    for i in range(0, len(rows), 500):
        sb.table("events_form4").insert(rows[i:i + 500]).execute()

    return len(rows), None


def get_unparsed_filings(sb: Client, reparse: bool = False) -> list[dict[str, Any]]:
    """13F-parser-pattern: pull all Form 4 / 4-A; minus those already parsed."""
    all_filings: list[dict[str, Any]] = []
    offset = 0
    while True:
        b = (
            sb.table("filings_raw")
            .select("id,accession_number,cik,filer_name,filed_at,primary_doc_url")
            .in_("form_type", ["4", "4/A"])
            .order("filed_at", desc=True)
            .range(offset, offset + 999)
            .execute()
        )
        if not b.data:
            break
        all_filings.extend(b.data)
        if len(b.data) < 1000:
            break
        offset += 1000

    if reparse:
        return all_filings

    parsed_ids: set[str] = set()
    offset = 0
    while True:
        b = sb.table("events_form4").select("filing_id").range(offset, offset + 999).execute()
        if not b.data:
            break
        parsed_ids.update(r["filing_id"] for r in b.data)
        if len(b.data) < 1000:
            break
        offset += 1000

    return [f for f in all_filings if f["id"] not in parsed_ids]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--reparse", action="store_true")
    args = p.parse_args()

    sb = _supabase()
    pending = get_unparsed_filings(sb, reparse=args.reparse)
    if args.limit:
        pending = pending[: args.limit]

    print(f"To parse: {len(pending)} Form 4 filings.\n", flush=True)
    total = 0
    errors: list[tuple[str, str]] = []
    t0 = time.monotonic()

    for i, f in enumerate(pending, 1):
        try:
            n, err = parse_one_filing(f)
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            n = 0
        if err:
            errors.append((f["accession_number"], err))
        else:
            total += n
        if i <= 10 or i % 100 == 0 or i == len(pending):
            elapsed = time.monotonic() - t0
            print(f"[{i}/{len(pending)}] {f['filer_name'] or f['cik']}  +{n} rows  ({elapsed:.0f}s)", flush=True)

    print(f"\n=== Summary ===", flush=True)
    print(f"Filings parsed : {len(pending) - len(errors)}/{len(pending)}", flush=True)
    print(f"Event rows     : {total:,}", flush=True)
    print(f"Errors         : {len(errors)}", flush=True)
    if errors:
        for acc, err in errors[:5]:
            print(f"  {acc}: {err}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted; partial progress committed.", file=sys.stderr)
        sys.exit(130)
