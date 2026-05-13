-- Migration 005: ETF flows table for the top-down money-flow view.
--
-- One row per (ticker, snapshot_date). Stores daily AUM (price × shares
-- outstanding) and the day's net flow (Δshares × price), both derived from
-- yfinance data. Used by /flows page for the cross-asset / sector / theme
-- rotation view.

create table if not exists etf_flows (
    id              uuid primary key default gen_random_uuid(),
    ticker          text not null,
    snapshot_date   date not null,
    price           numeric,
    shares_out      numeric,
    aum_usd         numeric,
    daily_flow_usd  numeric,   -- (shares[t] - shares[t-1]) × price[t]
    fetched_at      timestamptz not null default now(),
    unique (ticker, snapshot_date)
);

create index if not exists etf_flows_ticker_date_idx
    on etf_flows(ticker, snapshot_date desc);

alter table etf_flows enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_etf_flows') then
    create policy auth_read_etf_flows
      on etf_flows for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
