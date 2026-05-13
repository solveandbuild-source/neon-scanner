"""SC 13D / 13G parser.

Unlike 13F-HR (structured XML) and Form 4 (structured XML), 13D/G filings
have unstructured HTML bodies. Their cover pages contain key data
— issuer name, CUSIP, percent owned, event date — but in textual form.

We use regex extractors against the cover-page HTML. They're heuristic by
necessity, and will miss edge cases. What we get:
  - cusip            (reliable — "CUSIP No. 123456789")
  - percent_owned    (reliable when filed by humans)
  - issuer_name      (less reliable — many layout variants)
  - event_date       (filings_raw.filed_at is a fine fallback)

What we always have from filings_raw:
  - filing_id, cik (the filer), form_subtype ('13D','13D/A','13G','13G/A')
  - filed_at (close enough proxy for event_date)

So even on extraction failure we still insert a row with the filer + form
subtype + null fields. Downstream code can read the filing on sec.gov for
specifics; this captures "X filed 13D against Y" presence.

Idempotent via delete-by-filing_id-then-insert.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
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

HEADERS = {"User-Agent": EDGAR_USER_AGENT, "Accept": "text/html,*/*"}
HEADERS_JSON = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}

MIN_INTERVAL_S = 1.0 / 8
_last_request_at = 0.0


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _polite_get(url: str, headers: dict[str, str] = HEADERS) -> requests.Response:
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
                raise requests.HTTPError(f"{r.status_code} server", response=r)
            return r
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            time.sleep(1.5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


# regex extractors. designed for common SC 13D/G layouts; will miss edge cases.
_RX_CUSIP = re.compile(r"CUSIP\s*(?:No\.?|Number)?\s*[:.\-]?\s*\n?\s*([0-9A-Z]{6,9}[\s\-]?\d{0,3})", re.I)
_RX_PERCENT = re.compile(
    r"(?:PERCENT\s+OF\s+CLASS\s+REPRESENTED\s+BY\s+AMOUNT.*?)([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%",
    re.I | re.S,
)
# Heuristic issuer-name extractor: 'NAME OF ISSUER' or '(Name of Issuer)' line
_RX_ISSUER = re.compile(
    r"(?:NAME\s+OF\s+ISSUER\s*[:\)\n]+\s*([A-Z][A-Z0-9 ,.&\-\(\)'/]{2,80}))",
    re.I,
)
_RX_TAG = re.compile(r"<[^>]+>")
_RX_WS = re.compile(r"\s+")


def _strip_html(html: str) -> str:
    """Naïve HTML → plain text. Sufficient for cover-page regex extraction."""
    txt = _RX_TAG.sub(" ", html)
    txt = _RX_WS.sub(" ", txt)
    return txt


def fetch_cover_html(cik: str, accession: str, primary_doc_url: str | None) -> str | None:
    if primary_doc_url:
        r = _polite_get(primary_doc_url, HEADERS)
        if r.status_code == 200:
            return r.text
    # Fallback: index.json → grab first HTML/HTM file
    acc_nodash = accession.replace("-", "")
    cik_int = int(cik)
    r = _polite_get(
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/index.json", HEADERS_JSON
    )
    if r.status_code != 200:
        return None
    files = r.json().get("directory", {}).get("item", [])
    for f in files:
        nm = f["name"].lower()
        if nm.endswith(".htm") or nm.endswith(".html"):
            r2 = _polite_get(
                f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{f['name']}", HEADERS
            )
            if r2.status_code == 200:
                return r2.text
    return None


def extract_fields(html: str) -> dict[str, Any]:
    txt = _strip_html(html)
    out: dict[str, Any] = {"cusip": None, "percent_owned": None, "issuer_name": None}

    m = _RX_CUSIP.search(txt)
    if m:
        c = m.group(1).replace("-", "").replace(" ", "").strip()
        if 6 <= len(c) <= 12:
            out["cusip"] = c

    m = _RX_PERCENT.search(txt)
    if m:
        try:
            out["percent_owned"] = float(m.group(1))
        except ValueError:
            pass

    m = _RX_ISSUER.search(txt)
    if m:
        name = m.group(1).strip()
        # trim trailing 'CUSIP' or other noise that the greedy match might capture
        for stop in (" CUSIP", " (Name of", " 2.", " 3."):
            i = name.find(stop)
            if i > 0:
                name = name[:i]
        out["issuer_name"] = name.strip(" ,.-")

    return out


_FORM_TO_SUBTYPE = {
    "SC 13D": "13D",
    "SC 13D/A": "13D/A",
    "SC 13G": "13G",
    "SC 13G/A": "13G/A",
    # EDGAR migrated to these strings in late 2024 — same semantic forms,
    # different label. Map both to the same normalized subtype.
    "SCHEDULE 13D": "13D",
    "SCHEDULE 13D/A": "13D/A",
    "SCHEDULE 13G": "13G",
    "SCHEDULE 13G/A": "13G/A",
}


def parse_one_filing(filing: dict[str, Any]) -> tuple[int, str | None]:
    html = fetch_cover_html(filing["cik"], filing["accession_number"], filing.get("primary_doc_url"))
    if not html:
        # Still write a row with nulls so we know the filing exists in events_13d
        fields = {"cusip": None, "percent_owned": None, "issuer_name": None}
    else:
        fields = extract_fields(html)

    sb = _supabase()
    sb.table("events_13d").delete().eq("filing_id", filing["id"]).execute()
    row = {
        "filing_id": filing["id"],
        "cik": filing["cik"],
        "issuer_cik": None,  # not always extractable from cover page
        "issuer_name": fields["issuer_name"],
        "ticker": None,
        "form_subtype": _FORM_TO_SUBTYPE.get(filing["form_type"], filing["form_type"]),
        "percent_owned": fields["percent_owned"],
        "event_date": filing["filed_at"][:10] if filing.get("filed_at") else None,
    }
    sb.table("events_13d").insert(row).execute()
    return 1, None


def get_unparsed(sb: Client, reparse: bool = False) -> list[dict[str, Any]]:
    all_filings: list[dict[str, Any]] = []
    offset = 0
    while True:
        b = (
            sb.table("filings_raw")
            .select("id,accession_number,cik,form_type,filer_name,filed_at,primary_doc_url")
            .in_("form_type", [
                "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A",
                "SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A",
            ])
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
        b = sb.table("events_13d").select("filing_id").range(offset, offset + 999).execute()
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
    pending = get_unparsed(sb, reparse=args.reparse)
    if args.limit:
        pending = pending[: args.limit]
    print(f"To parse: {len(pending)} 13D/G filings.\n", flush=True)

    t0 = time.monotonic()
    parsed = 0
    errors: list[tuple[str, str]] = []
    extracted_pct = 0  # how many got percent_owned populated (extraction success indicator)

    for i, f in enumerate(pending, 1):
        try:
            n, err = parse_one_filing(f)
            parsed += n
        except Exception as e:
            errors.append((f["accession_number"], f"{type(e).__name__}: {e}"))
        if i <= 10 or i % 100 == 0 or i == len(pending):
            elapsed = time.monotonic() - t0
            print(f"[{i}/{len(pending)}] {f['filer_name'] or f['cik']}  ({elapsed:.0f}s)", flush=True)

    # report extraction rate
    if parsed > 0:
        r = sb.table("events_13d").select("percent_owned", count="exact").not_.is_("percent_owned", None).execute()
        print(f"\n=== Summary ===", flush=True)
        print(f"Filings parsed   : {parsed}/{len(pending)}", flush=True)
        print(f"Errors           : {len(errors)}", flush=True)
        print(f"With % extracted : {r.count} of total (across all runs)", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
