-- filer_position_cost: estimated cost basis per (filer, ticker) using
-- the per-quarter VWAP proxy described in CLAUDE.md §6.1.
--
-- 13F data only reports quarter-end shares and FAIR VALUE (not entry price).
-- The proxy here:
--   For each quarter where a filer ADDED shares to a position, multiply
--   Δshares × that quarter's VWAP (volume-weighted avg price from yfinance
--   daily data). Sum across all accumulation quarters → total cost invested.
--   Divide by total shares accumulated → weighted-average cost per share.
--   Trims/exits assumed to use average-cost lot accounting (most filers do).
--
-- Accuracy is typically ±15-25% off true cost basis (which is never
-- disclosed publicly per 13F design). Useful for orientation — "is the
-- filer up or down on this name" — not for precise P&L.

create table if not exists filer_position_cost (
  cik                   text not null,
  ticker                text not null,
  as_of_period          date not null,        -- latest 13F period this estimate covers
  current_shares        bigint not null,
  current_value_usd     numeric,              -- quarter-end fair value from 13F
  estimated_cost_basis  numeric not null,     -- weighted-avg $/share across accumulation quarters
  total_cost_invested   numeric not null,     -- Σ(Δshares × quarter_vwap)
  total_shares_bought   bigint not null,      -- sum of all positive Δshares events
  accumulation_quarters jsonb not null,       -- [{period, delta_shares, quarter_vwap, contribution_usd}, ...]
  first_seen_period     date not null,        -- when did this position first appear in 13F
  computed_at           timestamptz not null default now(),
  primary key (cik, ticker, as_of_period)
);

create index if not exists idx_filer_position_cost_ticker
  on filer_position_cost (ticker);

create index if not exists idx_filer_position_cost_cik_asof
  on filer_position_cost (cik, as_of_period desc);

-- Sibling cache: per-(ticker, quarter) VWAPs. Idempotent + reused across
-- filers (any ticker held by 12 funds in the same quarter only needs ONE
-- yfinance fetch). Past quarters never change → permanent cache.
create table if not exists ticker_quarter_vwap (
  ticker            text not null,
  period_of_report  date not null,            -- quarter end
  vwap              numeric not null,
  bars_used         int not null,             -- daily bars used in the avg (0..~63)
  computed_at       timestamptz not null default now(),
  primary key (ticker, period_of_report)
);

alter table filer_position_cost enable row level security;
alter table ticker_quarter_vwap  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_filer_position_cost') then
    create policy auth_read_filer_position_cost
      on filer_position_cost for select
      using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'auth_read_ticker_quarter_vwap') then
    create policy auth_read_ticker_quarter_vwap
      on ticker_quarter_vwap for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
