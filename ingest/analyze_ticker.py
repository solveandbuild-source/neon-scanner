"""Run deep skeptical analysis on a single ticker using Groq Llama 3.3 70B.

Reads everything we know about the ticker from Supabase, formats it into
the skeptical-analyst prompt, calls Groq, persists the markdown output to
signal_analyses.

Usage:
  python -m ingest.analyze_ticker --ticker AVGO
  python -m ingest.analyze_ticker --watchlist   # analyze everything in watchlist
  python -m ingest.analyze_ticker --watchlist --skip-recent 24   # skip if analyzed in last N hours
"""
from __future__ import annotations

import argparse, json, os, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]

GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MIN_INTERVAL_S = 6.1     # ~10 RPM ceiling; same pattern as summarize_8k.py


def _supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


# ─── Prompt (exact wording from spec) ───────────────────────────────────
SYSTEM_PROMPT = """You are a SKEPTICAL investment analyst doing due diligence.

Your job is NOT to confirm the buy signal. It is to surface every material
consideration honestly. Push back hard on assumptions. If the case is weak,
say so plainly.

RULES:
1. Do NOT hedge with phrases like "could go either way" or "depends".
   Make explicit calls. If uncertain, say WHY.
2. Do NOT confirm the buy signal just because smart money is in it.
   Smart money is wrong frequently. Cite specific examples if you know
   of past misses by these filers.
3. Do NOT use generic investing platitudes ("strong fundamentals", "good
   company"). Every claim must be specific and testable.
4. If the signal LOOKS weak after your review, say "I would not buy this"
   — that's the most valuable output.
5. Cite the filer NAMES in your analysis (not just "smart money").
6. If you don't know something material, say "I don't know X" —
   epistemic humility is required.

Output format: clean markdown, sections 1-6 in order."""


def build_user_prompt(ctx: dict[str, Any]) -> str:
    s = ctx
    return f"""# Subject: {s['ticker']} ({s['company_name'] or 'Unknown'})
Market cap: ${(s['market_cap'] or 0) / 1e9:.1f}B

────────────────────────────────────────────────────────────────────
CONTEXT — SEC filing data, point-in-time, no projections
────────────────────────────────────────────────────────────────────

CURRENT SIGNAL STATE
- Confluence score: {s['score']} (BUY threshold: 4.0)
- Signal types firing: {s['num_sources']} of 7
- Multi-source bonus (★): {'yes' if s.get('multi_source') else 'no'}
- Breakdown: {s['breakdown_str']}

SMART-MONEY POSITIONING (filers that actually moved):
{s['filer_detail'] or '  (none with material activity)'}

INSIDER OPEN-MARKET PURCHASES (last 30 days, code P):
{s['insider_detail'] or '  (no insider buys in window)'}

ACTIVIST 13D CONTEXT:
{s['activist_detail'] or '  (no recent initial 13D)'}

RECENT 8-K MATERIAL EVENTS (LLM-summarized, last 90 days):
{s['eight_k_detail'] or '  (no recent 8-Ks summarized)'}

PRICE CONTEXT
- 1M return: {s['ret_1m']}    6M: {s['ret_6m']}    YTD: {s['ret_ytd']}
- Price stance: {s['price_stance']}

────────────────────────────────────────────────────────────────────
YOUR ANALYSIS — answer ALL six sections, in this exact order
────────────────────────────────────────────────────────────────────

## 1. Business in one paragraph
What does this company actually do? Primary revenue lines, customers,
geography. No marketing language. If you don't know, say so.

## 2. The strongest bull case
The SINGLE best reason to buy at current price. Connect it to a SPECIFIC
filer's known investing style (e.g. Ackman = operational activism on
consumer franchises; Druckenmiller = macro themes). Identify ONE specific
catalyst that would make this work in 6-12 months.

## 3. The strongest bear case
The SINGLE best reason NOT to buy. Look hard at: valuation multiple vs
growth, competitive position, regulatory risk, execution risk (recent
guidance cuts, key departures), cyclicality. Identify ONE specific thing
that could break the thesis. Be willing to say "the bear case is stronger"
if it is.

## 4. Counterargument to the smart money
Why might the filers buying be WRONG? Are any TRIMMING while others add
(mixed signal)? Have similar bets by these filers failed in the last 2
years? Is this a known "value trap" thesis — same filers stuck for years?
Is the activist position likely to result in a sale, or in years of
operational fights?

## 5. What you don't know
List 5 SPECIFIC, RESEARCHABLE items that would change conviction but
aren't in the data above. Examples: "Q4 earnings call commentary on
margin trajectory", "current short interest %", "regulatory filing
schedule". Each item must be checkable via a Google search.

## 6. Honest conclusion
- Conviction: [LOW / MEDIUM / HIGH] — one-sentence why
- Time horizon: [3-6 mo / 1-2 yr / 3+ yr]
- Position sizing: [speculative <2% / normal 2-5% / conviction 5-10%]
- Three specific things to monitor monthly that would change your view
"""


