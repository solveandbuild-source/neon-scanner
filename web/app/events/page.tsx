import { supabaseServer } from "@/lib/supabase";
import { daysAgo } from "@/lib/format";

// Events view: recent activist stake disclosures (13D/G) + insider buys (Form 4 code='P').
// Plumbing inspection. No scoring.

type Event13D = {
  filing_id: string;
  cik: string;
  issuer_name: string | null;
  ticker: string | null;
  form_subtype: string;
  percent_owned: number | null;
  event_date: string;
  filer_name: string | null;
  primary_doc_url: string | null;
};

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

async function fetchEvents13D(): Promise<Event13D[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("events_13d")
    .select(
      "filing_id,cik,issuer_name,ticker,form_subtype,percent_owned,event_date,filings_raw!inner(filer_name,primary_doc_url)",
    )
    .order("event_date", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as unknown as Array<Event13D & { filings_raw: { filer_name: string | null; primary_doc_url: string | null } }>).map((r) => ({
    filing_id: r.filing_id,
    cik: r.cik,
    issuer_name: r.issuer_name,
    ticker: r.ticker,
    form_subtype: r.form_subtype,
    percent_owned: r.percent_owned,
    event_date: r.event_date,
    filer_name: r.filings_raw?.filer_name ?? null,
    primary_doc_url: r.filings_raw?.primary_doc_url ?? null,
  }));
}

async function fetchInsiderBuys(): Promise<EventForm4[]> {
  const sb = supabaseServer();
  // Only purchases ('P') — insider buys are signal-bearing; sells are noisy.
  const { data, error } = await sb
    .from("events_form4")
    .select(
      "filing_id,reporter_cik,reporter_name,issuer_name,ticker,transaction_date,transaction_code,shares,price,filings_raw!inner(primary_doc_url)",
    )
    .eq("transaction_code", "P")
    .order("transaction_date", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as unknown as Array<EventForm4 & { filings_raw: { primary_doc_url: string | null } }>).map((r) => ({
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
  }));
}

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default async function EventsPage() {
  const [thirteenDs, insiderBuys] = await Promise.all([fetchEvents13D(), fetchInsiderBuys()]);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Activist stake disclosures (13D/G) and tracked-filer insider purchases (Form 4 code &quot;P&quot;).
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Issuer-side Form 4 (CEOs/CFOs buying their own stock) is a separate
          future ingester. Only Form 4s filed by our 28 tracked fund managers
          are surfaced here today.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          13D / 13G filings ({thirteenDs.length})
        </h2>
        {thirteenDs.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No 13D/G events parsed yet. Run <code className="text-neutral-300">python -m ingest.parse_13d</code>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Filed</th>
                  <th className="px-3 py-2 font-medium">Filer</th>
                  <th className="px-3 py-2 font-medium">Form</th>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium text-right">% Owned</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {thirteenDs.map((e) => (
                  <tr key={e.filing_id} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
                      <span title={e.event_date}>{daysAgo(e.event_date)}</span>
                    </td>
                    <td className="px-3 py-2 text-neutral-200">{e.filer_name ?? e.cik}</td>
                    <td className="px-3 py-2 text-neutral-300">{e.form_subtype}</td>
                    <td className="px-3 py-2 text-neutral-300">{e.issuer_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">
                      {e.percent_owned != null ? `${e.percent_owned.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {e.primary_doc_url ? (
                        <a href={e.primary_doc_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">sec.gov ↗</a>
                      ) : <span className="text-neutral-600">—</span>}
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
          Insider purchases — Form 4 code &apos;P&apos; ({insiderBuys.length})
        </h2>
        {insiderBuys.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No insider buys parsed yet. Run <code className="text-neutral-300">python -m ingest.parse_form4</code>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Reporter</th>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium text-right">Shares</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {insiderBuys.map((e, i) => (
                  <tr key={`${e.filing_id}-${i}`} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
                      <span title={e.transaction_date}>{daysAgo(e.transaction_date)}</span>
                    </td>
                    <td className="px-3 py-2 text-neutral-300">{e.reporter_name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-300">{e.issuer_name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-200 font-mono">{e.ticker ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">{fmtShares(e.shares)}</td>
                    <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">
                      {e.price != null ? `$${e.price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {e.primary_doc_url ? (
                        <a href={e.primary_doc_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">sec.gov ↗</a>
                      ) : <span className="text-neutral-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
