-- holdings_recent(): returns only the latest N periods per filer, pre-joined
-- to filings_raw for filer_name + filed_at.
--
-- WHY: the /holdings page previously paginated the ENTIRE holdings_13f table
-- (147K+ rows) into a Next.js server component on every request, then filtered
-- in JS to the latest 2 periods per filer. That exceeded Vercel's function
-- timeout (page returned 0 bytes; users saw stale browser cache). Pushing the
-- ranking into Postgres returns ~12K rows instead of 147K — fast + correct.
--
-- dense_rank by period (not row) so all amendment filings for the same period
-- come through together (rank ties); the page dedupes amendments by filed_at.

create or replace function holdings_recent(max_periods int default 2)
returns table (
  cik               text,
  period_of_report  date,
  cusip             text,
  ticker            text,
  issuer_name       text,
  shares            bigint,
  value_usd         numeric,
  put_call          text,
  filer_name        text,
  filed_at          timestamptz
)
language sql
stable
as $$
  with ranked as (
    select
      h.cik, h.period_of_report, h.cusip, h.ticker, h.issuer_name,
      h.shares, h.value_usd, h.put_call, h.filing_id,
      dense_rank() over (partition by h.cik order by h.period_of_report desc) as rnk
    from holdings_13f h
  )
  select
    r.cik, r.period_of_report, r.cusip, r.ticker, r.issuer_name,
    r.shares, r.value_usd, r.put_call,
    f.filer_name, f.filed_at
  from ranked r
  join filings_raw f on f.id = r.filing_id
  where r.rnk <= max_periods;
$$;

-- Allow the authenticated + service roles to call it.
grant execute on function holdings_recent(int) to authenticated, service_role, anon;
