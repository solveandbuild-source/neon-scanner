import { supabaseServer } from "@/lib/supabase";
import { filerInfo, tier } from "@/lib/filers";
import { TierFilter } from "@/components/TierFilter";
import { FilerCardTabs } from "@/components/FilerCardTabs";

// Force dynamic rendering. Without this, Next.js statically renders the page
// at build time and serves the snapshot from the deploy. After May 17 we
// caught the holdings page serving Q3 2025 data because the cached build
// pre-dated the Q1 2026 13F ingestion. Fresh DB read on every request.
export const dynamic = "force-dynamic";

// Color classes for the signal-quality tier chip (S/A/B/C).
const TIER_CHIP: Record<"S" | "A" | "B" | "C", string> = {
  S: "bg-emerald-600/30 text-emerald-300 border border-emerald-700/50",
  A: "bg-sky-600/30 text-sky-300 border border-sky-700/50",
  B: "bg-neutral-800 text-neutral-400 border border-neutral-700",
  C: "bg-neutral-800 text-neutral-500 border border-neutral-700",
};
import { daysAgo } from "@/lib/format";

// Holdings view: per-filer most recent 13F snapshot, with top positions by value.
// This is *plumbing inspection*, not signal generation — confluence scoring
// will be built fresh after all plumbing lands.

type Holding = {
  cik: string;
  filer_name: string | null;
  period_of_report: string;
  filed_at: string;  // when the 13F was actually filed (≠ period_of_report)
  cusip: string;
  ticker: string | null;
  issuer_name: string | null;
  shares: number | null;
  value_usd: number | null;
  put_call: string | null;  // 'Put' / 'Call' / null. Options are SHORT/HEDGE bets — we filter these out of long-holdings display.
};

// Cost-basis estimate per (filer, ticker) — keyed `${cik}|${ticker}`.
type CostEstimate = { estimated_cost_basis: number; first_seen_period: string };

