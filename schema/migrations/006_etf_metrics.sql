-- Migration 006: etf_metrics table — one row per ticker with multi-timeframe
-- price returns + flow % values. Refreshed daily by ingest/etf_metrics.py.
--
-- Distinct from etf_flows (which is per-snapshot historical data). This table
-- is the precomputed dashboard read model.

create table if not exists etf_metrics (
    ticker          text primary key,
    aum_usd         numeric,
    -- price returns (from yfinance daily close history)
    price_return_1m numeric,
    price_return_3m numeric,
    price_return_6m numeric,
    price_return_1y numeric,
    -- flow % of latest AUM, summed over the trailing window from N-PORT data
    flow_pct_3m     numeric,
    flow_pct_6m     numeric,
    flow_pct_1y     numeric,
    -- raw dollar flow over windows (context only)
    flow_usd_3m     numeric,
    flow_usd_6m     numeric,
    flow_usd_1y     numeric,
    last_updated    timestamptz not null default now()
);

alter table etf_metrics enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_etf_metrics') then
    create policy auth_read_etf_metrics
      on etf_metrics for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
