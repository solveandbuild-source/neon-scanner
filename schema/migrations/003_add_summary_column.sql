-- Migration 003: add a `summary` column to filings_raw.
--
-- Stores an LLM-generated one-sentence headline for each filing
-- (initially: 8-Ks via ingest/summarize_8k.py; 13Ds later).
-- Nullable — populated incrementally as the summarizer runs.
--
-- Safe to re-run.

alter table filings_raw
  add column if not exists summary text;

-- Helpful for finding filings that still need summarization.
create index if not exists filings_raw_unsummarized_idx
  on filings_raw(form_type)
  where summary is null;
