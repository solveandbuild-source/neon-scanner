import { supabaseServer } from "@/lib/supabase";
import { ETF_UNIVERSE, etfMeta, type EtfMeta } from "@/lib/etfs";

// /flows — top-down money flow view, sourced from SEC N-PORT filings.
// Three sections:
//   1. Cross-asset (8 ETFs) — bubble layout sized by AUM, colored by recent flow
//   2. US sector heatmap (11 SPDRs) — grid colored by recent flow
//   3. Theme tracker — sortable table with 1yr / 2yr flow trends
//
// All numbers ground in observable N-PORT data. No prediction, no cycle calls.

type Snapshot = {
  ticker: string;
  snapshot_date: string;
  aum_usd: number | null;
  daily_flow_usd: number | null;  // quarterly net flow, in practice
};

type TickerAgg = {
  meta: EtfMeta;
  latest_aum: number | null;
  latest_date: string | null;
  flow_1y: number;              // sum of net flows over last 4 quarters
  flow_2y: number;
  history: Snapshot[];          // sorted oldest-first
};

async function fetchAllFlows(): Promise<Map<string, Snapshot[]>> {
  const sb = supabaseServer();
  const out = new Map<string, Snapshot[]>();
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_flows")
      .select("ticker,snapshot_date,aum_usd,daily_flow_usd")
      .order("snapshot_date", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Snapshot[]) {
      if (!out.has(r.ticker)) out.set(r.ticker, []);
      out.get(r.ticker)!.push(r);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function aggregate(byTicker: Map<string, Snapshot[]>): TickerAgg[] {
  const cutoff_1y = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const out: TickerAgg[] = [];
  for (const meta of ETF_UNIVERSE) {
    const history = byTicker.get(meta.ticker) ?? [];
    const latest = history[history.length - 1];
    const flow_1y = history
      .filter((s) => s.snapshot_date >= cutoff_1y && s.daily_flow_usd != null)
      .reduce((sum, s) => sum + (s.daily_flow_usd ?? 0), 0);
    const flow_2y = history
      .filter((s) => s.daily_flow_usd != null)
      .reduce((sum, s) => sum + (s.daily_flow_usd ?? 0), 0);
    out.push({
      meta,
      latest_aum: latest?.aum_usd ?? null,
      latest_date: latest?.snapshot_date ?? null,
      flow_1y,
      flow_2y,
      history,
    });
  }
  return out;
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${n < 0 ? "-" : ""}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${n < 0 ? "-" : ""}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(0)}M`;
  return `${n < 0 ? "-" : ""}$${abs.toFixed(0)}`;
}

function fmtFlow(n: number | null): string {
  if (n == null || n === 0) return "—";
  return (n > 0 ? "+" : "") + fmtUsd(n);
}

// Color for flow: green=inflow, red=outflow, neutral if small
function flowColorClass(flow: number, aum: number | null): string {
  if (!aum) return "text-neutral-400 bg-neutral-800";
  const pct = (flow / aum) * 100; // flow as % of AUM
  if (pct >= 10) return "text-emerald-200 bg-emerald-900/60";
  if (pct >= 3) return "text-emerald-300 bg-emerald-900/30";
  if (pct >= 1) return "text-emerald-400 bg-neutral-800";
  if (pct <= -10) return "text-red-200 bg-red-900/60";
  if (pct <= -3) return "text-red-300 bg-red-900/30";
  if (pct <= -1) return "text-red-400 bg-neutral-800";
  return "text-neutral-300 bg-neutral-800";
}

// Bubble sizing: sqrt scale so area ∝ AUM
function bubbleSize(aum: number | null, max: number): { w: number; h: number } {
  if (!aum || max <= 0) return { w: 80, h: 80 };
  const norm = Math.sqrt(aum / max);
  const px = Math.max(70, Math.min(220, 220 * norm));
  return { w: px, h: px };
}

export default async function FlowsPage() {
  const byTicker = await fetchAllFlows();
  const aggs = aggregate(byTicker);

  const crossAsset = aggs.filter((a) => a.meta.category === "cross_asset");
  const sectors = aggs.filter((a) => a.meta.category === "us_sector");
  const themes = aggs.filter((a) => a.meta.category === "theme");

  const maxCrossAssetAum = Math.max(...crossAsset.map((a) => a.latest_aum ?? 0));

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Flows — top-down money movement</h1>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">What this shows</div>
            <ul className="space-y-1 text-neutral-300">
              <li>Across <strong>{ETF_UNIVERSE.length}</strong> ETFs covering asset classes, US sectors, and themes</li>
              <li>AUM = current size of each fund</li>
              <li>Net flow = quarterly inflow / outflow net of price moves</li>
            </ul>
          </div>
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">Data source</div>
            <ul className="space-y-1 text-neutral-300">
              <li>SEC <span className="font-mono">N-PORT-P</span> filings</li>
              <li>Quarterly cadence, ~2 years history</li>
              <li>Authoritative (filed with SEC)</li>
            </ul>
          </div>
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">Color key</div>
            <ul className="space-y-1 text-neutral-300">
              <li><span className="inline-block w-3 h-3 bg-emerald-900/60 mr-1"></span> heavy inflow (≥10% of AUM)</li>
              <li><span className="inline-block w-3 h-3 bg-emerald-900/30 mr-1"></span> moderate inflow</li>
              <li><span className="inline-block w-3 h-3 bg-red-900/30 mr-1"></span> moderate outflow</li>
              <li><span className="inline-block w-3 h-3 bg-red-900/60 mr-1"></span> heavy outflow</li>
            </ul>
          </div>
        </div>
      </header>

      {/* CROSS-ASSET */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Cross-asset — where the money lives
        </h2>
        <div className="flex flex-wrap gap-3 items-end">
          {crossAsset.sort((a, b) => (b.latest_aum ?? 0) - (a.latest_aum ?? 0)).map((a) => {
            const { w, h } = bubbleSize(a.latest_aum, maxCrossAssetAum);
            const colorCls = flowColorClass(a.flow_1y, a.latest_aum);
            return (
              <div
                key={a.meta.ticker}
                className={`rounded-lg border border-neutral-700 p-3 flex flex-col justify-center items-center text-center ${colorCls}`}
                style={{ width: `${w}px`, height: `${h}px` }}
                title={`${a.meta.long_name} — Latest AUM ${fmtUsd(a.latest_aum)} on ${a.latest_date ?? "?"}`}
              >
                <div className="text-xs font-mono opacity-70">{a.meta.ticker}</div>
                <div className="text-xs font-medium truncate w-full px-1">{a.meta.label}</div>
                <div className="text-sm font-semibold tabular-nums mt-1">{fmtUsd(a.latest_aum)}</div>
                <div className="text-[10px] tabular-nums opacity-80 mt-1">1y flow {fmtFlow(a.flow_1y)}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Bubble size = current AUM (square-root scaling). Color = trailing 1-year net flow as % of AUM.
        </p>
      </section>

      {/* US SECTORS */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          US sector rotation (11 SPDRs)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {sectors
            .sort((a, b) => (b.flow_1y / (b.latest_aum ?? 1)) - (a.flow_1y / (a.latest_aum ?? 1)))
            .map((a) => {
              const colorCls = flowColorClass(a.flow_1y, a.latest_aum);
              const flowPct = a.latest_aum ? (a.flow_1y / a.latest_aum) * 100 : 0;
              return (
                <div
                  key={a.meta.ticker}
                  className={`rounded-md border border-neutral-700 p-3 ${colorCls}`}
                  title={a.meta.long_name}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="font-mono text-xs opacity-70">{a.meta.ticker}</div>
                    <div className="text-[10px] opacity-70">AUM {fmtUsd(a.latest_aum)}</div>
                  </div>
                  <div className="text-sm font-medium mt-1">{a.meta.label}</div>
                  <div className="text-xs tabular-nums mt-2">
                    1y flow: <strong>{fmtFlow(a.flow_1y)}</strong>
                    <span className="opacity-60"> ({flowPct >= 0 ? "+" : ""}{flowPct.toFixed(1)}%)</span>
                  </div>
                </div>
              );
            })}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Sorted by 1-year net flow as % of AUM (best inflows first). Click-through coming later.
        </p>
      </section>

      {/* THEMES */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Themes — modern verticals
        </h2>
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Theme</th>
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-3 py-2 font-medium text-right">AUM</th>
                <th className="px-3 py-2 font-medium text-right">1y flow</th>
                <th className="px-3 py-2 font-medium text-right">1y % of AUM</th>
                <th className="px-3 py-2 font-medium text-right">2y flow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {themes
                .sort((a, b) => (b.flow_1y / (b.latest_aum ?? 1)) - (a.flow_1y / (a.latest_aum ?? 1)))
                .map((a) => {
                  const flowPct = a.latest_aum ? (a.flow_1y / a.latest_aum) * 100 : 0;
                  const colorCls = flowPct >= 0 ? "text-emerald-300" : "text-red-300";
                  return (
                    <tr key={a.meta.ticker} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <div className="text-neutral-200">{a.meta.label}</div>
                        <div className="text-xs text-neutral-500">{a.meta.long_name}</div>
                      </td>
                      <td className="px-3 py-2 text-neutral-300 font-mono">{a.meta.ticker}</td>
                      <td className="px-3 py-2 text-right text-neutral-200 tabular-nums">{fmtUsd(a.latest_aum)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${colorCls}`}>{fmtFlow(a.flow_1y)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${colorCls}`}>
                        {a.latest_aum ? `${flowPct >= 0 ? "+" : ""}${flowPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_2y >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                        {fmtFlow(a.flow_2y)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
