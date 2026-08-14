import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { daysAgo, shortDate } from "@/lib/format";

// Clusters: the universe-wide insider-buy signal (3+ insiders buying the same US
// company inside a 30-day window, NOT limited to tracked filers) plus notable
// insider sells (≥ $5M) for context. Renamed from the old "Events" page — the
// 13D/G and tracked-filer Form-4 rows now live on Filings, and 8-K corporate
// events moved to /corporate. Route kept as /events so existing links don't break.

type EventForm4 = {
  filing_id: string;
  reporter_cik: string | null;
  reporter_name: string | null;
  issuer_name: string | null;
  ticker: string | null;
  transaction_date: string;
  transaction_code: string;
  shares: number | null;
  price: number | null;
  primary_doc_url: string | null;
};

type ClusterRow = {
  issuer_cik: string;
  issuer_name: string | null;
  issuer_ticker: string | null;
  n_buyers: number;
  total_value: number;
  total_shares: number;
  earliest_date: string;
  latest_date: string;
  buyers: { name: string; date: string; shares: number; price: number; value: number; title: string | null }[];
};

async function fetchInsiderClusters(): Promise<ClusterRow[]> {
  const sb = supabaseServer();
  // Rolling 30-day window
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  type RawTx = {
    issuer_cik: string;
    issuer_name: string | null;
    issuer_ticker: string | null;
    reporter_cik: string | null;
    reporter_name: string | null;
    officer_title: string | null;
    transaction_date: string;
    shares: number | null;
    price: number | null;
    value_usd: number | null;
  };

  const all: RawTx[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("insider_transactions")
      .select(
        "issuer_cik,issuer_name,issuer_ticker,reporter_cik,reporter_name,officer_title,transaction_date,shares,price,value_usd",
      )
      .eq("transaction_code", "P")
      .gte("transaction_date", cutoff)
      .order("transaction_date", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as RawTx[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  // Group by issuer
  const groups = new Map<string, RawTx[]>();
  for (const tx of all) {
    if (!groups.has(tx.issuer_cik)) groups.set(tx.issuer_cik, []);
    groups.get(tx.issuer_cik)!.push(tx);
  }

  const clusters: ClusterRow[] = [];
  for (const [cik, txs] of groups.entries()) {
    const buyerCiks = new Set(txs.map((t) => t.reporter_cik).filter(Boolean));
    if (buyerCiks.size < 3) continue;  // cluster threshold

    const totalValue = txs.reduce((s, t) => s + (t.value_usd ?? 0), 0);
    const totalShares = txs.reduce((s, t) => s + (t.shares ?? 0), 0);
    const dates = txs.map((t) => t.transaction_date).sort();
    clusters.push({
      issuer_cik: cik,
      issuer_name: txs[0].issuer_name,
      issuer_ticker: txs[0].issuer_ticker,
      n_buyers: buyerCiks.size,
      total_value: totalValue,
      total_shares: totalShares,
      earliest_date: dates[0],
      latest_date: dates[dates.length - 1],
      buyers: txs.map((t) => ({
        name: t.reporter_name ?? "?",
        date: t.transaction_date,
        shares: t.shares ?? 0,
        price: t.price ?? 0,
        value: t.value_usd ?? 0,
        title: t.officer_title,
      })),
    });
  }

  // Sort by n_buyers desc, then total_value desc
  clusters.sort((a, b) => b.n_buyers - a.n_buyers || b.total_value - a.total_value);
  return clusters;
}

// Notable insider sales: code 'S' with transaction value >= NOTABLE_SALE_USD.
// Most sales are noise (taxes, planned 10b5-1, diversification) — but large
// sales by named executives still carry signal worth surfacing.
const NOTABLE_SALE_USD = 5_000_000;

async function fetchNotableSales(): Promise<EventForm4[]> {
  const sb = supabaseServer();
  // We can't filter by computed shares*price in Supabase directly, so we
  // pull a wider net and filter in JS.
  const { data, error } = await sb
    .from("events_form4")
    .select(
      "filing_id,reporter_cik,reporter_name,issuer_name,ticker,transaction_date,transaction_code,shares,price,filings_raw!inner(primary_doc_url)",
    )
    .eq("transaction_code", "S")
    .order("transaction_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (
    data as unknown as Array<EventForm4 & { filings_raw: { primary_doc_url: string | null } }>
  )
    .map((r) => ({
      filing_id: r.filing_id,
      reporter_cik: r.reporter_cik,
      reporter_name: r.reporter_name,
      issuer_name: r.issuer_name,
      ticker: r.ticker,
      transaction_date: r.transaction_date,
      transaction_code: r.transaction_code,
      shares: r.shares,
      price: r.price,
      primary_doc_url: r.filings_raw?.primary_doc_url ?? null,
    }))
    .filter((e) => {
      const val = (e.shares ?? 0) * (e.price ?? 0);
      return val >= NOTABLE_SALE_USD;
    })
    .slice(0, 30);
}

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default async function ClustersPage() {
  const [clusters, notableSales] = await Promise.all([
    fetchInsiderClusters(),
    fetchNotableSales(),
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clusters</h1>
        <p className="mt-2 text-sm text-neutral-400 max-w-3xl">
          Universe-wide insider signal: US companies where{" "}
          <strong className="text-neutral-200">3+ different insiders</strong> (officers, directors, or
          10%+ holders) bought their own stock inside a 30-day window — <em>not</em> limited to the
          tracked filers. Below that, notable insider <em>sells</em> (≥ $5M) for context.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Insider buy clusters — 3+ insiders, last 30 days ({clusters.length})
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Universe-wide signal: stocks where 3+ different officers/directors/10%+ holders bought their own company&apos;s shares in a 30-day window. Historically generates 6-10% annual alpha on small/mid-caps (Lakonishok-Lee). Earliest column = first buy in the window; cluster &quot;builds&quot; from there.
        </p>
        {clusters.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No clusters yet. The universe-wide Form 4 ingester (<code className="text-neutral-300">python -m ingest.form4_universe</code>) needs to run first — backfilling 60 days takes ~3-4 hours. Once data is loaded, clusters will surface here automatically.
          </p>
        ) : (
          <div className="rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium text-right">Buyers</th>
                  <th className="px-3 py-2 font-medium text-right">Total value</th>
                  <th className="px-3 py-2 font-medium">Date range</th>
                  <th className="px-3 py-2 font-medium">Top buyers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {clusters.slice(0, 30).map((c) => (
                  <tr key={c.issuer_cik} className="hover:bg-neutral-900/50 border-l-2 border-l-emerald-500">
                    <td className="px-3 py-2 align-top">
                      <div className="text-neutral-100">{c.issuer_name ?? "?"}</div>
                      {c.issuer_ticker && (
                        <div className="text-xs text-neutral-500 font-mono">{c.issuer_ticker}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <span className={c.n_buyers >= 5 ? "text-emerald-300 text-base font-medium" : "text-emerald-400 text-base"}>
                        {c.n_buyers}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right align-top text-neutral-200 tabular-nums">
                      ${c.total_value >= 1e6 ? `${(c.total_value / 1e6).toFixed(1)}M` : `${(c.total_value / 1e3).toFixed(0)}K`}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-neutral-400">
                      {c.earliest_date}
                      {c.earliest_date !== c.latest_date && (
                        <> → {c.latest_date}</>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-xs text-neutral-400 space-y-0.5">
                        {c.buyers.slice(0, 4).map((b, i) => (
                          <div key={i}>
                            <span className="text-neutral-300">{b.name}</span>
                            {b.title && <span className="text-neutral-500"> ({b.title.slice(0, 25)})</span>}
                            <span className="text-neutral-500 tabular-nums"> · ${b.price.toFixed(2)} × {b.shares >= 1000 ? `${(b.shares / 1000).toFixed(0)}K` : b.shares}</span>
                          </div>
                        ))}
                        {c.buyers.length > 4 && (
                          <div className="text-neutral-500">+{c.buyers.length - 4} more</div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Notable insider sales — Form 4 code &apos;S&apos;, ≥ $5M ({notableSales.length})
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Most insider sales are noise (taxes, 10b5-1 plans, diversification). These are the few large enough to matter — sales of ≥ $5M by named executives. Sales themselves are NOT a buy signal — they&apos;re context.
        </p>
        {notableSales.length === 0 ? (
          <p className="text-sm text-neutral-500">No notable insider sales in current data.</p>
        ) : (
          <div className="rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Reporter</th>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium text-right">Shares</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium text-right">Value</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {notableSales.map((e, i) => {
                  const value = (e.shares ?? 0) * (e.price ?? 0);
                  return (
                  <tr key={`${e.filing_id}-${i}`} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
                      <span className="block text-neutral-100 tabular-nums">{shortDate(e.transaction_date)}</span>
                      <span className="block text-neutral-500 text-xs">{daysAgo(e.transaction_date)}</span>
                    </td>
                    <td className="px-3 py-2 text-neutral-300">{e.reporter_name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-300">{e.issuer_name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-200 font-mono">{e.ticker ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">{fmtShares(e.shares)}</td>
                    <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">
                      {e.price != null ? `$${e.price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={value >= 50_000_000 ? "text-red-300" : "text-red-400/70"}>
                        ${value >= 1e9 ? `${(value/1e9).toFixed(1)}B` : value >= 1e6 ? `${(value/1e6).toFixed(0)}M` : `${(value/1e3).toFixed(0)}K`}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {e.primary_doc_url ? (
                        <a href={e.primary_doc_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">sec.gov ↗</a>
                      ) : <span className="text-neutral-600">—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
