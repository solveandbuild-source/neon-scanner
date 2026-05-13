import { supabaseServer } from "@/lib/supabase";
import { filerInfo, tier } from "@/lib/filers";
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

  // For each filer, find their MOST RECENT period, keep only those rows,
  // and pick top 10 by value.
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
      });
    } else if (h.period_of_report > cur.latestPeriod) {
      cur.latestPeriod = h.period_of_report;
      cur.latestFiledAt = h.filed_at;
      cur.positions = [h];
    } else if (h.period_of_report === cur.latestPeriod) {
      cur.positions.push(h);
    }
  }
  for (const f of byFiler.values()) {
    f.positions.sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));
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

export default async function HoldingsPage() {
  const { filers, total } = await fetchHoldings();
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

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>
          <span className="inline-block w-2 h-2 align-middle mr-1 bg-amber-500"></span>activist filer
        </span>
        <span>
          <span className="inline-block w-2 h-2 align-middle mr-1 bg-sky-500"></span>corporate strategic
        </span>
        <span><span className="text-emerald-400">filed &lt;14d ago</span> = fresh</span>
        <span><span className="text-red-400">filed &gt;120d ago</span> = stale</span>
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

          return (
          <div key={f.cik} className={`rounded-md border border-neutral-800 border-l-2 ${borderL} overflow-hidden`}>
            <div className="px-3 py-2 bg-neutral-900 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-neutral-100 truncate" title={f.name}>{info?.entity ?? f.name}</div>
                {info?.manager && (
                  <div className="text-xs text-neutral-500">{info.manager} · {info.category}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-xs tabular-nums ${recencyClass}`}>
                  filed {daysSinceFile != null ? daysAgo(f.latestFiledAt) : "?"}
                </div>
                <div className="text-[10px] text-neutral-500 tabular-nums">period {f.latestPeriod}</div>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Issuer</th>
                  <th className="px-3 py-1 text-left font-medium">CUSIP</th>
                  <th className="px-3 py-1 text-right font-medium">Shares</th>
                  <th className="px-3 py-1 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {f.positions.map((h, i) => (
                  <tr key={`${h.cusip}-${i}`}>
                    <td className="px-3 py-1 text-neutral-200 truncate max-w-[16ch]" title={h.issuer_name ?? ""}>{h.issuer_name ?? "—"}</td>
                    <td className="px-3 py-1 text-neutral-500 font-mono">{h.cusip}</td>
                    <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtShares(h.shares)}</td>
                    <td className="px-3 py-1 text-right text-neutral-300 tabular-nums">{fmtUsd(h.value_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>
    </div>
  );
}
