import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { filerInfo, allFilers } from "@/lib/filers";

// Stock-level view: pivot of holdings_13f by issuer (CUSIP).
// Tells you, for each stock, which tracked funds own it and how much.
// This is the "confluence" lens — stocks held by many smart funds rise to top.

type StockRow = {
  cusip: string;
  issuer_name: string;
  n_funds: number;
  pct_funds: number;
  total_shares: number;
  total_value_usd: number;
  avg_price_per_share: number | null;   // value / shares (quarter-end mark)
  earliest_period: string;               // when first held in our 3-year window
  latest_period: string;
  fund_list: { name: string; manager: string | null; category: string; value: number; shares: number }[];
};

type RawHolding = {
  cik: string;
  cusip: string;
  issuer_name: string | null;
  shares: number | null;
  value_usd: number | null;
  period_of_report: string;
};

async function fetchAggregated(): Promise<{ stocks: StockRow[]; totalFunds: number }> {
  const sb = supabaseServer();
  const all: RawHolding[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("holdings_13f")
      .select("cik,cusip,issuer_name,shares,value_usd,period_of_report")
      .order("period_of_report", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as RawHolding[]));
    if (data.length < 1000) break;
    from += 1000;
    if (from > 60000) break;
  }

  // Group by CUSIP, taking each filer's MOST-RECENT position only.
  const byKey = new Map<
    string,
    {
      cusip: string;
      issuer_name: string;
      perFund: Map<string, { shares: number; value: number; period: string }>;
      earliest: string;
      latest: string;
    }
  >();

  for (const h of all) {
    if (!h.cusip || !h.issuer_name) continue;
    const k = h.cusip;
    if (!byKey.has(k)) {
      byKey.set(k, {
        cusip: k,
        issuer_name: h.issuer_name,
        perFund: new Map(),
        earliest: h.period_of_report,
        latest: h.period_of_report,
      });
    }
    const bucket = byKey.get(k)!;
    if (h.period_of_report < bucket.earliest) bucket.earliest = h.period_of_report;
    if (h.period_of_report > bucket.latest) bucket.latest = h.period_of_report;
    // For each filer, keep only their latest position on this stock
    const existing = bucket.perFund.get(h.cik);
    if (!existing || h.period_of_report > existing.period) {
      bucket.perFund.set(h.cik, {
        shares: h.shares ?? 0,
        value: h.value_usd ?? 0,
        period: h.period_of_report,
      });
    }
  }

  const totalFunds = allFilers().filter((f) => f.category !== "corporate_strategic").length;

  const stocks: StockRow[] = [];
  for (const b of byKey.values()) {
    if (b.perFund.size === 0) continue;
    let totalShares = 0;
    let totalValue = 0;
    const fundList: StockRow["fund_list"] = [];
    for (const [cik, pos] of b.perFund.entries()) {
      totalShares += pos.shares;
      totalValue += pos.value;
      const info = filerInfo(cik);
      fundList.push({
        name: info?.entity ?? cik,
        manager: info?.manager ?? null,
        category: info?.category ?? "?",
        value: pos.value,
        shares: pos.shares,
      });
    }
    fundList.sort((a, b) => b.value - a.value);

    stocks.push({
      cusip: b.cusip,
      issuer_name: b.issuer_name,
      n_funds: b.perFund.size,
      pct_funds: (b.perFund.size / totalFunds) * 100,
      total_shares: totalShares,
      total_value_usd: totalValue,
      avg_price_per_share: totalShares > 0 ? totalValue / totalShares : null,
      earliest_period: b.earliest,
      latest_period: b.latest,
      fund_list: fundList,
    });
  }

  // Sort by # funds holding desc, then by total value desc
  stocks.sort((a, b) => b.n_funds - a.n_funds || b.total_value_usd - a.total_value_usd);

  return { stocks, totalFunds };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtShares(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

export default async function StocksPage() {
  const { stocks, totalFunds } = await fetchAggregated();
  // Surface only stocks held by ≥2 funds — that's where confluence starts.
  const confluence = stocks.filter((s) => s.n_funds >= 2).slice(0, 100);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Stocks — by tracked-fund confluence</h1>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">What this shows</div>
            <ul className="space-y-1 text-neutral-300">
              <li>One row per stock</li>
              <li>How many of our {totalFunds} tracked funds hold it</li>
              <li>Combined position size</li>
            </ul>
          </div>
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">Sorted by</div>
            <ul className="space-y-1 text-neutral-300">
              <li>Number of funds holding (desc)</li>
              <li>Then by total $ exposure</li>
              <li>Only stocks with ≥2 funds shown</li>
            </ul>
          </div>
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">Avg price column</div>
            <ul className="space-y-1 text-neutral-300">
              <li>Total $ value / total shares</li>
              <li>= quarter-end market price</li>
              <li><span className="text-amber-400">Not actual entry price</span></li>
            </ul>
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Confluence stocks ({confluence.length} of {stocks.length} total issuers)
        </h2>
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Issuer</th>
                <th className="px-3 py-2 font-medium text-right">% funds</th>
                <th className="px-3 py-2 font-medium text-right">Funds</th>
                <th className="px-3 py-2 font-medium text-right">Total value</th>
                <th className="px-3 py-2 font-medium text-right">Avg price</th>
                <th className="px-3 py-2 font-medium">First held</th>
                <th className="px-3 py-2 font-medium">Top holders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {confluence.map((s) => {
                const hasActivist = s.fund_list.some((f) => f.category === "activist");
                const borderL = hasActivist
                  ? "border-l-2 border-l-amber-500"
                  : "border-l-2 border-l-transparent";
                return (
                  <tr key={s.cusip} className={`hover:bg-neutral-900/50 ${borderL}`}>
                    <td className="px-3 py-2 align-top">
                      <div className="text-neutral-100">{s.issuer_name}</div>
                      <div className="text-xs text-neutral-500 font-mono">{s.cusip}</div>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <span className="text-emerald-300 tabular-nums">{s.pct_funds.toFixed(0)}%</span>
                    </td>
                    <td className="px-3 py-2 text-right align-top text-neutral-200 tabular-nums">
                      {s.n_funds}/{totalFunds}
                    </td>
                    <td className="px-3 py-2 text-right align-top text-neutral-200 tabular-nums">
                      {fmtUsd(s.total_value_usd)}
                    </td>
                    <td className="px-3 py-2 text-right align-top text-neutral-300 tabular-nums">
                      {s.avg_price_per_share != null ? `$${s.avg_price_per_share.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-neutral-400">
                      {s.earliest_period}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-xs text-neutral-400 space-y-0.5">
                        {s.fund_list.slice(0, 3).map((f, i) => (
                          <div key={i}>
                            <span className={f.category === "activist" ? "text-amber-300" : "text-neutral-300"}>
                              {f.manager ?? f.name}
                            </span>{" "}
                            <span className="text-neutral-500 tabular-nums">{fmtUsd(f.value)}</span>
                          </div>
                        ))}
                        {s.fund_list.length > 3 && (
                          <div className="text-neutral-500">+{s.fund_list.length - 3} more</div>
                        )}
                      </div>
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
