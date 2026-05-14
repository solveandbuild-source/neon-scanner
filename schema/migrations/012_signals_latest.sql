-- Migration 012: signals_latest — dashboard read model for current BUY signals.
--
-- One row per current BUY signal (score ≥ 4.0), refreshed each ingest run.
-- This is the read source for the /signals page. Separate from signals table
-- (which is the append-only history) because the dashboard needs the LATEST
-- state per ticker, fast.

create table if not exists signals_latest (
    ticker             text primary key,
    score              numeric not null,
    num_sources        int not null,             -- distinct signal types firing
    components         jsonb not null,           -- {ins, new, add, 13d, vel, xq, pat}
    contributing_filers jsonb,                   -- which tracked filers/insiders fired
    first_detected_at  date,                     -- earliest filed_at of contributing filings
    latest_signal_at   date,                     -- max filed_at of contributing filings
    aum_usd            numeric,
    price             numeric,
    return_1m         numeric,
    return_6m         numeric,
    return_ytd        numeric,
    computed_at       timestamptz not null default now()
);

create index if not exists idx_signals_latest_score on signals_latest (score desc);

alter table signals_latest enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_signals_latest') then
    create policy auth_read_signals_latest
      on signals_latest for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