def gather_context(sb: Client, ticker: str) -> dict[str, Any] | None:
    """Pull everything we know about ticker into a structured context dict."""
    # signals_latest row
    r = sb.table("signals_latest").select("*").eq("ticker", ticker).maybeSingle().execute()
    if not r.data:
        return None
    sig = r.data

    # ticker name + market cap
    t_row = sb.table("tickers").select("name,market_cap_usd").eq("ticker", ticker).maybeSingle().execute()
    company_name = (t_row.data or {}).get("name")
    market_cap = (t_row.data or {}).get("market_cap_usd")

    components = sig["components"] or {}
    cf = sig["contributing_filers"] or {}

    breakdown_parts = []
    for key, label in [
        ("insider_cluster", "insider_cluster"),
        ("thirteenf_new", "13F_new"),
        ("thirteenf_add", "13F_add"),
        ("activist_13d", "activist_13D"),
        ("share_velocity", "share_velocity"),
        ("cross_q_confluence", "cross-quarter_confluence"),
    ]:
        c = components.get(key)
        if c and (c.get("n") or 0) > 0:
            breakdown_parts.append(f"{label}={c['n']}")
    breakdown_str = ", ".join(breakdown_parts) or "(none)"

    # Filer detail
    filer_lines = []
    for name in (cf.get("new") or [])[:5]:
        filer_lines.append(f"  • {name}: NEW position in latest 13F")
    for name in (cf.get("add") or [])[:5]:
        filer_lines.append(f"  • {name}: ADDED ≥20% share-count in latest 13F")
    for name, ratio in (cf.get("velocity") or [])[:5]:
        filer_lines.append(f"  • {name}: SHARE COUNT VELOCITY {ratio}x in latest quarter")
    for name in (cf.get("activist") or [])[:3]:
        filer_lines.append(f"  • {name}: filed initial 13D (activist stake disclosure)")
    filer_detail = "\n".join(filer_lines)

    # Insider detail
    insider_lines = []
    for name in (cf.get("insider_buyers") or [])[:5]:
        insider_lines.append(f"  • {name}: open-market buy")
    insider_detail = "\n".join(insider_lines)

    # Activist detail (full 13D event text if we have it)
    e13d = sb.table("events_13d").select("filing_id,form_subtype,percent_owned,event_date").eq("ticker", ticker).order("event_date", desc=True).limit(3).execute()
    activist_lines = []
    for e in (e13d.data or []):
        activist_lines.append(f"  • {e['form_subtype']} on {e['event_date']}: {e.get('percent_owned') or '?'}% stake")
    activist_detail = "\n".join(activist_lines)

    # 8-K detail — recent summaries from filings_raw where summary exists
    eight_k = sb.table("filings_raw").select("filed_at,summary").eq("form_type", "8-K").not_.is_("summary", "null").order("filed_at", desc=True).limit(10).execute()
    # filter to this ticker's CIK if we can resolve it
    # Actually filings_raw is per-filer not per-issuer for 8-Ks — corporate strategics file 8-Ks.
    # Skip for now unless we can match.
    eight_k_detail = ""

    # Price stance
    r6 = sig.get("return_6m")
    if r6 is not None:
        if r6 > 30:
            price_stance = f"stock has run hard (+{r6}% over 6M)"
        elif r6 < -10:
            price_stance = f"stock has lagged ({r6}% over 6M)"
        else:
            price_stance = f"stock has chopped (≈{r6}% over 6M)"
    else:
        price_stance = "no recent price context"

    return {
        "ticker": ticker,
        "company_name": company_name,
        "market_cap": market_cap,
        "score": sig["score"],
        "num_sources": sig["num_sources"],
        "multi_source": (components.get("multi_source_bonus") or {}).get("applied", False),
        "breakdown_str": breakdown_str,
        "filer_detail": filer_detail,
        "insider_detail": insider_detail,
        "activist_detail": activist_detail,
        "eight_k_detail": eight_k_detail,
        "ret_1m": f"{sig.get('return_1m'):+.1f}%" if sig.get("return_1m") is not None else "—",
        "ret_6m": f"{sig.get('return_6m'):+.1f}%" if sig.get("return_6m") is not None else "—",
        "ret_ytd": f"{sig.get('return_ytd'):+.1f}%" if sig.get("return_ytd") is not None else "—",
        "price_stance": price_stance,
    }


