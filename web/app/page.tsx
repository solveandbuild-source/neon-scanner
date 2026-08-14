import { supabaseServer } from "@/lib/supabase";
import { shortDate, daysAgo } from "@/lib/format";
import { FormTooltip } from "@/components/FormTooltip";
import { FORMS } from "@/lib/glossary";
import Link from "next/link";

// Re-fetch from Supabase at most every 30 min (ISR) instead of freezing the
// data at build time. The ingest cron only updates once/day, so 30-min
// freshness is ample and avoids re-pulling ~8K filing rows on every request.
// Without this, the Filings landing page is statically rendered once at build
// time and freezes its data + its "(yesterday)" relative dates at the last deploy.
export const revalidate = 1800;

type Filing = {
  id: string;
  accession_number: string;
  cik: string;
  filer_name: string | null;
  form_type: string;
  filed_at: string;
  period_of_report: string | null;
  primary_doc_url: string | null;
};

// Pull every row of the trimmed metadata (no raw_payload). 9k rows is fine
// server-side; the network cost is the bottleneck, not memory.
async function fetchAllFilings(): Promise<Filing[]> {
  const sb = supabaseServer();
  const out: Filing[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("filings_raw")
      .select("id,accession_number,cik,filer_name,form_type,filed_at,period_of_report,primary_doc_url")
      .order("filed_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as Filing[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

// ── Enrichment: target company + insider buy/sell for the visible rows ──────
// filings_raw is metadata only; the issuer and insider direction live in the
// parsed tables (events_13d, events_form4), keyed by filing_id → filings_raw.id.
// We enrich only the ~50 shown rows, so this is two small `.in()` lookups.
type Enrichment = { company: string | null; ticker: string | null; f4dir: "BUY" | "SELL" | "MIXED" | null };

async function enrichRecent(recent: Filing[]): Promise<Map<string, Enrichment>> {
  const sb = supabaseServer();
  const ids = recent.map((f) => f.id).filter(Boolean);
  const map = new Map<string, Enrichment>();
  if (ids.length === 0) return map;

  // 13D / 13G → issuer company
  const { data: e13 } = await sb
    .from("events_13d")
    .select("filing_id,issuer_name,ticker")
    .in("filing_id", ids);
  for (const r of (e13 ?? []) as { filing_id: string; issuer_name: string | null; ticker: string | null }[]) {
    if (!map.has(r.filing_id)) map.set(r.filing_id, { company: r.issuer_name, ticker: r.ticker, f4dir: null });
  }

  // Form 4 → issuer company + buy/sell (a filing can carry several txn rows)
  const { data: e4 } = await sb
    .from("events_form4")
    .select("filing_id,issuer_name,ticker,transaction_code")
    .in("filing_id", ids);
  const byFiling = new Map<string, { name: string | null; ticker: string | null; codes: Set<string> }>();
  for (const r of (e4 ?? []) as {
    filing_id: string; issuer_name: string | null; ticker: string | null; transaction_code: string | null;
  }[]) {
    const cur = byFiling.get(r.filing_id) ?? { name: null, ticker: null, codes: new Set<string>() };
    cur.name ??= r.issuer_name;
    cur.ticker ??= r.ticker;
    if (r.transaction_code) cur.codes.add(r.transaction_code);
    byFiling.set(r.filing_id, cur);
  }
  for (const [fid, v] of byFiling) {
    const p = v.codes.has("P");
    const s = v.codes.has("S");
    map.set(fid, { company: v.name, ticker: v.ticker, f4dir: p && s ? "MIXED" : p ? "BUY" : s ? "SELL" : null });
  }
  return map;
}

// Plain-English meaning + a tone for color. Buys are green, sells red — the only
// two "highlight if it's a buy/sell" cases. Everything else states what the form
// *is* (activist / passive / portfolio / corporate event). §2.1: observable fact
// from the filing, not interpretation.
type Tone = "buy" | "sell" | "mixed" | "activist" | "passive" | "portfolio" | "event" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  buy: "text-emerald-300 bg-emerald-950/60 border border-emerald-800/60",
  sell: "text-rose-300 bg-rose-950/60 border border-rose-800/60",
  mixed: "text-amber-300 bg-amber-950/50 border border-amber-800/50",
  activist: "text-amber-300 bg-amber-950/40 border border-amber-800/40",
  passive: "text-neutral-300 bg-neutral-800/60 border border-neutral-700",
  portfolio: "text-sky-300 bg-sky-950/40 border border-sky-800/40",
  event: "text-blue-300 bg-blue-950/40 border border-blue-800/40",
  neutral: "text-neutral-400 bg-neutral-800/40 border border-neutral-700/60",
};

function classify(formType: string, f4dir: Enrichment["f4dir"]): { label: string; tone: Tone } {
  const t = formType.toUpperCase();
  const amend = t.includes("/A");
  if (t.startsWith("4")) {
    if (f4dir === "BUY") return { label: "Insider buy", tone: "buy" };
    if (f4dir === "SELL") return { label: "Insider sell", tone: "sell" };
    if (f4dir === "MIXED") return { label: "Insider buy + sell", tone: "mixed" };
    return { label: "Insider trade", tone: "neutral" };
  }
  if (t.includes("13D")) return { label: amend ? "Activist stake — updated" : "Activist stake", tone: "activist" };
  if (t.includes("13G")) return { label: amend ? "Passive 5%+ — updated" : "Passive 5%+ stake", tone: "passive" };
  if (t.includes("13F")) return { label: amend ? "Portfolio — amended" : "Quarterly portfolio", tone: "portfolio" };
  if (t.startsWith("8-K")) return { label: "Corporate event", tone: "event" };
  return { label: formType, tone: "neutral" };
}

// Small badge used in the definitions legend, styled identically to the Signal column.
function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 ${TONE_CLASS[tone]}`}>{children}</span>;
}

export default async function FilingsPage() {
  const filings = await fetchAllFilings();
  const filerCount = new Set(filings.map((f) => f.cik)).size;
  const recent = filings.slice(0, 50);
  const enrich = await enrichRecent(recent);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Filings log</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {filings.length.toLocaleString()} filings ingested from {filerCount} tracked filers.
          Showing the most recent 50 below.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Each row shows the <em>target company</em> and what the filing means —
          insider buys are green, sells red. 13F rows are whole portfolios (no single
          company), shown as &ldquo;Quarterly portfolio&rdquo;; open Holdings for the positions.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">
              What each &ldquo;Signal&rdquo; means
            </div>
            <ul className="space-y-1.5 text-neutral-300">
              <li><Chip tone="buy">Insider buy</Chip> — an officer or director bought their own company&rsquo;s stock</li>
              <li><Chip tone="sell">Insider sell</Chip> — an insider sold shares</li>
              <li><Chip tone="activist">Activist stake</Chip> — a 5%+ stake taken to push for change (13D)</li>
              <li><Chip tone="passive">Passive 5%+ stake</Chip> — a big stake held passively, no activist intent (13G)</li>
              <li><Chip tone="portfolio">Quarterly portfolio</Chip> — a fund&rsquo;s full holdings snapshot (13F); open Holdings for positions</li>
              <li><Chip tone="event">Corporate event</Chip> — a company&rsquo;s own material announcement (8-K)</li>
            </ul>
          </div>
          <div className="rounded-md border border-neutral-800 p-3">
            <div className="text-neutral-400 font-medium uppercase tracking-wide mb-2">Forms</div>
            <ul className="space-y-1 text-neutral-300">
              <li><span className="font-mono text-neutral-100">13F</span> — {FORMS["13F-HR"].short}</li>
              <li><span className="font-mono text-neutral-100">13D</span> — {FORMS["SC 13D"].short}</li>
              <li><span className="font-mono text-neutral-100">13G</span> — {FORMS["SC 13G"].short}</li>
              <li><span className="font-mono text-neutral-100">Form 4</span> — {FORMS["4"].short}</li>
              <li><span className="font-mono text-neutral-100">8-K</span> — {FORMS["8-K"].short}</li>
              <li><span className="font-mono text-neutral-400">…/A</span> — an amendment (update) to a prior filing</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Hover any form code (e.g. <span className="underline decoration-dotted">13G/A</span>) for a definition.{" "}
          <Link href="/learn" className="text-blue-400 hover:underline">Full glossary →</Link>
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Most recent activity
        </h2>
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium" title="Date the filing was submitted to SEC">Filed</th>
                <th className="px-3 py-2 font-medium">Filer</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Form</th>
                <th className="px-3 py-2 font-medium" title="What the filing means. Insider buys are green, sells red.">Signal</th>
                <th className="px-3 py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {recent.map((f) => {
                const e = enrich.get(f.id);
                const sig = classify(f.form_type, e?.f4dir ?? null);
                const isCorpEvent = f.form_type.toUpperCase().startsWith("8-K");
                const company = e?.company ?? (isCorpEvent ? f.filer_name : null);
                const ticker = e?.ticker ?? null;
                return (
                <tr key={f.accession_number} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-300" title={`Filed on ${shortDate(f.filed_at)}`}>
                    <span className="text-neutral-100">{shortDate(f.filed_at)}</span>
                    <span className="text-neutral-500 text-xs ml-2">({daysAgo(f.filed_at)})</span>
                  </td>
                  <td className="px-3 py-2 text-neutral-200">{f.filer_name ?? f.cik}</td>
                  <td className="px-3 py-2">
                    {company ? (
                      <span className="text-neutral-100">
                        {company}
                        {ticker ? <span className="text-neutral-500 text-xs ml-1">{ticker}</span> : null}
                      </span>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">
                    <FormTooltip term={f.form_type} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs whitespace-nowrap ${TONE_CLASS[sig.tone]}`}>
                      {sig.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {f.primary_doc_url ? (
                      <a
                        href={f.primary_doc_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        sec.gov ↗
                      </a>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
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
