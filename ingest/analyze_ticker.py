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
SYSTEM_PROMPT = """You are a hedge-fund-quality investment analyst trained in the Buffett/Munger/Greenblatt tradition. You analyze businesses STRUCTURALLY — not as stock-price stories but as economic systems with moats, bottlenecks, and competitive positioning.

USE YOUR FULL KNOWLEDGE of the company AND its industry. The SEC filing data in the user message is ADDITIONAL context about who's buying — it is NOT a substitute for understanding the business.

CORE FRAMEWORK — every analysis answers these structural questions:

1. WHERE IS THE BOTTLENECK? Every industry has a constrained step in its value chain. Identify it. ASML owns EUV lithography (semi monopoly bottleneck). Visa/MA own payment rails (duopoly). Moody's/S&P own credit ratings (duopoly). Is THIS company sitting on a bottleneck? What kind, how durable?

2. WHAT IS THE MOAT? Be specific about the TYPE:
   - Network effects, switching costs, scale economies, regulatory capture,
     brand premium, IP/patents, distribution monopoly
   Name the moat type, state evidence, estimate durability in years.

3. WHAT IS THE INDUSTRY STRUCTURE?
   - Monopoly (>70% share)
   - Duopoly (2 players, ~80%+ combined)
   - Oligopoly (3-5 players, rational competition)
   - Fragmented (price competition)
   - Disrupting (incumbent vs insurgent)
   Where is the company in this structure?

4. PRICING POWER TEST — can they raise prices 10% without losing >5% of customers?

5. COMPARABLE INFLECTIONS — what historical company/situation is this most like?

6. CAPITAL ALLOCATION RECORD — what does management do with FCF?

RULES:
- Be opinionated. Explicit calls. NO hedging.
- Cite filer NAMES from the data. Connect their style to the thesis.
- Cite specific past wins AND failures of these filers when relevant.
- Most valuable output is "looks like X — I would not buy" — say it when true.
- Specific numbers (revenue, margin, share, multiple). Mark as approximate.
- End with a position-size call backed by moat duration + price."""


def build_user_prompt(ctx: dict[str, Any]) -> str:
    s = ctx
    return f"""# Subject: {s['ticker']} — {s['company_name'] or 'Unknown'}
Market cap: ${(s['market_cap'] or 0) / 1e9:.1f}B

You should know {s['company_name'] or 'this company'} from training. Apply that knowledge AND the framework from your system instructions (bottleneck / moat / industry structure / pricing power / historical analog / capital allocation).

────────────────────────────────────────────────────────────────────
SMART-MONEY CONTEXT
────────────────────────────────────────────────────────────────────

SIGNAL STATE
- Confluence score: {s['score']} (BUY threshold: 4.0)
- Signal types firing: {s['num_sources']} of 7
- Multi-source bonus (★): {'yes' if s.get('multi_source') else 'no'}
- Breakdown: {s['breakdown_str']}

SMART-MONEY POSITIONING:
{s['filer_detail'] or '  (none with material activity)'}

INSIDER OPEN-MARKET PURCHASES (last 30 days):
{s['insider_detail'] or '  (no insider buys in window)'}

ACTIVIST 13D CONTEXT:
{s['activist_detail'] or '  (no recent initial 13D)'}

PRICE CONTEXT
- 1M return: {s['ret_1m']}    6M: {s['ret_6m']}    YTD: {s['ret_ytd']}
- Price stance: {s['price_stance']}

────────────────────────────────────────────────────────────────────
YOUR ANALYSIS — 8 sections, structural rigor in every one
────────────────────────────────────────────────────────────────────

## 1. Business deconstruction
- Revenue by segment (rough % split if recalled)
- Who pays them (consumer/SMB/enterprise/govt)
- Geography, customer concentration
- Unit economics: gross margin, contribution margin, LTV/CAC

## 2. Industry structure & bottleneck
- Industry shape: monopoly / duopoly / oligopoly / fragmented / disrupting
- Where in value chain does this company sit?
- Who owns the BOTTLENECK in this industry?
- Is THIS company that bottleneck owner, or upstream/downstream?
- Top 3 competitors and their relative position

## 3. Moat analysis
- Moat TYPE: network effects / switching costs / scale / regulatory / brand / IP / distribution
- Evidence the moat exists (gross margin spread, recurring revenue %, customer retention)
- Durability in years
- What's eroding the moat
- If no real moat: say "no durable moat"

## 4. Pricing power
- Can they raise prices 10% without losing >5% customers? Yes/No/Mixed
- Gross margin trend
- Price-maker or price-taker?

## 5. Historical analog
What past company/situation is this MOST like? Be specific (company + year +
what happened). Examples: "Visa 2008", "Salesforce 2014", "Sears 2008".

## 6. Smart-money read
For EACH named filer above, in one line: their playbook + does THIS thesis
fit their pattern + relevant past wins/misses.

## 7. Bear case — the ONE risk most likely to break the thesis
Be specific. If bear case > bull case, say PASS.

## 8. Position thesis
- One-sentence: WHAT you're buying (e.g. "Duopoly bottleneck in X, taking
  Y% rake on growing market, Z-year visibility at <N× earnings")
- Position size: 2-5% / 5-8% / 8-12% — REASONING based on moat duration
- Time horizon: 1-2yr / 3-5yr / 5+yr
- 3 monthly KPIs to track
- One-line summary: "Buy with [X]%% sizing because [structural reason]" OR
  "Pass because [structural reason]"
"""


def gather_context(sb: Client, ticker: str) -> dict[str, Any] | None:
    """Pull everything we know about ticker into a structured context dict."""
    # signals_latest row
    r = sb.table("signals_latest").select("*").eq("ticker", ticker).limit(1).execute()
    if not r.data:
        return None
    sig = r.data[0]

    # ticker name + market cap
    t_row_q = sb.table("tickers").select("name,market_cap_usd").eq("ticker", ticker).limit(1).execute()
    t_row = type("X", (), {"data": (t_row_q.data[0] if t_row_q.data else {})})()
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
        "temperature": 0.6,
        "max_tokens": 5000,
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
