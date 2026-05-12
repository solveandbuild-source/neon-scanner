"""CIK resolver — looks up missing CIKs in config/tracked_filers.yml.

For each filer with `cik: null`, queries EDGAR's full-text search for 13F-HR
filings under that name, picks the dominant CIK (most filings + name match),
and writes it back to the YAML preserving comments and formatting.

Ambiguous or no-match cases are left as `null` and surfaced to the operator
at the end of the run for manual review — we never silently guess.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import DoubleQuotedScalarString

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

EDGAR_USER_AGENT = os.environ["EDGAR_USER_AGENT"]
EDGAR_HEADERS = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
MIN_INTERVAL_S = 1.0 / 8

FILERS_PATH = PROJECT_ROOT / "config" / "tracked_filers.yml"

_last_request_at = 0.0


def _polite_get(url: str, params: dict[str, str] | None = None) -> requests.Response:
    """GET with rate-limiting + retry on 5xx (EDGAR search occasionally 500s)."""
    global _last_request_at
    last_exc: Exception | None = None
    for attempt in range(3):
        delta = time.monotonic() - _last_request_at
        if delta < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - delta)
        try:
            resp = requests.get(url, params=params, headers=EDGAR_HEADERS, timeout=30)
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


def strip_parenthetical(name: str) -> str:
    """'Baupost Group (Klarman)' -> 'Baupost Group'"""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


def search_edgar(query: str, forms: str = "13F-HR") -> list[dict[str, Any]]:
    """Full-text search EDGAR for filings matching the quoted query and form set."""
    resp = _polite_get(
        "https://efts.sec.gov/LATEST/search-index",
        params={"q": f'"{query}"', "forms": forms, "hits": "50"},
    )
    return resp.json().get("hits", {}).get("hits", [])


def resolve_cik(filer_name: str) -> tuple[str | None, str, list[tuple[str, str, int]]]:
    """Look up a CIK for one filer.

    Returns (cik_or_None, status, candidates) where status ∈
    {'resolved', 'ambiguous', 'no_match'} and candidates is
    [(cik, display_name, hit_count), ...] in descending hit_count order.
    """
    query = strip_parenthetical(filer_name)
    hits = search_edgar(query)
    if not hits:
        return None, "no_match", []

    by_cik: dict[str, tuple[str, int]] = {}
    for h in hits:
        src = h["_source"]
        ciks = src.get("ciks", [])
        names = src.get("display_names", [])
        for cik, display in zip(ciks, names):
            prev = by_cik.get(cik)
            by_cik[cik] = (display, (prev[1] if prev else 0) + 1)

    candidates = sorted(
        [(cik, name, count) for cik, (name, count) in by_cik.items()],
        key=lambda t: -t[2],
    )

    # Hard filter: the EDGAR display name must contain the cleaned query as a
    # substring. EDGAR full-text search is fuzzy and will return tangential
    # hits — we don't trust those.
    query_lower = query.lower()
    name_matches = [c for c in candidates if query_lower in c[1].lower()]

    if not name_matches:
        return None, "no_match", candidates[:5]

    # Single match, or top is at least 2x runner-up → resolved.
    if len(name_matches) == 1:
        return name_matches[0][0], "resolved", name_matches
    if name_matches[0][2] >= 2 * name_matches[1][2]:
        return name_matches[0][0], "resolved", name_matches[:5]
    return None, "ambiguous", name_matches[:5]


def main() -> None:
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)

    with FILERS_PATH.open() as f:
        data = yaml.load(f)

    resolved: list[tuple[str, str, str]] = []
    ambiguous: list[tuple[str, list[tuple[str, str, int]]]] = []
    no_match: list[tuple[str, list[tuple[str, str, int]]]] = []
    errored: list[tuple[str, str]] = []

    def _save() -> None:
        with FILERS_PATH.open("w") as f:
            yaml.dump(data, f)

    try:
        for entry in data["filers"]:
            if entry.get("cik") is not None:
                continue
            name = entry.get("name", "")
            if not name or name.startswith("TODO"):
                continue

            print(f"Resolving: {name}")
            try:
                cik, status, candidates = resolve_cik(name)
            except Exception as e:
                errored.append((name, str(e)))
                print(f"  -> ERROR: {e}")
                continue

            if status == "resolved":
                cik_padded = cik.zfill(10)
                # DoubleQuotedScalarString keeps formatting consistent with the
                # entries that were pre-filled in the template.
                entry["cik"] = DoubleQuotedScalarString(cik_padded)
                # Clear the trailing '# TODO' comment on the cik key — no longer accurate.
                if hasattr(entry, "ca") and entry.ca.items.get("cik"):
                    entry.ca.items.pop("cik", None)
                resolved.append((name, cik_padded, candidates[0][1]))
                print(f"  -> {cik_padded}  {candidates[0][1]}")
                _save()  # incremental save so partial progress survives crashes
            elif status == "ambiguous":
                ambiguous.append((name, candidates))
                print("  -> AMBIGUOUS:")
                for c, dn, count in candidates:
                    print(f"     {c.zfill(10)}  {dn}  ({count} hits)")
            else:
                no_match.append((name, candidates))
                print("  -> NO MATCH")
                for c, dn, count in candidates:
                    print(f"     (fuzzy) {c.zfill(10)}  {dn}  ({count} hits)")
    finally:
        _save()

    print("\n=== Summary ===")
    print(f"Resolved : {len(resolved)}")
    print(f"Ambiguous: {len(ambiguous)}")
    print(f"No match : {len(no_match)}")
    print(f"Errored  : {len(errored)}")
    if ambiguous:
        print("\nAmbiguous (you decide):")
        for name, cands in ambiguous:
            print(f"  - {name}")
            for c, dn, count in cands:
                print(f"      {c.zfill(10)}  {dn}  ({count} hits)")
    if no_match:
        print("\nNo match (you decide):")
        for name, _ in no_match:
            print(f"  - {name}")
    if errored:
        print("\nErrored (rerun the script to retry these):")
        for name, msg in errored:
            print(f"  - {name}: {msg}")


if __name__ == "__main__":
    main()
