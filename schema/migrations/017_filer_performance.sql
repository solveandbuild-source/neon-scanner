-- filer_performance: trailing "13F-clone" returns per filer.
--
-- Definition: if you had mirrored this filer's disclosed 13F long book as of
-- ~N years ago (at that quarter's end-of-period prices) and held every position
-- to today's close, what return would you have earned? Value-weighted.
--
-- This is NOT the filer's actual fund return (those are private + include
-- shorts, cash, options, international — none of which 13F captures). For
-- high-coverage long-only filers (Buffett ~95%) it's close; for low-coverage
-- macro/credit filers (Druckenmiller ~30%, Bass ~10%) it reflects only the
-- visible US-equity slice. Methodology + caveat surfaced in the UI tooltip.
--
-- priced_coverage = fraction of the historical book's VALUE we could price
-- (a reliability indicator — low = don't trust the number). Distinct from
-- the AUM coverage_pct in web/lib/filers.ts.

create table if not exists filer_performance (
  cik              text not null,
  horizon          text not null,        -- '1Y' | '3Y'
  from_period      date not null,        -- the 13F period used as the clone entry
  return_pct       numeric not null,     -- value-weighted clone-and-hold return
  priced_coverage  numeric not null,     -- 0..1 share of book value that was priceable
  positions        int not null,
  computed_at      timestamptz not null default now(),
  primary key (cik, horizon)
);

alter table filer_performance enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_filer_performance') then
    create policy auth_read_filer_performance
      on filer_performance for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
