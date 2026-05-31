-- cusip_ticker_map: persistent CUSIP→ticker resolver populated by OpenFIGI.
--
-- WHY: SEC 13F XML stores issuer names heavily-truncated (e.g. "ACACIA RESH
-- CORP" for Acacia Research) and ETF names ambiguously ("ISHARES TR" matches
-- dozens of iShares funds). Name normalization alone can't disambiguate
-- these. CUSIP is unique per security globally — the right resolver key.
--
-- Source: api.openfigi.com (free, 25 req/min, no key). Idempotent — script
-- only POSTs unknown CUSIPs each run. Past CUSIPs never change.
--
-- last_seen_in_holdings tracks the most recent date this CUSIP appeared in
-- holdings_13f; lets us garbage-collect CUSIPs no filer touches anymore.

create table if not exists cusip_ticker_map (
  cusip                   text primary key,
  ticker                  text,          -- null if OpenFIGI returns no equity-class match (rare)
  name                    text,
  exchange                text,
  security_type           text,          -- e.g. "Common Stock", "ETP", "ADR"
  resolved_via            text not null, -- 'openfigi' | 'name_normalize' | 'manual'
  resolved_at             timestamptz not null default now(),
  last_seen_in_holdings   date
);

create index if not exists idx_cusip_ticker_map_ticker
  on cusip_ticker_map (ticker)
  where ticker is not null;

alter table cusip_ticker_map enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_cusip_ticker_map') then
    create policy auth_read_cusip_ticker_map
      on cusip_ticker_map for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