// Normalize issuer_name → matchable key. Mirror of cost_basis.py's normalize_name.
// holdings_13f.ticker is NULL for 100% of rows (parse_13f only stores CUSIP),
// so we resolve to ticker at render time against the tickers universe.
const SUFFIX_RE = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS|HLDGS|GROUP|GRP|LLC|LP|TRUST|N V|NV|SA|AG|TR|CL A|CL B|CLASS A|CLASS B|COM|ORD|ORDINARY|SHARES)\b\.?/gi;
const PUNCT_RE = /[.,&/\-()']/g;
function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toUpperCase()
    .replace(PUNCT_RE, " ")
    .replace(SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHoldings(): Promise<{
  filers: FilerSummary[];
  total: number;
  prices: Record<string, number>;
  costs: Record<string, CostEstimate>;
  nameToTicker: Record<string, string>;
}> {
  const sb = supabaseServer();
  // pull all holdings with filer name joined via the filing
  const out: Holding[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("holdings_13f")
      .select(
        "cik,period_of_report,cusip,ticker,issuer_name,shares,value_usd,put_call,filings_raw!inner(filer_name,filed_at)",
      )
      // Stable secondary sort on `id` is REQUIRED — without it PostgREST's
      // page-window can drop rows that share the same period_of_report.
      // Bug caught May 21: Druckenmiller's top positions (Natera, Insmed, TSM)
      // were silently missing because his ~70 Q1 2026 rows were paginated
      // unstably across multiple .range() calls.
      .order("period_of_report", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Array<Holding & { filings_raw: { filer_name: string | null; filed_at: string } }>) {
      out.push({
        cik: r.cik,
        filer_name: r.filings_raw?.filer_name ?? null,
        period_of_report: r.period_of_report,
        filed_at: r.filings_raw?.filed_at ?? "",
        cusip: r.cusip,
        ticker: r.ticker,
        issuer_name: r.issuer_name,
        shares: r.shares,
        value_usd: r.value_usd,
        put_call: r.put_call ?? null,
      });
    }
    if (data.length < page) break;
    from += page;
    if (from > 200000) break; // raised from 50K → 200K. Caps at ~6-8 quarters of all filers; ensures latest 2 quarters always present in full.
  }

  // Dedupe amendments: for each (cik, period_of_report) keep ONLY rows from
  // the latest filed_at. SEC 13F-HR/A amendments supersede the original;
  // without this we triple-count positions when Oaktree files 13F + 2
  // amendments (caught May 21 — TORM PLC was appearing 3× in their card).
  const latestFiledByFilerPeriod = new Map<string, string>();  // `${cik}|${period}` → max filed_at
  for (const h of out) {
    const k = `${h.cik}|${h.period_of_report}`;
    const cur = latestFiledByFilerPeriod.get(k);
    if (!cur || h.filed_at > cur) latestFiledByFilerPeriod.set(k, h.filed_at);
  }
  const deduped = out.filter((h) =>
    h.filed_at === latestFiledByFilerPeriod.get(`${h.cik}|${h.period_of_report}`),
  );

  // For each filer, collect positions GROUPED BY period so we can diff the
  // latest quarter vs the prior quarter (CLAUDE.md §6.1: emit new/add/trim/exit).
  const byFilerByPeriod = new Map<string, Map<string, Holding[]>>();
  const filerMeta = new Map<string, { name: string; filedAt: Record<string, string> }>();
  for (const h of deduped) {
    if (!byFilerByPeriod.has(h.cik)) byFilerByPeriod.set(h.cik, new Map());
    const periods = byFilerByPeriod.get(h.cik)!;
    if (!periods.has(h.period_of_report)) periods.set(h.period_of_report, []);
    periods.get(h.period_of_report)!.push(h);
    if (!filerMeta.has(h.cik)) filerMeta.set(h.cik, { name: h.filer_name ?? h.cik, filedAt: {} });
    filerMeta.get(h.cik)!.filedAt[h.period_of_report] = h.filed_at;
  }

  // Aggregate by issuer (case-normalized name). Filters options (put/call)
  // since those are short/hedge bets, not long holdings. Aggregating by
  // issuer collapses cases where one issuer has multiple CUSIPs (e.g.
  // Chesapeake legacy CUSIP + post-merger Expand Energy CUSIP).
  const normIssuer = (n: string | null) => (n ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  function aggregateByIssuer(positions: Holding[]): Holding[] {
    const m = new Map<string, Holding>();
    for (const p of positions) {
      if (p.put_call) continue;  // skip puts/calls
      const key = normIssuer(p.issuer_name);
      if (!key) continue;
      const existing = m.get(key);
      if (!existing) {
        m.set(key, { ...p });
      } else {
        existing.shares = (existing.shares ?? 0) + (p.shares ?? 0);
        existing.value_usd = (existing.value_usd ?? 0) + (p.value_usd ?? 0);
      }
    }
    return Array.from(m.values());
  }

  const byFiler = new Map<string, FilerSummary>();
  for (const [cik, periods] of byFilerByPeriod) {
    const sortedPeriods = Array.from(periods.keys()).sort().reverse();
    const latest = sortedPeriods[0];
    const prior = sortedPeriods[1] ?? null;
    const meta = filerMeta.get(cik)!;
    const latestAgg = aggregateByIssuer(periods.get(latest)!);
    const priorAgg = prior ? aggregateByIssuer(periods.get(prior)!) : [];
    const priorByIssuer = new Map(priorAgg.map((p) => [normIssuer(p.issuer_name), p]));
    const latestIssuers = new Set(latestAgg.map((p) => normIssuer(p.issuer_name)));

    // News: in latest, not in prior. Sort by latest value desc.
    const news: Holding[] = prior
      ? latestAgg
          .filter((p) => !priorByIssuer.has(normIssuer(p.issuer_name)))
          .sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
      : [];
    // Adds: in both, shares up ≥10%. Sort by % desc.
    const adds: Array<{ pos: Holding; prevShares: number; pct: number }> = [];
    // Trims: in both, shares down ≥10%. Sort by % asc (most-trimmed first).
    const trims: Array<{ pos: Holding; prevShares: number; pct: number }> = [];
    if (prior) {
      for (const p of latestAgg) {
        const prev = priorByIssuer.get(normIssuer(p.issuer_name));
        if (!prev || !prev.shares || prev.shares === 0) continue;
        const ratio = ((p.shares ?? 0) - prev.shares) / prev.shares;
        if (ratio >= 0.10) adds.push({ pos: p, prevShares: prev.shares, pct: ratio * 100 });
        else if (ratio <= -0.10) trims.push({ pos: p, prevShares: prev.shares, pct: ratio * 100 });
      }
      adds.sort((a, b) => b.pct - a.pct);
      trims.sort((a, b) => a.pct - b.pct);
    }
    // Exits: in prior, not in latest. Sort by prior value desc.
    const exits: Holding[] = prior
      ? priorAgg
          .filter((p) => !latestIssuers.has(normIssuer(p.issuer_name)))
          .sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
      : [];

    byFiler.set(cik, {
      cik,
      name: meta.name,
      latestPeriod: latest,
      latestFiledAt: meta.filedAt[latest] ?? "",
      priorPeriod: prior,
      positions: latestAgg,
      priorByCusip: priorByIssuer,  // now keyed by normalized issuer name (still called "ByCusip" for type compat — TODO rename)
      news,
      adds,
      trims,
      exits,
      totalValue: 0,
      totalPositions: 0,
    });
  }
  // Compute totals across all positions in the latest quarter, THEN trim to top 10.
  //
  // 13F value normalization: SEC's pre-2024 instruction was "value in thousands",
  // post-2024 is "value in dollars". Different filers transitioned at different
  // times and some still use the old scale. Detection heuristic: if the median
  // implied per-share price (value/shares) across the filer's top positions is
  // suspiciously low (<$5), the value field is in thousands — multiply by 1000.
  for (const f of byFiler.values()) {
    f.positions.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));
    const topForScale = f.positions.slice(0, 10);
    const marks = topForScale
      .map((p) => (p.value_usd && p.shares ? p.value_usd / p.shares : null))
      .filter((m): m is number => m != null && m > 0)
      .sort((a, b) => a - b);
    const medianMark = marks.length ? marks[Math.floor(marks.length / 2)] : null;
    const inThousands = medianMark != null && medianMark < 5;
    const scale = inThousands ? 1000 : 1;
    if (scale !== 1) {
      for (const p of f.positions) {
        if (p.value_usd != null) p.value_usd *= scale;
      }
    }
    f.totalValue = f.positions.reduce((sum, p) => sum + (p.value_usd ?? 0), 0);
    f.totalPositions = f.positions.length;
    f.positions = f.positions.slice(0, 10);
  }
  // Sort filers by RECENCY of latest filing (newest first) so freshly-updated
  // filers float to the top of the page.
  const filers = Array.from(byFiler.values()).sort(
    (a, b) => b.latestFiledAt.localeCompare(a.latestFiledAt),
  );

  // Build normalized-name → ticker map FIRST (so we can resolve at render
  // time + use those resolved tickers to drive the price lookup below).
  const nameToTicker: Record<string, string> = {};
  {
    let off = 0;
    while (true) {
      const { data } = await sb.from("tickers").select("ticker,name").range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const norm = normalizeName(row.name);
        if (norm && !(norm in nameToTicker)) nameToTicker[norm] = row.ticker;
      }
      if (data.length < 1000) break;
      off += 1000;
    }
  }

  // Resolve each position's ticker (via row.ticker fallback to name lookup)
  // and collect the set we need prices for.
  const tickerSet = new Set<string>();
  for (const f of filers) {
    for (const p of f.positions) {
      const resolved = p.ticker || nameToTicker[normalizeName(p.issuer_name)];
      if (resolved) {
        p.ticker = resolved;  // mutate in place so the render path picks it up
        tickerSet.add(resolved);
      }
    }
  }
  const prices: Record<string, number> = {};
  if (tickerSet.size > 0) {
    // Batch tickers so we don't blow Supabase's URL length on 800+ tickers
    const tickersArr = Array.from(tickerSet);
    const batchSize = 200;
    for (let i = 0; i < tickersArr.length; i += batchSize) {
      const batch = tickersArr.slice(i, i + batchSize);
      const { data } = await sb.from("tickers").select("ticker,price").in("ticker", batch);
      for (const row of data ?? []) {
        if (row.price != null) prices[row.ticker] = row.price;
      }
    }
  }
  // Cost-basis estimates (keyed cik|ticker). Populated by ingest/cost_basis.py.
  // Missing rows = no usable VWAP yet (newly-tracked filer, illiquid ticker, etc.)
  const costs: Record<string, CostEstimate> = {};
  {
    const cikSet = new Set(filers.map((f) => f.cik));
    if (cikSet.size > 0) {
      const ciksArr = Array.from(cikSet);
      const batchSize = 100;
      for (let i = 0; i < ciksArr.length; i += batchSize) {
        const batch = ciksArr.slice(i, i + batchSize);
        const { data } = await sb
          .from("filer_position_cost")
          .select("cik,ticker,estimated_cost_basis,first_seen_period")
          .in("cik", batch);
        for (const row of data ?? []) {
          costs[`${row.cik}|${row.ticker}`] = {
            estimated_cost_basis: row.estimated_cost_basis,
            first_seen_period: row.first_seen_period,
          };
        }
      }
    }
  }

  return { filers, total: out.length, prices, costs, nameToTicker };
}

