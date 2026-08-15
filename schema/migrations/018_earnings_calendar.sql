-- earnings_calendar: next scheduled earnings date + short-horizon returns per
-- stock, powering the /earnings tab.
--
-- Universe = large-caps (market_cap >= $10B in `tickers`) UNION every ticker
-- our tracked filers hold (resolved via cusip_ticker_map). Populated by
-- ingest/earnings_calendar.py from Yahoo (same source as prices).
--
-- Observable schedule data only. The page sorts by DATE, not return — the two
-- return columns are trailing context, not a momentum ranking (CLAUDE.md §2.2).

create table if not exists earnings_calendar (
  ticker           text primary key,
  name             text,
  next_earnings    date,          -- next scheduled earnings date; null if Yahoo has none
  return_1w        numeric,       -- trailing 1-week price return (fraction; 0.03 = +3%)
  return_1m        numeric,       -- trailing 1-month price return
  price            numeric,
  market_cap_usd   numeric,
  in_smart_money   boolean not null default false,  -- held by >= 1 tracked filer
  updated_at       timestamptz not null default now()
);

create index if not exists earnings_calendar_next_idx on earnings_calendar (next_earnings);

alter table earnings_calendar enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_earnings_calendar') then
    create policy auth_read_earnings_calendar
      on earnings_calendar for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
