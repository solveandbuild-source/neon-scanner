-- Migration 004: insider_transactions table for universe-wide Form 4 P data.
--
-- Distinct from events_form4 (which is tied to filings_raw and limited to
-- our 38 tracked filers). This table holds structured insider purchase
-- transactions from ANY US public company's insiders, used to detect
-- "3+ insiders buying within 30 days" clusters.
--
-- Storage profile: ~3K purchases/day across all US public cos × rolling
-- 60-day window = ~180K rows steady state. Old rows can be pruned by a
-- separate cleanup job.

create table if not exists insider_transactions (
    id                      uuid primary key default gen_random_uuid(),
    accession_number        text not null,
    issuer_cik              text not null,
    issuer_name             text,
    issuer_ticker           text,
    reporter_cik            text,
    reporter_name           text,
    reporter_is_officer     boolean,
    reporter_is_director    boolean,
    reporter_is_ten_pct     boolean,
    officer_title           text,
    transaction_date        date not null,
    transaction_code        text not null,  -- always 'P' for now (we filter at ingest)
    shares                  numeric,
    price                   numeric,
    value_usd               numeric,        -- computed shares * price
    primary_doc_url         text,
    filed_at                timestamptz not null,
    fetched_at              timestamptz not null default now(),
    -- Composite unique: a single Form 4 can have multiple lines, but each
    -- line is identified by (accession + reporter + date + code + shares).
    unique (accession_number, reporter_cik, transaction_date, transaction_code, shares)
);
create index if not exists insider_tx_issuer_date_idx
    on insider_transactions(issuer_cik, transaction_date desc);
create index if not exists insider_tx_filed_at_idx
    on insider_transactions(filed_at desc);
create index if not exists insider_tx_recent_purchases_idx
    on insider_transactions(transaction_date desc)
    where transaction_code = 'P';

alter table insider_transactions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_insider_tx') then
    create policy auth_read_insider_tx
      on insider_transactions for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
