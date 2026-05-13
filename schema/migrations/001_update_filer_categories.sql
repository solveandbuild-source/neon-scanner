-- Migration 001: align tracked_filers.category CHECK constraint with the
-- categories we actually use, and add corporate_strategic.
--
-- Apply order: run AFTER schema/supabase.sql has been applied.
-- Safe to re-run (drops constraint IF EXISTS, then re-adds).

alter table tracked_filers
  drop constraint if exists tracked_filers_category_check;

alter table tracked_filers
  add constraint tracked_filers_category_check
  check (category in (
    'value',
    'concentrated',
    'growth',
    'activist',
    'macro',
    'corporate_strategic'
  ));
