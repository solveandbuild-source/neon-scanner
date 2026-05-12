# CLAUDE.md — portfolio-scanner

> Read this in full before writing any code. The philosophy here is load-bearing. The wrong instinct (build-more, add-LLM-layer, surface-trending-tickers) will silently corrupt the system. When in doubt, do less.

---

## 1. Who is the user

- Solo operator building this for personal use.
- Investor-operator: makes capital allocation decisions from the output of this system.
- Direct communicator. Pushback is welcomed. Do not soften disagreement with hedges. If a request conflicts with the philosophy in §2, say so before implementing.
- Has explicitly rejected: narrative-driven UI, "trending" feeds, fabricated composite metrics, anything that imports FOMO into the decision loop.

---

## 2. Design philosophy (non-negotiable)

These are not preferences. They are the reason the system exists. Every feature must pass these tests.

### 2.1 Signal-driven, not narrative-driven
The system surfaces **observable filings and price-action signals** from a fixed universe of tracked filers and a filtered ticker universe. It does **not** generate stories, themes, sector calls, or "why this matters" commentary. If a signal fires, the user reads the underlying filing themselves and decides.

> User's stance (quoted): the job of the tool is to tell me what *happened*, not what it *means*. Meaning is my job.

### 2.2 FOMO-resistant by construction
This is the most important property. The system actively suppresses late-stage entry:
- Tickers whose trailing 6-month return exceeds `+60%` are **filtered out of the universe** (configurable; see `config/signal_weights.yml`). They are classified `late_stage` and excluded from new-position signals.
- No "trending", "momentum leaders", "what's hot" surface anywhere. Ever.
- Existing positions get exit-rule monitoring; that is the only place rising prices generate signals, and the signal is *evaluate exit*, not *add*.

### 2.3 Exit rules are non-negotiable
When an exit rule fires, the UI must surface it with equal or greater prominence than any entry signal. Exit rules cannot be snoozed in code, only acknowledged. The system is more useful at preventing losses than finding winners; treat that asymmetry as a design constraint.

### 2.4 No fabricated metrics
Do not invent composite scores that aren't grounded in observable inputs. Specifically:
- ❌ No "Neutrality Index", "Conviction Score", "Sentiment Health", or similar synthetic gauges that average unrelated signals into a single number that looks authoritative.
- ✅ Confluence Score is allowed because it is a transparent weighted sum of named filings within a defined window. Its components must always be visible alongside it.

If you find yourself reaching for a metric to make a UI element "feel" more decisive, stop. Show the raw signals.

### 2.5 The system not firing is the system working
There will be weeks where nothing surfaces. That is correct behavior. Do not add filler ("watchlist of the week", "interesting filings even though they didn't meet the threshold"). Empty state is honest.

### 2.6 Honest caveats
- 13F filings are 45 days delayed. Surface this everywhere a 13F-derived signal appears.
- Filer intent is not always inferable from a filing. Don't claim it is.
- Past activist outcomes do not predict future ones. The score is a heuristic, not a forecast.

---

## 3. Communication tone with this user

- Direct. No hedging filler. No "great question". No closing summary paragraphs that restate what just happened.
- Push back when you disagree. The user explicitly asks for this.
- When proposing UI or data choices that touch §2, name the principle being applied so drift is visible.
- Don't ask for permission on technical details that are downstream of decisions already in this doc. Do ask on decisions that change the philosophy.

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  SEC EDGAR (public)        Price data (TBD: yfinance / polygon)│
└──────────────┬──────────────────────────┬──────────────────────┘
               │                          │
        ┌──────▼──────┐            ┌──────▼──────┐
        │  Ingestion  │            │   Quotes    │
        │  (Python)   │            │  (Python)   │
        └──────┬──────┘            └──────┬──────┘
               │                          │
               └──────────┬───────────────┘
                          │
                  ┌───────▼────────┐
                  │   Supabase     │
                  │  (Postgres+RLS)│
                  └───────┬────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼─────┐ ┌──▼─────┐ ┌──▼──────────┐
       │ Confluence │ │Universe│ │  Exit Rule   │
       │   Scorer   │ │ Filter │ │   Engine     │
       └──────┬─────┘ └──┬─────┘ └──┬──────────┘
              │          │          │
              └──────────┼──────────┘
                         │
                  ┌──────▼──────┐
                  │   Next.js   │
                  │  (Vercel)   │
                  └─────────────┘