type FilerSummary = {
  cik: string;
  name: string;
  latestPeriod: string;
  latestFiledAt: string;
  // Prior-quarter snapshot for diff display (CLAUDE.md §6.1: new/add/trim/exit).
  // priorPeriod = the immediately-preceding 13F period we have for this filer (null if none).
  // priorByCusip = O(1) lookup for "did they hold this last quarter?".
  // exits = positions present last quarter but missing this quarter, sorted by prior value desc.
  priorPeriod: string | null;
  priorByCusip: Map<string, Holding>;  // keyed by normalized issuer name (not cusip — legacy field name)
  news: Holding[];
  adds: Array<{ pos: Holding; prevShares: number; pct: number }>;
  trims: Array<{ pos: Holding; prevShares: number; pct: number }>;
  exits: Holding[];
  positions: Holding[];
  totalValue: number;       // sum of value_usd across ALL positions that quarter (not just top 10)
  totalPositions: number;   // count of all positions that quarter
};

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

// Compact % formatter for the Δ shares column. Caps massive values that
// otherwise overflow the column (e.g. NEW positions building from 1 share
// to 100k → "+10,000,000%" looks broken). Renders ≥1000% as multiples ("12×").
function fmtPctCompact(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  const abs = Math.abs(pct);
  if (abs >= 1000) {
    const mult = pct / 100;  // 1234% = 12.34×
    return `${sign}${mult.toFixed(0)}×`;
  }
  if (abs >= 100) return `${sign}${pct.toFixed(0)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Tier = "S" | "A" | "B" | "C";

// "Changes vs last quarter" view body. Renders 4 row-based sections:
// 🆕 New, + Adds, ⇣ Trims, ✕ Exits. Each item gets its own row.
// Server component — pure rendering, no state.
function ChangesView({ f }: { f: FilerSummary }) {
  if (!f.priorPeriod) {
    return (
      <div className="px-3 py-6 text-[11px] text-neutral-500 italic text-center">
        No prior 13F to compare. First-quarter filer or only one period of data.
      </div>
    );
  }
  const totalChanges = f.news.length + f.adds.length + f.trims.length + f.exits.length;
  if (totalChanges === 0) {
    return (
      <div className="px-3 py-6 text-[11px] text-neutral-500 italic text-center">
        No changes ≥10% vs prior quarter ({f.priorPeriod}).
      </div>
    );
  }
  const truncate = (s: string | null, n = 32) => {
    const v = s ?? "?";
    return v.length > n ? v.slice(0, n) + "…" : v;
  };
  return (
    <div className="text-[11px]">
      <div className="px-3 py-1.5 text-neutral-500 bg-neutral-950 border-b border-neutral-900">
        Diff vs prior 13F (period {f.priorPeriod}) — share-count changes ≥10%
      </div>

      {f.news.length > 0 && (
        <div>
          <div className="px-3 py-1 bg-emerald-950/40 text-emerald-300 font-medium border-b border-emerald-900/30">
            🆕 New positions ({f.news.length})
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-neutral-900">
              {f.news.map((p) => (
                <tr key={`new-${p.cusip}`} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-1 text-neutral-200 truncate max-w-[20ch]" title={p.issuer_name ?? ""}>{truncate(p.issuer_name)}</td>
                  <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtShares(p.shares)}</td>
                  <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtUsd(p.value_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {f.adds.length > 0 && (
        <div>
          <div className="px-3 py-1 bg-emerald-950/30 text-emerald-400 font-medium border-b border-emerald-900/20">
            + Added ({f.adds.length})
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-neutral-900">
              {f.adds.map((a) => (
                <tr key={`add-${a.pos.cusip}`} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-1 text-neutral-200 truncate max-w-[20ch]" title={a.pos.issuer_name ?? ""}>{truncate(a.pos.issuer_name)}</td>
                  <td className="px-3 py-1 text-right text-neutral-400 tabular-nums">{fmtShares(a.prevShares)} → {fmtShares(a.pos.shares)}</td>
                  <td className="px-3 py-1 text-right text-emerald-400 tabular-nums font-semibold">{fmtPctCompact(a.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {f.trims.length > 0 && (
        <div>
          <div className="px-3 py-1 bg-amber-950/30 text-amber-400 font-medium border-b border-amber-900/20">
            ⇣ Trimmed ({f.trims.length})
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-neutral-900">
              {f.trims.map((t) => (
                <tr key={`trim-${t.pos.cusip}`} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-1 text-neutral-200 truncate max-w-[20ch]" title={t.pos.issuer_name ?? ""}>{truncate(t.pos.issuer_name)}</td>
                  <td className="px-3 py-1 text-right text-neutral-400 tabular-nums">{fmtShares(t.prevShares)} → {fmtShares(t.pos.shares)}</td>
                  <td className="px-3 py-1 text-right text-amber-400 tabular-nums font-semibold">{fmtPctCompact(t.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {f.exits.length > 0 && (
        <div>
          <div className="px-3 py-1 bg-red-950/30 text-red-400 font-medium border-b border-red-900/20">
            ✕ Exited ({f.exits.length})
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-neutral-900">
              {f.exits.map((e) => (
                <tr key={`exit-${e.cusip}`} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-1 text-neutral-200 truncate max-w-[20ch]" title={e.issuer_name ?? ""}>{truncate(e.issuer_name)}</td>
                  <td className="px-3 py-1 text-right text-neutral-400 tabular-nums">{fmtShares(e.shares)} sh</td>
                  <td className="px-3 py-1 text-right text-red-400/80 tabular-nums">{fmtUsd(e.value_usd)} sold</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function HoldingsPage() {
  const { filers, total, prices, costs } = await fetchHoldings();
  // (nameToTicker mutation already applied to position.ticker in fetchHoldings)

  // Compute counts per tier across all filers for the filter-chip badges.
  // Filtering itself is done client-side by TierFilter (toggles .hidden on
  // each card via data-tier attribute) — server always renders all cards.
  const tierCounts: Record<Tier, number> = { S: 0, A: 0, B: 0, C: 0 };
  for (const f of filers) {
    const t = (filerInfo(f.cik)?.signalTier ?? "B") as Tier;
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  }

  if (filers.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Holdings</h1>
        <p className="text-neutral-400">
          No parsed 13F positions yet. Run <code className="text-neutral-300">python -m ingest.parse_13f</code> to populate.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Holdings — latest 13F per filer</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {total.toLocaleString()} position rows parsed across {filers.length} filers.
          Showing each filer&apos;s 10 largest positions in their most-recent 13F.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Each card shows the filer&apos;s top 10 positions in their latest 13F. Sorted by filing recency (newest at the top). 13Fs have a 45-day legal disclosure delay — the gap between &quot;period&quot; and &quot;filed&quot; is that delay.
        </p>
      </header>

      <TierFilter counts={tierCounts} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span><span className="inline-block w-2 h-2 align-middle mr-1 bg-amber-500"></span>activist filer</span>
        <span><span className="inline-block w-2 h-2 align-middle mr-1 bg-sky-500"></span>corporate strategic</span>
        <span><span className="text-emerald-400">filed &lt;14d ago</span> = fresh</span>
        <span><span className="text-red-400">filed &gt;120d ago</span> = stale</span>
        <span className="text-emerald-300">% of port ≥10% = high conviction</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span><span className="text-amber-400">Mark/sh</span> = quarter-end $/share (NOT entry)</span>
        <span><span className="text-amber-400">Est. cost</span> = VWAP-proxy entry (±15-25%)</span>
        <span><span className="text-amber-400">P&L</span> = (Now − Est. cost) / Est. cost — filer's paper gain</span>
        <span><span className="text-amber-400">Δ shares</span> = share-count change vs prior 13F</span>
      </div>

      <div id="tier-filter-empty" className="hidden text-sm text-neutral-500 italic py-12 text-center border border-neutral-900 rounded">
        No filers match the selected tier(s). Toggle a tier above to expand the view.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filers.map((f) => {
          const info = filerInfo(f.cik);
          const t = tier(f.cik);
          const borderL = t === 2 ? "border-l-amber-500" : t === 1 ? "border-l-sky-500" : "border-l-neutral-800";

          // Recency badge: fresh = filed within 14 days, stale = filed >90 days ago.
          const filedDate = f.latestFiledAt ? new Date(f.latestFiledAt) : null;
          const daysSinceFile = filedDate ? Math.floor((Date.now() - filedDate.getTime()) / 86400000) : null;
          let recencyClass = "text-neutral-500";
          if (daysSinceFile != null) {
            if (daysSinceFile <= 14) recencyClass = "text-emerald-400";
            else if (daysSinceFile <= 60) recencyClass = "text-neutral-300";
            else if (daysSinceFile > 120) recencyClass = "text-red-400";
          }

          const signalTier = info?.signalTier ?? "B";
          return (
          <div key={f.cik} data-tier={signalTier} className={`rounded-md border border-neutral-800 border-l-2 ${borderL} overflow-hidden`}>
            <div className="px-3 py-2 bg-neutral-900 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {info?.signalTier && (
                    <span className={`px-1 text-[10px] font-mono rounded shrink-0 ${TIER_CHIP[info.signalTier]}`} title={`Signal-quality tier: ${info.signalTier}`}>
                      {info.signalTier}
                    </span>
                  )}
                  <div className="font-medium text-neutral-100 truncate" title={f.name}>{info?.entity ?? f.name}</div>
                </div>
                {(info?.manager || info?.badge) && (
                  <div className="text-xs text-neutral-500 truncate">
                    {info?.manager && <span>{info.manager}</span>}
                    {info?.manager && info?.badge && <span className="text-neutral-700"> · </span>}
                    {info?.badge && <span className="italic">{info.badge}</span>}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-xs tabular-nums ${recencyClass}`}>
                  filed {daysSinceFile != null ? daysAgo(f.latestFiledAt) : "?"}
                </div>
                <div className="text-[10px] text-neutral-500 tabular-nums">period {f.latestPeriod}</div>
              </div>
            </div>
            <div className="px-3 py-1 bg-neutral-950 text-[10px] text-neutral-500 flex justify-between">
              <span>Total portfolio: {fmtUsd(f.totalValue)}</span>
              <span>{f.totalPositions} positions</span>
            </div>
            <FilerCardTabs
              changesCount={f.news.length + f.adds.length + f.trims.length + f.exits.length}
              current={(
            <table className="w-full text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Issuer</th>
                  <th className="px-3 py-1 text-right font-medium">Shares</th>
                  <th className="px-3 py-1 text-right font-medium">Value</th>
                  <th className="px-3 py-1 text-right font-medium" title="Position value as % of this filer's total US-equity portfolio">% of port</th>
                  <th className="px-3 py-1 text-right font-medium" title="Quarter-end market value per share (value ÷ shares). NOT the actual entry price the filer paid.">Mark/sh</th>
                  <th className="px-3 py-1 text-right font-medium" title="Latest closing price from yfinance">Now</th>
                  <th className="px-3 py-1 text-right font-medium" title="Estimated cost basis — weighted-avg $/share across accumulation quarters, using each quarter's VWAP as a proxy. Typically ±15-25% off true cost. Missing = no usable VWAP yet.">Est. cost</th>
                  <th className="px-3 py-1 text-right font-medium whitespace-nowrap" title="Filer's paper P&L: (Now - Est. cost) / Est. cost. Positive = filer is up vs estimated entry. NOT precise — Est. cost is a proxy.">P&L</th>
                  <th className="px-3 py-1 text-right font-medium whitespace-nowrap" title="Filer behavior — change in SHARE COUNT vs their prior 13F. NEW = didn't hold last quarter. +X% = bought more. -X% = sold some. Different from P&L (which tracks price move, not share count change).">Δ shares</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {f.positions.map((h, i) => {
                  const pct = f.totalValue > 0 && h.value_usd != null ? (h.value_usd / f.totalValue) * 100 : null;
                  const markPrice = h.value_usd != null && h.shares && h.shares > 0 ? h.value_usd / h.shares : null;
                  const nowPrice = h.ticker ? prices[h.ticker] ?? null : null;
                  // Estimated cost basis from filer_position_cost (proxy via per-quarter VWAP)
                  const costEst = h.ticker ? costs[`${f.cik}|${h.ticker}`] : undefined;
                  const estCost = costEst?.estimated_cost_basis ?? null;
                  const vsCostPct = nowPrice != null && estCost != null && estCost > 0
                    ? ((nowPrice - estCost) / estCost) * 100
                    : null;
                  const vsCostColor = vsCostPct == null
                    ? "text-neutral-500"
                    : vsCostPct >= 50 ? "text-emerald-300 font-semibold"
                    : vsCostPct >= 0 ? "text-emerald-400/80"
                    : vsCostPct >= -15 ? "text-red-400/70"
                    : "text-red-400";
                  // vs Q-1 diff: NEW (didn't hold last quarter), +X% add, -X% trim, blank if unchanged.
                  // Threshold ≥5% to surface meaningful change (matches CLAUDE.md §6.1 spirit; spec says ≥10%).
                  const prev = f.priorByCusip.get(h.cusip);
                  let qDiffLabel: string | null = null;
                  let qDiffColor = "text-neutral-500";
                  if (!f.priorPeriod) {
                    qDiffLabel = null;
                  } else if (!prev) {
                    qDiffLabel = "NEW";
                    qDiffColor = "text-emerald-300 font-semibold";
                  } else {
                    const a = prev.shares ?? 0;
                    const b = h.shares ?? 0;
                    if (a > 0) {
                      const ratio = (b - a) / a;
                      if (ratio >= 0.05) {
                        qDiffLabel = fmtPctCompact(ratio * 100);
                        qDiffColor = ratio >= 0.5 ? "text-emerald-300 font-semibold" : "text-emerald-400/80";
                      } else if (ratio <= -0.05) {
                        qDiffLabel = fmtPctCompact(ratio * 100);
                        qDiffColor = ratio <= -0.5 ? "text-red-400 font-semibold" : "text-red-400/80";
                      }
                    }
                  }
                  return (
                  <tr key={`${h.cusip}-${i}`}>
                    <td className="px-3 py-1 text-neutral-200 truncate max-w-[16ch]" title={`${h.issuer_name ?? ""} — CUSIP ${h.cusip}`}>{h.issuer_name ?? "—"}</td>
                    <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtShares(h.shares)}</td>
                    <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtUsd(h.value_usd)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {pct != null ? (
                        <span className={pct >= 10 ? "text-emerald-300" : pct >= 5 ? "text-emerald-400/70" : "text-neutral-400"}>
                          {pct.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-1 text-right text-neutral-400 tabular-nums">
                      {markPrice != null ? `$${markPrice.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">
                      {nowPrice != null ? `$${nowPrice.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-1 text-right text-neutral-400 tabular-nums" title={costEst ? `Estimated from per-quarter VWAP, accumulating since ${costEst.first_seen_period}. Proxy — typically ±15-25% off true cost.` : "No cost-basis estimate yet (no usable VWAP)."}>
                      {estCost != null ? `$${estCost.toFixed(2)}` : "—"}
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${vsCostColor}`}>
                      {vsCostPct != null ? fmtPctCompact(vsCostPct) : "—"}
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${qDiffColor}`}
                        title={f.priorPeriod ? `vs prior 13F (period ${f.priorPeriod}): prev shares ${(prev?.shares ?? 0).toLocaleString()}` : "no prior 13F to compare"}>
                      {qDiffLabel ?? "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
              )}
              changes={(<ChangesView f={f} />)}
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}
