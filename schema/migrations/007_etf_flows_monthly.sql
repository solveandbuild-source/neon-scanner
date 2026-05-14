-- Migration 007: etf_flows_monthly — true monthly creation/redemption flow
-- extracted from SEC DERA's N-PORT structured datasets.
--
-- Why this exists: N-PORT primary_doc.xml omits Part D (shareholderFlowInfo)
-- by SEC rule. However the DERA quarterly bulk dataset
-- (sec.gov/data-research/sec-markets-data/form-n-port-data-sets) DOES include
-- it in FUND_REPORTED_INFO.tsv columns SALES_FLOW_MON{1,2,3} +
-- REDEMPTION_FLOW_MON{1,2,3} + REINVESTMENT_FLOW_MON{1,2,3}.
--
-- Net flow per month = sales + reinvestment − redemption.
-- Each N-PORT filing covers a 3-month reporting period; MON3 corresponds to
-- the report_date, MON2 is one month earlier, MON1 two months earlier.
--
-- This is the read source for 1M/3M/6M/1Y flow windows in /flows.

create table if not exists etf_flows_monthly (
    ticker                 text,
    month_end              date,
    net_flow_usd           numeric,
    sales_flow_usd         numeric,
    redemption_flow_usd    numeric,
    reinvestment_flow_usd  numeric,
    source_accession       text,
    primary key (ticker, month_end)
);

create index if not exists idx_etf_flows_monthly_ticker_month
    on etf_flows_monthly (ticker, month_end desc);

alter table etf_flows_monthly enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_etf_flows_monthly') then
    create policy auth_read_etf_flows_monthly
      on etf_flows_monthly for select
      using (auth.role() = 'authenticated');
  end if;
end$$;
