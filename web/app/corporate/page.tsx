import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { daysAgo, shortDate } from "@/lib/format";
import { filerInfo, tier } from "@/lib/filers";

// Corporate events — 8-K material events (M&A, leadership changes, big contracts,
// strategic investments). Split out of the old Events page into its own tab.

type Event8K = {
  accession_number: string;
  cik: string;
  filer_name: string | null;
  filed_at: string;
  items: string;  // comma-separated like "1.01,9.01"
  primary_doc_url: string | null;
  summary: string | null;  // LLM-generated one-sentence headline
};

// 8-K item-number → plain-English label
const ITEM_LABELS: Record<string, string> = {
  "1.01": "Material agreement (M&A, partnership, etc.)",
  "1.02": "Termination of material agreement",
  "2.01": "Acquisition completed",
  "2.02": "Earnings results",
  "5.02": "Officer / director change (CEO, CFO, board)",
  "5.07": "Shareholder vote results",
  "7.01": "Reg FD disclosure",
  "8.01": "Other material event",
  "9.01": "Exhibits (supporting documents)",
};
const ITEM_PRIORITY = new Set(["1.01", "2.01", "5.02", "8.01"]);

function describeItems(itemsStr: string): { labels: string[]; priority: boolean } {
  const items = itemsStr.split(",").map((s) => s.trim()).filter(Boolean);
  let priority = false;
  const labels = items.map((i) => {
    if (ITEM_PRIORITY.has(i)) priority = true;
    return ITEM_LABELS[i] ? `${i} — ${ITEM_LABELS[i]}` : i;
  });
  return { labels, priority };
}

// Left border tier color for corporate-strategic rows (NVIDIA, Microsoft, etc.)
function tierBorderClass(t: 0 | 1 | 2): string {
  if (t === 2) return "border-l-2 border-l-amber-500";
  if (t === 1) return "border-l-2 border-l-sky-500";
  return "border-l-2 border-l-transparent";
}

async function fetch8Ks(): Promise<Event8K[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("filings_raw")
    .select("accession_number,cik,filer_name,filed_at,primary_doc_url,raw_payload,summary")
    .in("form_type", ["8-K", "8-K/A"])
    .order("filed_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as Array<Event8K & { raw_payload: { items?: string } }>).map((r) => ({
    accession_number: r.accession_number,
    cik: r.cik,
    filer_name: r.filer_name,
    filed_at: r.filed_at,
    items: r.raw_payload?.items ?? "",
    primary_doc_url: r.primary_doc_url,
    summary: r.summary ?? null,
  }));
}

export default async function CorporateEventsPage() {
  const eightKs = await fetch8Ks();

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Corporate events</h1>
        <p className="mt-2 text-sm text-neutral-400 max-w-3xl">
          8-K filings — the &ldquo;something happened&rdquo; disclosures a company must file within 4 business
          days: M&amp;A, leadership changes, big contracts, strategic investments. Filtered to the
          high-signal item numbers (1.01, 2.01, 5.02, 8.01). Rows from corporate-strategic filers
          (NVIDIA, Microsoft, …) get the sky-blue bar — those are most worth watching.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          8-K material events ({eightKs.length})
        </h2>
        {eightKs.length === 0 ? (
          <p className="text-sm text-neutral-500">No 8-K filings ingested yet.</p>
        ) : (
          <div className="rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Filed</th>
                  <th className="px-3 py-2 font-medium">Filer</th>
                  <th className="px-3 py-2 font-medium">What happened</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {eightKs.map((e) => {
                  const info = filerInfo(e.cik);
                  const t = tier(e.cik);
                  const desc = describeItems(e.items);
                  return (
                    <tr key={e.accession_number} className={`hover:bg-neutral-900/50 ${tierBorderClass(t)}`}>
                      <td className="px-3 py-2 text-neutral-300 whitespace-nowrap align-top">
                        <span className="block text-neutral-100 tabular-nums">{shortDate(e.filed_at)}</span>
                        <span className="block text-neutral-500 text-xs">{daysAgo(e.filed_at)}</span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-neutral-200">{info?.entity ?? e.filer_name ?? e.cik}</div>
                        {info?.manager && (
                          <div className="text-xs text-neutral-500">{info.manager} · {info.category}</div>
                        )}
                        {!info?.manager && info?.category && (
                          <div className="text-xs text-neutral-500">{info.category}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top max-w-xl">
                        {e.summary ? (
                          <div className="text-sm text-neutral-200">{e.summary}</div>
                        ) : (
                          <div className="text-sm text-neutral-500 italic">Summary pending — see items below.</div>
                        )}
                        <div className="mt-1 text-xs text-neutral-500">
                          Items: {desc.labels.map((label, i) => {
                            const code = label.split(" ")[0];
                            return (
                              <span key={i}>
                                {i > 0 && " · "}
                                <span className={ITEM_PRIORITY.has(code) ? "text-emerald-400/80" : ""} title={label}>{code}</span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
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
