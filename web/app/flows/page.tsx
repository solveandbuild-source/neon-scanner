import { supabaseServer } from "@/lib/supabase";
import { ETF_UNIVERSE, type EtfMeta } from "@/lib/etfs";

// /flows — top-down view, ETF AUM + flow + price together.
// The key insight: FLOW and PRICE are different. Money can leave a fund
// while stocks go up (distribution) or money can pile in as stocks drop
// (accumulation). The divergence between the two is often the signal.

type Snapshot = {
  ticker: string;
  snapshot_date: string;
  aum_usd: number | null;
  daily_flow_usd: number | null;  // quarterly net flow in practice
  price: number | null;
};

type TickerAgg = {
  meta: EtfMeta;
  latest_aum: number | null;
  latest_date: string | null;
  latest_price: number | null;
  flow_1y: number | null;       // null if no flow data
  flow_pct: number | null;      // null if no AUM/no flow data
  price_return_1y: number | null;
  divergence: "money_chasing_price" | "money_leaving_winner" | "money_buying_dip" | "money_fleeing_loser" | "aligned" | "unknown";
  history: Snapshot[];
};

async function fetchAllFlows(): Promise<Map<string, Snapshot[]>> {
  const sb = supabaseServer();
  const out = new Map<string, Snapshot[]>();
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_flows")
      .select("ticker,snapshot_date,aum_usd,daily_flow_usd,price")
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
    // Only compute flow if we actually have non-null flow snapshots in the window
    const flowSnapshots = history.filter(
      (s) => s.snapshot_date >= cutoff_1y && s.daily_flow_usd != null,
    );
    const flow_1y: number | null = flowSnapshots.length > 0
      ? flowSnapshots.reduce((sum, s) => sum + (s.daily_flow_usd ?? 0), 0)
      : null;
    const flow_pct: number | null =
      flow_1y != null && latest?.aum_usd ? (flow_1y / latest.aum_usd) * 100 : null;

    // Find a price ~1y ago (closest snapshot to cutoff_1y) for return computation
    let price_1y_ago: number | null = null;
    for (const s of history) {
      if (s.snapshot_date <= cutoff_1y && s.price != null) {
        price_1y_ago = s.price;
      } else if (s.snapshot_date > cutoff_1y) {
        break;
      }
    }
    // If no snapshot before cutoff, use oldest available
    if (price_1y_ago == null && history.length >= 2) {
      const oldest = history.find((s) => s.price != null);
      price_1y_ago = oldest?.price ?? null;
    }
    const latest_price = latest?.price ?? null;
    const price_return_1y =
      latest_price != null && price_1y_ago != null && price_1y_ago > 0
        ? ((latest_price - price_1y_ago) / price_1y_ago) * 100
        : null;

    // Classify divergence — the actual signal
    let divergence: TickerAgg["divergence"] = "unknown";
    if (price_return_1y != null && flow_pct != null) {
      const priceUp = price_return_1y > 5;
      const priceDown = price_return_1y < -5;
      const flowIn = flow_pct > 2;
      const flowOut = flow_pct < -2;
      if (priceUp && flowIn) divergence = "money_chasing_price";  // both up
      else if (priceUp && flowOut) divergence = "money_leaving_winner";  // distribution
      else if (priceDown && flowIn) divergence = "money_buying_dip";  // accumulation
      else if (priceDown && flowOut) divergence = "money_fleeing_loser";  // both down
      else divergence = "aligned";
    }

    out.push({
      meta,
      latest_aum: latest?.aum_usd ?? null,
      latest_date: latest?.snapshot_date ?? null,
      latest_price,
      flow_1y,
      flow_pct,
      price_return_1y,
      divergence,
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

function fmtPct(n: number | null, digits = 1): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const DIVERGENCE_INFO: Record<TickerAgg["divergence"], { label: string; explainer: string; color: string }> = {
  money_chasing_price: {
    label: "Both up",
    explainer: "Stocks up AND money flowing in — momentum / late stage",
    color: "text-emerald-300",
  },
  money_leaving_winner: {
    label: "Distribution ⚠",
    explainer: "Stocks up BUT money leaving — profit-taking, sometimes a top",
    color: "text-amber-300",
  },
  money_buying_dip: {
    label: "Accumulation ⚠",
    explainer: "Stocks down BUT money flowing in — buying the dip, sometimes a bottom",
    color: "text-sky-300",
  },
  money_fleeing_loser: {
    label: "Both down",
    explainer: "Stocks down AND money leaving — capitulation",
    color: "text-red-300",
  },
  aligned: {
    label: "Mild",
    explainer: "Movement is small in both flow and price",
    color: "text-neutral-400",
  },
  unknown: {
    label: "—",
    explainer: "Not enough data",
    color: "text-neutral-500",
  },
};

// Compute headlines — the 3-5 most signal-bearing observations
function computeHeadlines(aggs: TickerAgg[]): string[] {
  const lines: string[] = [];

  // Narrow to entries that actually have a flow_pct for the calculations below
  type WithFlow = TickerAgg & { flow_pct: number };
  const withFlow: WithFlow[] = aggs.filter((a): a is WithFlow => a.flow_pct != null);

  // 1) Big flow gainers (>=8% inflow)
  const bigInflows = withFlow.filter((a) => a.flow_pct >= 8).sort((a, b) => b.flow_pct - a.flow_pct);
  if (bigInflows.length > 0) {
    const top = bigInflows[0];
    lines.push(
      `Biggest inflow: ${top.meta.label} (${top.meta.ticker}) +${top.flow_pct.toFixed(1)}% of fund size — passive money is rotating in.`,
    );
  }

  // 2) Biggest outflows
  const bigOutflows = withFlow.filter((a) => a.flow_pct <= -8).sort((a, b) => a.flow_pct - b.flow_pct);
  if (bigOutflows.length > 0) {
    const top = bigOutflows[0];
    lines.push(
      `Biggest outflow: ${top.meta.label} (${top.meta.ticker}) ${top.flow_pct.toFixed(1)}% of fund size — money exiting.`,
    );
  }

  // 3) Distribution pattern (stocks up but flow out) — most useful signal
  const distribution = withFlow
    .filter((a) => a.divergence === "money_leaving_winner")
    .sort((a, b) => a.flow_pct - b.flow_pct);
  if (distribution.length > 0) {
    const top = distribution[0];
    lines.push(
      `Distribution watch: ${top.meta.label} stocks ${fmtPct(top.price_return_1y)} but ETF flow ${top.flow_pct.toFixed(1)}% — money taking profits despite price strength.`,
    );
  }

  // 4) Accumulation pattern (stocks down but flow in)
  const accumulation = withFlow
    .filter((a) => a.divergence === "money_buying_dip")
    .sort((a, b) => b.flow_pct - a.flow_pct);
  if (accumulation.length > 0) {
    const top = accumulation[0];
    lines.push(
      `Accumulation watch: ${top.meta.label} stocks ${fmtPct(top.price_return_1y)} but ETF flow +${top.flow_pct.toFixed(1)}% — buying the dip.`,
    );
  }

  // 5) Duration shift in bonds
  const ief = withFlow.find((a) => a.meta.ticker === "IEF");
  const tlt = withFlow.find((a) => a.meta.ticker === "TLT");
  if (ief && tlt && ief.flow_pct > 5 && tlt.flow_pct < -5) {
    lines.push(
      `Bond curve: money rotating INTO 7-10y Treasuries (IEF +${ief.flow_pct.toFixed(1)}%) and OUT of 20y+ (TLT ${tlt.flow_pct.toFixed(1)}%) — duration shortening.`,
    );
  }

  return lines;
}

function bubbleSize(aum: number | null, max: number): { w: number; h: number } {
  if (!aum || max <= 0) return { w: 80, h: 80 };
  const norm = Math.sqrt(aum / max);
  const px = Math.max(80, Math.min(220, 220 * norm));
  return { w: px, h: px };
}

function flowColorClass(pct: number): string {
  if (pct >= 10) return "bg-emerald-900/60";
  if (pct >= 3) return "bg-emerald-900/30";
  if (pct >= 1) return "bg-emerald-950/40";
  if (pct <= -10) return "bg-red-900/60";
  if (pct <= -3) return "bg-red-900/30";
  if (pct <= -1) return "bg-red-950/40";
  return "bg-neutral-900";
}

export default async function FlowsPage() {
  const byTicker = await fetchAllFlows();
  const aggs = aggregate(byTicker);
  const headlines = computeHeadlines(aggs);

  const crossAsset = aggs.filter((a) => a.meta.category === "cross_asset");
  const sectors = aggs.filter((a) => a.meta.category === "us_sector");
  const themes = aggs.filter((a) => a.meta.category === "theme");
  const maxCrossAssetAum = Math.max(...crossAsset.map((a) => a.latest_aum ?? 0));

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Flows — top-down money movement</h1>

        {/* HOW TO READ THIS PAGE — the critical mental model */}
        <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
          <div className="font-medium text-amber-200 mb-1">⚠ Important: Flow ≠ Stock Price</div>
          <p className="text-neutral-300 text-xs leading-relaxed">
            This page shows <strong>fund flow</strong> (money in/out of ETFs), <em>not stock price</em>. Stocks can go UP while money LEAVES a fund (people taking profits — &ldquo;distribution&rdquo;). Or stocks can go DOWN while money flows IN (buying the dip — &ldquo;accumulation&rdquo;). The <strong>divergence</strong> between flow and price is often the signal — both columns are shown side-by-side.
          </p>
        </div>

        {/* HEADLINES */}
        {headlines.length > 0 && (
          <div className="mt-3 rounded-md border border-neutral-800 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-400 font-medium mb-2">What&apos;s happening — last 12 months</div>
            <ul className="space-y-1 text-sm text-neutral-200">
              {headlines.map((h, i) => <li key={i}>• {h}</li>)}
            </ul>
          </div>
        )}
      </header>

      {/* CROSS-ASSET */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Cross-asset — where the money is moving (last 12 months)
        </h2>
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Asset class</th>
                <th className="px-3 py-2 font-medium">Pattern</th>
                <th className="px-3 py-2 font-medium text-right">Stock price 1y</th>
                <th className="px-3 py-2 font-medium text-right">Fund flow 1y</th>
                <th className="px-3 py-2 font-medium text-right">AUM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {crossAsset
                .sort((a, b) => (b.flow_pct ?? -999) - (a.flow_pct ?? -999))
                .map((a) => {
                  const div = DIVERGENCE_INFO[a.divergence];
                  return (
                    <tr key={a.meta.ticker} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <div className="text-neutral-100">{a.meta.label}</div>
                        <div className="text-xs text-neutral-500 font-mono">{a.meta.ticker}</div>
                      </td>
                      <td className={`px-3 py-2 text-xs ${div.color}`} title={div.explainer}>
                        {div.label}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(a.price_return_1y ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.price_return_1y)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_pct == null ? "text-neutral-500" : a.flow_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.flow_pct)}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-400 tabular-nums">{fmtUsd(a.latest_aum)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Sorted by fund-flow direction. Watch for <span className="text-amber-300">Distribution ⚠</span> (stocks up but money leaving) and <span className="text-sky-300">Accumulation ⚠</span> (stocks down but money flowing in) — those are the actionable patterns.
        </p>
      </section>

      {/* US SECTOR ROTATION */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          US Sector rotation (11 SPDRs) — Flow vs Price side-by-side
        </h2>
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 font-medium text-right">AUM</th>
                <th className="px-3 py-2 font-medium text-right">1y Stock Price</th>
                <th className="px-3 py-2 font-medium text-right">1y Fund Flow</th>
                <th className="px-3 py-2 font-medium text-right">Flow % of fund</th>
                <th className="px-3 py-2 font-medium">Pattern</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {sectors
                .sort((a, b) => (b.flow_pct ?? -999) - (a.flow_pct ?? -999))
                .map((a) => {
                  const div = DIVERGENCE_INFO[a.divergence];
                  return (
                    <tr key={a.meta.ticker} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <div className="text-neutral-100">{a.meta.label}</div>
                        <div className="text-xs text-neutral-500 font-mono">{a.meta.ticker}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">{fmtUsd(a.latest_aum)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(a.price_return_1y ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.price_return_1y)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_1y == null ? "text-neutral-500" : a.flow_1y >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtFlow(a.flow_1y)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_pct == null ? "text-neutral-500" : a.flow_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.flow_pct)}
                      </td>
                      <td className={`px-3 py-2 text-xs ${div.color}`} title={div.explainer}>
                        {div.label}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Sorted by Flow %. Look for <span className="text-amber-300">Distribution ⚠</span> (stocks up but money leaving) and <span className="text-sky-300">Accumulation ⚠</span> (stocks down but money flowing in) — those are the most useful patterns.
        </p>
      </section>

      {/* THEMES */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Themes — modern verticals
        </h2>
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Theme</th>
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-3 py-2 font-medium text-right">AUM</th>
                <th className="px-3 py-2 font-medium text-right">1y Stock Price</th>
                <th className="px-3 py-2 font-medium text-right">1y Fund Flow</th>
                <th className="px-3 py-2 font-medium text-right">Flow % of fund</th>
                <th className="px-3 py-2 font-medium">Pattern</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {themes
                .sort((a, b) => (b.flow_pct ?? -999) - (a.flow_pct ?? -999))
                .map((a) => {
                  const div = DIVERGENCE_INFO[a.divergence];
                  return (
                    <tr key={a.meta.ticker} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <div className="text-neutral-100">{a.meta.label}</div>
                        <div className="text-xs text-neutral-500">{a.meta.long_name}</div>
                      </td>
                      <td className="px-3 py-2 text-neutral-300 font-mono">{a.meta.ticker}</td>
                      <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">{fmtUsd(a.latest_aum)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(a.price_return_1y ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.price_return_1y)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_1y == null ? "text-neutral-500" : a.flow_1y >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtFlow(a.flow_1y)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.flow_pct == null ? "text-neutral-500" : a.flow_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(a.flow_pct)}
                      </td>
                      <td className={`px-3 py-2 text-xs ${div.color}`} title={div.explainer}>
                        {div.label}
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
