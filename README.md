# portfolio-scanner

Personal signal-extraction system that watches a curated universe of SEC filers (activists, value managers, notable insiders) and surfaces entry signals when filings cluster on a ticker — while filtering out anything that has already run too far to enter without FOMO.

## What it does

- Polls SEC EDGAR for filings from a tracked filer list (13F-HR, 13D/G, Form 4).
- Scores ticker-level confluence across filers within a rolling window.
- Filters the investable universe to exclude late-stage runners (trailing 6mo > 60% by default).
- Monitors held positions against non-negotiable exit rules.
- Surfaces signals in a minimal Next.js UI. No "trending", no narrative, no fabricated metrics.

## What it deliberately does NOT do

See [CLAUDE.md §2 and §8](CLAUDE.md). Short version: no FOMO surfaces, no LLM rationale, no alt-data, no synthetic conviction scores.

## Stack

- Ingestion: Python 3.11+
- Database: Supabase (Postgres + RLS)
- Frontend: Next.js on Vercel
- Scheduling: GitHub Actions cron

## Status

v0 — scaffolding only. See `CLAUDE.md` §7 for the build sequence.

## Setup

Setup requires user-supplied credentials and is documented in `CLAUDE.md` §7 task 1. Do not attempt to run before completing that step.