_last_groq = 0.0
def call_groq(system: str, user: str) -> tuple[str, dict[str, Any]] | None:
    global _last_groq
    delta = time.monotonic() - _last_groq
    if delta < GROQ_MIN_INTERVAL_S:
        time.sleep(GROQ_MIN_INTERVAL_S - delta)
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.4,
        "max_tokens": 3000,
    }
    r = requests.post(GROQ_URL, headers=headers, json=payload, timeout=120)
    _last_groq = time.monotonic()
    if not r.ok:
        print(f"  Groq error {r.status_code}: {r.text[:200]}", flush=True)
        return None
    d = r.json()
    content = d["choices"][0]["message"]["content"]
    usage = d.get("usage", {})
    return content, usage


def analyze(sb: Client, ticker: str, skip_recent_hours: int = 0) -> bool:
    if skip_recent_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=skip_recent_hours)).isoformat()
        existing = sb.table("signal_analyses").select("analyzed_at").eq("ticker", ticker).gte("analyzed_at", cutoff).limit(1).execute()
        if existing.data:
            print(f"  {ticker}: skipped (analyzed within last {skip_recent_hours}h)", flush=True)
            return True

    ctx = gather_context(sb, ticker)
    if not ctx:
        print(f"  {ticker}: no signal data — skipping", flush=True)
        return False

    user_prompt = build_user_prompt(ctx)
    print(f"  {ticker}: calling Groq…", flush=True)
    result = call_groq(SYSTEM_PROMPT, user_prompt)
    if not result:
        return False
    content, usage = result
    sb.table("signal_analyses").insert({
        "ticker": ticker,
        "analysis_md": content,
        "input_context": ctx,
        "model": GROQ_MODEL,
        "tokens_in": usage.get("prompt_tokens"),
        "tokens_out": usage.get("completion_tokens"),
    }).execute()
    print(f"  {ticker}: ✓ {usage.get('completion_tokens', '?')} tokens out", flush=True)
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ticker", type=str, help="Analyze a single ticker")
    p.add_argument("--watchlist", action="store_true", help="Analyze all watchlist tickers")
    p.add_argument("--skip-recent", type=int, default=0, help="Skip if analyzed in last N hours")
    args = p.parse_args()

    sb = _supabase()
    if args.ticker:
        analyze(sb, args.ticker, args.skip_recent)
    elif args.watchlist:
        wl = sb.table("watchlist").select("ticker").execute()
        tickers = [r["ticker"] for r in (wl.data or [])]
        print(f"Watchlist: {len(tickers)} tickers", flush=True)
        for t in tickers:
            analyze(sb, t, args.skip_recent)
    else:
        p.error("specify --ticker or --watchlist")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
