import { supabaseServer } from "@/lib/supabase";

// Staleness checker — fires when an ingest pipeline appears to have stopped
// updating. Visible at the top of /flows as a banner so silent breakage in
// cron / launchd / scrapers becomes loud.

export type StalenessCheck = {
  source: string;          // human label
  latest: string | null;   // ISO date string of newest data
  age_days: number | null;
  threshold_days: number;
  ok: boolean;
};

const CHECKS: { source: string; table: string; date_col: string; threshold_days: number }[] = [
  // ─── ETF flow pipeline ──────────────────────────────────────────────
  // Yahoo daily AUM — runs nightly, should always be within 4 days (weekend + holiday cushion)
  { source: "Yahoo daily AUM",     table: "etf_aum_daily",     date_col: "as_of_date",    threshold_days: 4 },
  // iShares daily — same cadence
  { source: "iShares daily",        table: "etf_shares_daily",  date_col: "as_of_date",    threshold_days: 4 },
  // N-PORT individual filings refresh weekly; newest are ~60-90 days behind their period
  { source: "Public N-PORT XML",    table: "etf_flows",         date_col: "snapshot_date", threshold_days: 110 },
  // DERA quarterly bulk — updates 1x per quarter
  { source: "DERA bulk N-PORT",     table: "etf_flows_monthly", date_col: "month_end",     threshold_days: 200 },
  // ─── Smart-money pipeline (filings, events, signals, holdings) ──────
  // EDGAR filings poll runs daily — newest filing fetched should be within ~4 days
  { source: "EDGAR filings poll",   table: "filings_raw",       date_col: "filed_at",      threshold_days: 7 },
];

export async function runStalenessChecks(): Promise<StalenessCheck[]> {
  const sb = supabaseServer();
  const today = new Date();
  const results: StalenessCheck[] = [];

  for (const c of CHECKS) {
    const { data, error } = await sb
      .from(c.table)
      .select(c.date_col)
      .order(c.date_col, { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      results.push({
        source: c.source, latest: null, age_days: null,
        threshold_days: c.threshold_days, ok: false,
      });
      continue;
    }
    const raw = (data[0] as unknown as Record<string, unknown>)[c.date_col];
    const latest = typeof raw === "string" ? raw : null;
    if (!latest) {
      results.push({
        source: c.source, latest: null, age_days: null,
        threshold_days: c.threshold_days, ok: false,
      });
      continue;
    }
    // Handle both date (YYYY-MM-DD) and timestamptz (YYYY-MM-DDTHH:MM:SS+TZ) columns
    const dateOnly = latest.slice(0, 10);
    const ms = today.getTime() - new Date(dateOnly + "T00:00:00").getTime();
    const age_days = Math.floor(ms / 86400000);
    results.push({
      source: c.source,
      latest: dateOnly,
      age_days,
      threshold_days: c.threshold_days,
      ok: age_days <= c.threshold_days,
    });
  }
  return results;
}
