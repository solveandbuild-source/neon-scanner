-- Migration 009: add flow_1m_as_of so the dashboard can distinguish 1M-flow
-- staleness (which uses DERA monthly, ~4-5 month lag) from 3M/6M/1Y flow
-- staleness (which uses fresh public N-PORT XML, ~2-3 month lag).

alter table etf_metrics
    add column if not exists flow_1m_as_of date;
