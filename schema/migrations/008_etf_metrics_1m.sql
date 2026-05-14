-- Migration 008: extend etf_metrics with 1M flow + flow_data_as_of.
--
-- Why now: with etf_flows_monthly (migration 007) populated, we finally have
-- real 1-month flow values per ticker. Add a flow_pct_1m / flow_usd_1m
-- column and a `flow_data_as_of` date so the UI can surface honestly
-- "1M flow as of YYYY-MM" given the ~60-day DERA lag.

alter table etf_metrics
    add column if not exists flow_pct_1m       numeric,
    add column if not exists flow_usd_1m       numeric,
    add column if not exists flow_data_as_of   date;
