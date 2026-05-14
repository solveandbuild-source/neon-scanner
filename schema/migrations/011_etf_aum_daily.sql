-- Migration 011: etf_aum_daily — universal daily AUM/NAV capture for all 34 ETFs.
--
-- Source: Yahoo Finance's `info["netAssets"]` + daily Close from history().
-- Captured nightly via ingest/etf_aum_yahoo.py.
--
-- Why this exists: SPDR, Invesco, VanEck, Global X, KraneShares (24 of our
-- 34 tickers) don't expose a free historical daily shares-outstanding feed.
-- Yahoo aggregates current netAssets daily for all of them. By capturing
-- forward from today and combining with our existing N-PORT historical, we
-- get full-universe freshness without paying for an API.
--
-- Flow calculation (done at read-time in etf_metrics.py):
--   flow_t = aum_t − aum_{t-1} × (close_t / close_{t-1})
-- Auto-handles dividends because close drops on ex-date and aum drops by the
-- same proportional amount; the ratio isolates shares activity.

create table if not exists etf_aum_daily (
    ticker     text,
    as_of_date date,
    net_assets numeric,
    close      numeric,
    source     text,         -- 'yahoo' for now
    captured_at timestamptz not null default now(),
    primary key (ticker, as_of_date)
);

create index if not exists idx_etf_aum_daily_ticker_date
    on etf_aum_daily (ticker, as_of_date desc);

alter table etf_aum_daily enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_etf_aum_daily') then
    create policy auth_read_etf_aum_daily
      on etf_aum_daily for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
