-- Migration 013: watchlist + signal_analyses
--
-- watchlist: tickers the user has explicitly tagged for deep analysis.
-- Single-user system so no user_id column (would add if multi-user).
--
-- signal_analyses: cached LLM analysis output per ticker. Re-runnable
-- per-ticker — keeps history so we can see how the thesis evolved.

create table if not exists watchlist (
    ticker     text primary key,
    added_at   timestamptz not null default now(),
    note       text                                       -- optional user note
);

alter table watchlist enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_all_watchlist') then
    create policy auth_all_watchlist
      on watchlist for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end$$;


create table if not exists signal_analyses (
    id            uuid primary key default gen_random_uuid(),
    ticker        text not null,
    analyzed_at   timestamptz not null default now(),
    analysis_md   text not null,                          -- LLM output, markdown
    input_context jsonb not null,                         -- what data we fed (for audit)
    model         text not null,                          -- e.g. llama-3.3-70b-versatile
    tokens_in     int,
    tokens_out    int
);

create index if not exists idx_signal_analyses_ticker_time
  on signal_analyses (ticker, analyzed_at desc);

alter table signal_analyses enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_signal_analyses') then
    create policy auth_read_signal_analyses
      on signal_analyses for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
