-- portfolio-scanner schema for Supabase Postgres
-- Run this against a fresh Supabase project. Idempotent (uses IF NOT EXISTS).
-- RLS is enabled on every table. Single-user model: rows scoped to auth.uid().

-- ─────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- tracked_filers — the universe of filers we ingest
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists tracked_filers (
    id              uuid primary key default gen_random_uuid(),
    cik             text unique,            -- nullable: filer may be pending lookup
    name            text not null,
    category        text not null check (category in ('value','concentrated','growth','activist','macro','corporate_strategic')),
    multiplier      numeric not null default 1.0,
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- filings_raw — every fetched filing, deduped by accession number
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists filings_raw (
    id                  uuid primary key default gen_random_uuid(),
    accession_number    text unique not null,
    cik                 text not null,
    filer_name          text,
    form_type           text not null,       -- '13F-HR', 'SC 13D', 'SC 13G', '4', etc.
    filed_at            timestamptz not null,
    period_of_report    date,
    primary_doc_url     text,
    raw_payload         jsonb,               -- parsed header + index, not full doc body
    fetched_at          timestamptz not null default now()
);
create index if not exists filings_raw_cik_idx on filings_raw(cik);
create index if not exists filings_raw_form_idx on filings_raw(form_type);
create index if not exists filings_raw_filed_at_idx on filings_raw(filed_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- holdings_13f — flattened position rows
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists holdings_13f (
    id                  uuid primary key default gen_random_uuid(),
    filing_id           uuid not null references filings_raw(id) on delete cascade,
    cik                 text not null,
    period_of_report    date not null,
    cusip               text,
    ticker              text,
    issuer_name         text,
    shares              bigint,
    value_usd           numeric,
    put_call            text,
    created_at          timestamptz not null default now()
);
create index if not exists holdings_13f_cik_period_idx on holdings_13f(cik, period_of_report desc);
create index if not exists holdings_13f_ticker_idx on holdings_13f(ticker);

-- ─────────────────────────────────────────────────────────────────────────
-- events_13d — activist / passive stake disclosures
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists events_13d (
    id              uuid primary key default gen_random_uuid(),
    filing_id       uuid not null references filings_raw(id) on delete cascade,
    cik             text not null,            -- filer CIK
    issuer_cik      text,                     -- subject company CIK
    issuer_name     text,
    ticker          text,
    form_subtype    text not null,            -- '13D' | '13D/A' | '13G' | '13G/A'
    percent_owned   numeric,
    event_date      date not null,
    created_at      timestamptz not null default now()
);
create index if not exists events_13d_ticker_idx on events_13d(ticker, event_date desc);

-- ─────────────────────────────────────────────────────────────────────────
-- events_form4 — insider transactions
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists events_form4 (
    id                  uuid primary key default gen_random_uuid(),
    filing_id           uuid not null references filings_raw(id) on delete cascade,
    reporter_cik        text not null,
    reporter_name       text,
    issuer_cik          text,
    issuer_name         text,
    ticker              text,
    transaction_date    date not null,
    transaction_code    text,                 -- 'P' purchase, 'S' sale, etc.
    shares              numeric,
    price               numeric,
    created_at          timestamptz not null default now()
);
create index if not exists events_form4_ticker_idx on events_form4(ticker, transaction_date desc);

-- ─────────────────────────────────────────────────────────────────────────
-- tickers — investable universe snapshot
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists tickers (
    ticker                  text primary key,
    name                    text,
    market_cap_usd          numeric,
    avg_dollar_volume_20d   numeric,
    price                   numeric,
    return_3mo              numeric,
    return_6mo              numeric,
    return_12mo             numeric,
    classification          text check (classification in ('tradeable','late_stage','too_illiquid','untracked')),
    snapshot_at             timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- signals — emitted entry signals
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists signals (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid(),
    ticker          text not null,
    score           numeric not null,
    components      jsonb not null,           -- breakdown; never null per §2.4
    window_days     int not null,
    classification  text not null,            -- copied from tickers at emit time
    emitted_at      timestamptz not null default now()
);
create index if not exists signals_emitted_at_idx on signals(emitted_at desc);
create index if not exists signals_ticker_idx on signals(ticker);

-- ─────────────────────────────────────────────────────────────────────────
-- user_positions — held positions, drives exit-rule monitoring
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists user_positions (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null default auth.uid(),
    ticker              text not null,
    entry_price         numeric not null,
    entry_date          date not null,
    shares              numeric not null,
    trailing_stop_pct   numeric,              -- overrides default if set
    notes               text,
    closed_at           timestamptz,
    created_at          timestamptz not null default now()
);
create index if not exists user_positions_open_idx on user_positions(user_id) where closed_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- exit_signals — emitted against open positions
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists exit_signals (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid(),
    position_id     uuid not null references user_positions(id) on delete cascade,
    ticker          text not null,
    reason          text not null,            -- 'trailing_stop' | 'filer_exit' | 'score_decay_drawdown'
    details         jsonb not null,
    emitted_at      timestamptz not null default now()
);
create index if not exists exit_signals_emitted_idx on exit_signals(emitted_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- signal_acknowledgements — append-only log of user actions
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists signal_acknowledgements (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid(),
    signal_id       uuid,                     -- nullable: may reference exit_signals via kind
    exit_signal_id  uuid,
    kind            text not null check (kind in ('entry','exit')),
    action          text not null check (action in ('acknowledged','dismissed','acted_on')),
    note            text,
    created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — single-user, scoped to auth.uid()
-- ─────────────────────────────────────────────────────────────────────────
alter table tracked_filers          enable row level security;
alter table filings_raw             enable row level security;
alter table holdings_13f            enable row level security;
alter table events_13d              enable row level security;
alter table events_form4            enable row level security;
alter table tickers                 enable row level security;
alter table signals                 enable row level security;
alter table user_positions          enable row level security;
alter table exit_signals            enable row level security;
alter table signal_acknowledgements enable row level security;

-- Reference data (filers, filings, holdings, events, tickers) is readable by any
-- authenticated user; in a single-user setup this is fine. Write paths are
-- handled by the service role (ingest workers bypass RLS).
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'auth_read_filers') then
    create policy auth_read_filers          on tracked_filers          for select using (auth.role() = 'authenticated');
    create policy auth_read_filings         on filings_raw             for select using (auth.role() = 'authenticated');
    create policy auth_read_holdings        on holdings_13f            for select using (auth.role() = 'authenticated');
    create policy auth_read_events_13d      on events_13d              for select using (auth.role() = 'authenticated');
    create policy auth_read_events_form4    on events_form4            for select using (auth.role() = 'authenticated');
    create policy auth_read_tickers         on tickers                 for select using (auth.role() = 'authenticated');
  end if;
end$$;

-- User-owned tables: rows scoped to auth.uid().
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'own_signals') then
    create policy own_signals               on signals                 for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_positions             on user_positions          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_exit_signals          on exit_signals            for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_acks                  on signal_acknowledgements for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end$$;