```

### Stack
- **Ingestion**: Python 3.11+, `requests`, `sec-edgar-downloader` or direct EDGAR API, `supabase-py`.
- **Database**: Supabase Postgres. Row-level security on. Schema in [schema/supabase.sql](schema/supabase.sql).
- **Scheduler**: GitHub Actions cron for polling (cadence in `config/signal_weights.yml`). Avoid long-running workers for v1.
- **Frontend**: Next.js (App Router) on Vercel. Server components read from Supabase via service role; no client-side DB access.
- **Auth**: Single-user. Supabase magic-link, RLS scoped to one `user_id`.

---

## 5. Data model (see schema/supabase.sql for SQL)

- `tracked_filers` — the universe of 13F/13D filers we watch (CIK, name, category, multiplier).
- `filings_raw` — every fetched filing, deduped by accession number. Source of truth.
- `holdings_13f` — flattened per-position rows from 13F-HR filings.
- `events_13d` — 13D/G filings parsed for activist stake disclosures.
- `events_form4` — insider transactions.
- `tickers` — the investable universe with the latest snapshot of price + return windows.
- `signals` — emitted entry signals with score breakdown stored as JSONB.
- `exit_signals` — emitted exit signals against user positions.
- `user_positions` — what the user currently holds. Drives exit-rule monitoring.
- `signal_acknowledgements` — append-only log of user actions on signals (acknowledged / dismissed / acted-on). Never delete signals; always log the decision.

---

## 6. Signal extraction

### 6.0 Filer curation logic (read before "completing" the list)
The 30 filers in `config/tracked_filers.yml` are curated, not exhaustive. A filer is included only if their **13F is a representative window into their actual exposure**. Filers were deliberately excluded when this is not the case:

- **Bridgewater (Dalio)** — book is too diversified; 13F-equity signal is poor.
- **Renaissance Technologies** — mostly stat-arb; positions are noise, not theses.
- **Soros Fund Management** — mostly bonds and macro; 13F is unrepresentative.

If a future maintainer suggests adding a famous name, apply the same test before saying yes: *does their 13F-equity book reflect their thinking?* If no, exclude regardless of brand recognition.

**ARK / Cathie Wood** is the inverse case: included specifically because she discloses ETF trades **daily**, not quarterly. The ingest module must treat ARK as a special case — pull daily trade CSVs from ark-funds.com in addition to (not instead of) the quarterly 13F. Do not collapse ARK back to 13F-only "to keep the pipeline uniform."

### 6.1 13F-HR (45-day delay; surface this caveat in UI)
- Diff each filer's current 13F vs prior. Emit `new_position`, `add`, `trim`, `exit`.
- A position is "new" if the ticker wasn't in the prior 13F. Adds/trims are ≥10% share-count change.

### 6.2 13D / 13G
- New 13D from a filer in the `activist` category → highest-weight signal in the system.
- 13G → lower weight; passive stake.
- Amendments (13D/A) parsed but weighted lower than initial.

### 6.3 Form 4 (insider transactions)
- Open-market buys by officers/directors. Sales mostly ignored (planned 10b5-1s are noisy).
- Cluster bonus: ≥3 insiders buying in 30-day window.

### 6.4 Confluence scoring
For each ticker on each day, sum the weighted signals from the last `window_days` (see `config/signal_weights.yml`). Apply per-filer `multiplier`. Output:
```json
{
  "ticker": "XYZ",
  "score": 7.2,
  "components": [
    {"type": "13d_new", "filer": "Filer A", "weight": 3.0, "multiplier": 2.0},
    {"type": "form4_cluster", "count": 4, "weight": 1.2}
  ],
  "window_days": 30
}
```
Components must be persisted with the score. Never just store the score.

### 6.5 Universe filter (applied AFTER scoring, BEFORE surfacing as signal)
- Drop tickers with trailing 6-month return > `late_stage_threshold` (default `0.60`).
- Drop tickers below `min_market_cap` (default `$300M`) and below `min_avg_volume`.
- Surviving tickers with `score >= signal_threshold` become entry signals.

### 6.6 Exit rules (run daily against `user_positions`)
- Trailing stop hit (config'd per-position or default).
- Tracked filer fully exits the ticker.
- Score-based: confluence score for the ticker has fully decayed AND price is below entry.

Exit signals always surface. Always.

---

## 7. Build sequence

Tasks listed below in order. Each is a coherent unit of work. Mark in the repo's `PROGRESS.md` as you go.

1. **Cloud setup** (user-gated; needs credentials)
   - Create GitHub repo. User to run `gh repo create` or do it via web.
   - Create Supabase project. User logs in, creates project, supplies anon + service keys to `.env`.
   - Run `schema/supabase.sql` against the new Supabase project.
   - Create Vercel project linked to the GitHub repo.
   - Do NOT attempt to do any of this from a non-interactive session. Walk the user through.

2. **EDGAR ingestion module** (`ingest/edgar.py`)
   - Reads `config/tracked_filers.yml`.
   - For each filer with a CIK, fetches recent filings via EDGAR's filing index.
   - Idempotent: dedupes by `accession_number`. Writes raw filings to `filings_raw`.
   - Polite: 10 req/sec max (EDGAR rate limit), `User-Agent` header includes contact email.
   - Filers without a CIK: log a TODO; do not crash.

3. **Filing parsers** (`ingest/parsers/`)
   - `parse_13f.py` → `holdings_13f` rows.
   - `parse_13d.py` → `events_13d` rows.
   - `parse_form4.py` → `events_form4` rows.
   - Each parser is pure: input filing text, output rows. Tested with fixtures checked into `tests/fixtures/`.

4. **Confluence scorer** (`scoring/confluence.py`)
   - Pure function: `(ticker, asof_date, events, weights) -> ScoreResult`.
   - Persists into `signals` with components JSONB.

5. **Universe filter** (`scoring/universe.py`)
   - Daily price snapshot job populates `tickers`.
   - Filter pass tags rows as `tradeable | late_stage | too_illiquid`.
   - Only `tradeable` tickers can become entry signals.

6. **Exit rule engine** (`scoring/exit_rules.py`)
   - Runs daily. Reads `user_positions`. Emits to `exit_signals`.

7. **Frontend** (Next.js)
   - Three views only: **Signals**, **Positions/Exits**, **Filings log**.
   - No dashboards. No charts of your own portfolio's performance. No "trending".
   - Each signal row links to the underlying filing(s) on sec.gov.
   - Empty state explicitly says "no signals — this is normal" (see §2.5).

8. **GitHub Actions schedules**
   - Hourly: EDGAR poll (filings are infrequent; this is generous).
   - Daily 18:00 ET: price snapshot + universe filter + exit-rule run + signal emission.

---

## 8. Future layers — DO NOT BUILD NOW

The following are explicitly out of scope until v1 has been running for at least one full quarter. Do not pre-scaffold, pre-design, or "leave hooks for" these. YAGNI.

- Alt-data integrations (credit card panels, satellite, web scraping).
- LLM summaries of filings.
- LLM-generated rationale on signals.
- Multi-user / shared-watchlist features.
- Mobile app.
- Backtesting framework.
- Sector or thematic aggregation views.

If the user asks for one of these, push back: "v1 isn't a quarter old yet; we don't know what's actually missing." Then build it only if they confirm.

---

## 9. Honest caveats to surface in product

- "13F data is 45 days delayed by law."
- "Filer intent is inferred, not stated. Read the filing."
- "Past activist returns do not predict future ones."
- "No signals this week is the expected state most weeks."

These strings live in the UI, not just this doc.

---

## 10. Working agreements for Claude Code

- Read this file at the start of every session.
- Before writing code that touches signal generation, scoring, or UI surfacing, restate which principle in §2 applies. One sentence.
- Never add a new composite metric without flagging §2.4.
- Never add a "discovery" or "trending" surface without flagging §2.2.
- If the user asks for a feature in §8, push back before implementing.
- Tests: parsers must have fixture-based tests. Scorers must have unit tests. UI does not need tests for v1.
- Commits: small, focused, conventional-commits style. One logical change per commit.
