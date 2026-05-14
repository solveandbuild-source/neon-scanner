import { supabaseServer } from "@/lib/supabase";
import { shortDate, daysAgo } from "@/lib/format";
import { FormTooltip } from "@/components/FormTooltip";

type Filing = {
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
      .select("accession_number,cik,filer_name,form_type,filed_at,period_of_report,primary_doc_url")
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

type FilerSummary = {
  cik: string;
  name: string;
  total: number;
  byForm: Record<string, number>;
  mostRecent: Filing;
};

function summarize(filings: Filing[]): FilerSummary[] {
  const byCik = new Map<string, FilerSummary>();
  for (const f of filings) {
    const existing = byCik.get(f.cik);
    if (existing) {
      existing.total += 1;
      existing.byForm[f.form_type] = (existing.byForm[f.form_type] ?? 0) + 1;
      // filings are pre-sorted desc by filed_at, so first one wins as mostRecent
    } else {
      byCik.set(f.cik, {
        cik: f.cik,
        name: f.filer_name ?? f.cik,
        total: 1,
        byForm: { [f.form_type]: 1 },
        mostRecent: f,
      });
    }
  }
  return Array.from(byCik.values()).sort((a, b) =>
    b.mostRecent.filed_at.localeCompare(a.mostRecent.filed_at),
  );
}

export default async function FilingsPage() {
  const filings = await fetchAllFilings();
  const filers = summarize(filings);
  const recent = filings.slice(0, 50);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Filings log</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {filings.length.toLocaleString()} filings ingested from {filers.length} tracked filers.
          Showing the most recent 50 below; per-filer summary at the bottom.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          This view shows <em>that</em> filings exist — not what stocks each is about.
          Parsing each filing into structured holdings is the next step.
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
                <th className="px-3 py-2 font-medium">Form</th>
                <th className="px-3 py-2 font-medium" title="Reporting period covered by the filing (e.g. transaction date for Form 4, quarter-end for 13F). NOT the filing date.">Period covered</th>
                <th className="px-3 py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {recent.map((f) => (
                <tr key={f.accession_number} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-300" title={`Filed on ${shortDate(f.filed_at)}`}>
                    <span className="text-neutral-100">{shortDate(f.filed_at)}</span>
                    <span className="text-neutral-500 text-xs ml-2">({daysAgo(f.filed_at)})</span>
                  </td>
                  <td className="px-3 py-2 text-neutral-200">{f.filer_name ?? f.cik}</td>
                  <td className="px-3 py-2 text-neutral-300">
                    <FormTooltip term={f.form_type} />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{f.period_of_report ?? "—"}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Per-filer summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filers.map((f) => (
            <div key={f.cik} className="rounded-md border border-neutral-800 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium text-neutral-100 truncate" title={f.name}>
                  {f.name}
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">{f.total}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
                {Object.entries(f.byForm)
                  .sort((a, b) => b[1] - a[1])
                  .map(([form, count]) => (
                    <span key={form}>
                      <span className="text-neutral-500">{form}</span>
                      <span className="ml-1 tabular-nums text-neutral-300">{count}</span>
                    </span>
                  ))}
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                Last filed {daysAgo(f.mostRecent.filed_at)} —{" "}
                <span className="text-neutral-400">{f.mostRecent.form_type}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
