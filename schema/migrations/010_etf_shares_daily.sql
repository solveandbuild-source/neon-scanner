-- Migration 010: etf_shares_daily — daily NAV + shares outstanding + computed
-- daily flow, scraped directly from issuer fund-stats files.
--
-- Why this exists: SEC N-PORT is fundamentally 2-5 months stale. For ETFs whose
-- issuer publishes a daily NAV+shares-outstanding file, we can compute the
-- "real" daily flow (creation/redemption activity) as Δshares × NAV. Fresh to
-- yesterday. This is the same calculation etf.com / Bloomberg use.
--
-- Coverage source: per-issuer scrapers (ingest/etf_shares_*.py).
-- Phase 1: iShares (10 tickers — TLT, IEF, EEM, EFA, IBB, IGV, ITA, SOXX,
--          ICLN, IBIT). Future phases: SPDR, Invesco, VanEck, etc.
--
-- daily_flow_usd convention: positive = creation (money in), negative =
-- redemption (money out). Formula: (shares[t] − shares[t-1]) × nav[t].

create table if not exists etf_shares_daily (
    ticker             text,
    as_of_date         date,
    shares_outstanding numeric,
    nav_per_share      numeric,
    daily_flow_usd     numeric,
    source             text,         -- 'ishares' for now; extend per issuer
    primary key (ticker, as_of_date)
);

create index if not exists idx_etf_shares_daily_ticker_date
    on etf_shares_daily (ticker, as_of_date desc);

alter table etf_shares_daily enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_etf_shares_daily') then
    create policy auth_read_etf_shares_daily
      on etf_shares_daily for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
