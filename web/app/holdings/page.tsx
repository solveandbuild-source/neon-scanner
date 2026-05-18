import { supabaseServer } from "@/lib/supabase";
import { filerInfo, tier } from "@/lib/filers";
import { TierFilter } from "@/components/TierFilter";

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
  issuer_name: string | null;
  shares: number | null;
  value_usd: number | null;
};

async function fetchHoldings(): Promise<{ filers: FilerSummary[]; total: number }> {
  const sb = supabaseServer();
  // pull all holdings with filer name joined via the filing
  const out: Holding[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("holdings_13f")
      .select(
        "cik,period_of_report,cusip,issuer_name,shares,value_usd,filings_raw!inner(filer_name,filed_at)",
      )
      .order("period_of_report", { ascending: false })
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
        issuer_name: r.issuer_name,
        shares: r.shares,
        value_usd: r.value_usd,
      });
    }
    if (data.length < page) break;
    from += page;
    if (from > 50000) break; // hard cap during plumbing phase — full UI later
  }

  // For each filer, find their MOST RECENT period, keep ALL positions
  // from that period (so we can compute true portfolio totals), then we'll
  // trim to top 10 for display.
  const byFiler = new Map<string, FilerSummary>();
  for (const h of out) {
    const cur = byFiler.get(h.cik);
    if (!cur) {
      byFiler.set(h.cik, {
        cik: h.cik,
        name: h.filer_name ?? h.cik,
        latestPeriod: h.period_of_report,
        latestFiledAt: h.filed_at,
        positions: [h],
        totalValue: 0,
        totalPositions: 0,
      });
    } else if (h.period_of_report > cur.latestPeriod) {
      cur.latestPeriod = h.period_of_report;
      cur.latestFiledAt = h.filed_at;
      cur.positions = [h];
    } else if (h.period_of_report === cur.latestPeriod) {
      cur.positions.push(h);
    }
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
  return { filers, total: out.length };
}

type FilerSummary = {
  cik: string;
  name: string;
  latestPeriod: string;
  latestFiledAt: string;
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

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type SP = { tier?: string };
type Tier = "S" | "A" | "B" | "C";
const ALL_TIERS: Tier[] = ["S", "A", "B", "C"];

export default async function HoldingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { filers, total } = await fetchHoldings();

  // Compute counts per tier across all filers (BEFORE filtering) for the chip badges
  const tierCounts: Record<Tier, number> = { S: 0, A: 0, B: 0, C: 0 };
  for (const f of filers) {
    const t = (filerInfo(f.cik)?.signalTier ?? "B") as Tier;
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  }

  // Parse selected tiers from URL. Missing param = show all.
  const selectedTiers: Set<Tier> = sp.tier
    ? new Set(sp.tier.split(",").filter((t): t is Tier => (ALL_TIERS as string[]).includes(t)))
    : new Set(ALL_TIERS);

  // Filter filers to only those whose signalTier is in selectedTiers
  const visibleFilers = filers.filter((f) => {
    const t = (filerInfo(f.cik)?.signalTier ?? "B") as Tier;
    return selectedTiers.has(t);
  });

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
        <span><span className="text-amber-400">Mark/sh</span> = quarter-end price, NOT entry price</span>
      </div>

      {visibleFilers.length === 0 ? (
        <div className="text-sm text-neutral-500 italic py-12 text-center border border-neutral-900 rounded">
          No filers match the selected tier(s). Toggle a tier above to expand the view.
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleFilers.map((f) => {
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

          return (
          <div key={f.cik} className={`rounded-md border border-neutral-800 border-l-2 ${borderL} overflow-hidden`}>
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
              <span>{f.totalPositions} positions · showing top 10</span>
            </div>
            <table className="w-full text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Issuer</th>
                  <th className="px-3 py-1 text-right font-medium">Shares</th>
                  <th className="px-3 py-1 text-right font-medium">Value</th>
                  <th className="px-3 py-1 text-right font-medium" title="Position value as % of this filer's total US-equity portfolio">% of port</th>
                  <th className="px-3 py-1 text-right font-medium" title="Quarter-end market value per share (value ÷ shares). NOT the actual entry price the filer paid.">Mark/sh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {f.positions.map((h, i) => {
                  const pct = f.totalValue > 0 && h.value_usd != null ? (h.value_usd / f.totalValue) * 100 : null;
                  const markPrice = h.value_usd != null && h.shares && h.shares > 0 ? h.value_usd / h.shares : null;
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
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
