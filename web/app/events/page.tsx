import { supabaseServer } from "@/lib/supabase";
import { daysAgo } from "@/lib/format";
import { filerInfo, tier } from "@/lib/filers";
import { FORMS } from "@/lib/glossary";
import { FormTooltip } from "@/components/FormTooltip";
import Link from "next/link";

// Events: activist stake disclosures (13D/G) + insider purchases (Form 4 'P').
// With manager column, direction column (NEW/INCREASE/DECREASE/AMEND), and
// filer-priority row highlighting.

type Event13DRow = {
  filing_id: string;
  cik: string;
  issuer_cik: string | null;
  issuer_name: string | null;
  ticker: string | null;
  form_subtype: string;
  percent_owned: number | null;
  event_date: string;
  filer_name: string | null;
  primary_doc_url: string | null;
};

type Direction = "NEW" | "INCREASE" | "DECREASE" | "AMEND" | "—";

type Event13D = Event13DRow & {
  direction: Direction;
  prior_percent: number | null;
};

async function fetchAllEvents13D(): Promise<Event13D[]> {
  const sb = supabaseServer();
  const all: Event13DRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("events_13d")
      .select(
        "filing_id,cik,issuer_cik,issuer_name,ticker,form_subtype,percent_owned,event_date,filings_raw!inner(filer_name,primary_doc_url)",
      )
      .order("event_date", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Array<
      Event13DRow & { filings_raw: { filer_name: string | null; primary_doc_url: string | null } }
    >) {
      all.push({
        filing_id: r.filing_id,
        cik: r.cik,
        issuer_cik: r.issuer_cik,
        issuer_name: r.issuer_name,
        ticker: r.ticker,
        form_subtype: r.form_subtype,
        percent_owned: r.percent_owned,
        event_date: r.event_date,
        filer_name: r.filings_raw?.filer_name ?? null,
        primary_doc_url: r.filings_raw?.primary_doc_url ?? null,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return computeDirections(all);
}

/**
 * Add NEW/INCREASE/DECREASE/AMEND direction to each event by comparing to
 * the chronologically-previous event from the same filer × same issuer.
 *
 * Matching is by (filer_cik + issuer_cik) when issuer_cik is populated
 * (structured-XML era, post-Nov-2024). For older rows we fall back to
 * (filer_cik + normalized_issuer_name) — imperfect for noisy issuer names
 * but the best we can do without re-fetching.
 */
function computeDirections(events: Event13DRow[]): Event13D[] {
  // Build groups: key → array sorted descending by event_date
  function key(e: Event13DRow): string {
    if (e.issuer_cik) return `${e.cik}::cik::${e.issuer_cik}`;
    // Fallback: normalize first 30 chars of issuer name
    const n = (e.issuer_name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    return `${e.cik}::name::${n}`;
  }
  const groups = new Map<string, Event13DRow[]>();
  for (const e of events) {
    const k = key(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  // Each group is already in events order (we sorted by event_date desc).
  // For each event, find the next-older in its group.
  const out: Event13D[] = [];
  for (const e of events) {
    const grp = groups.get(key(e)) || [];
    // find index of this event in its group
    const idx = grp.findIndex((g) => g.filing_id === e.filing_id);
    const prior = idx >= 0 && idx + 1 < grp.length ? grp[idx + 1] : null;
    let direction: Direction = "—";
    let priorPct: number | null = null;
    if (!prior) {
      direction = "NEW";
    } else {
      priorPct = prior.percent_owned;
      const cur = e.percent_owned;
      if (cur != null && priorPct != null) {
        const diff = cur - priorPct;
        if (Math.abs(diff) < 0.05) direction = "AMEND";
        else if (diff > 0) direction = "INCREASE";
        else direction = "DECREASE";
      } else {
        direction = "AMEND";
      }
    }
    out.push({ ...e, direction, prior_percent: priorPct });
  }
  return out;
}

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

type Event8K = {
  accession_number: string;
  cik: string;
  filer_name: string | null;
  filed_at: string;
  items: string;  // comma-separated like "1.01,9.01"
  primary_doc_url: string | null;
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

async function fetch8Ks(): Promise<Event8K[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("filings_raw")
    .select("accession_number,cik,filer_name,filed_at,primary_doc_url,raw_payload")
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
  }));
}

async function fetchInsiderBuys(): Promise<EventForm4[]> {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("events_form4")
    .select(
      "filing_id,reporter_cik,reporter_name,issuer_name,ticker,transaction_date,transaction_code,shares,price,filings_raw!inner(primary_doc_url)",
    )
    .eq("transaction_code", "P")
    .order("transaction_date", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (
    data as unknown as Array<EventForm4 & { filings_raw: { primary_doc_url: string | null } }>
  ).map((r) => ({
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

// Tailwind class for the direction pill.
function directionClass(d: Direction): string {
  switch (d) {
    case "NEW":      return "bg-emerald-900/60 text-emerald-200";
    case "INCREASE": return "bg-emerald-900/40 text-emerald-300";
    case "DECREASE": return "bg-red-900/40 text-red-300";
    case "AMEND":    return "bg-neutral-800 text-neutral-400";
    default:         return "bg-neutral-800 text-neutral-500";
  }
}

// Left border tier color for activist / corp-strategic rows
function tierBorderClass(t: 0 | 1 | 2): string {
  if (t === 2) return "border-l-2 border-l-amber-500";
  if (t === 1) return "border-l-2 border-l-sky-500";
  return "border-l-2 border-l-transparent";
}

export default async function EventsPage() {
  const [allEvents, insiderBuys, eightKs] = await Promise.all([
    fetchAllEvents13D(),
    fetchInsiderBuys(),
    fetch8Ks(),
  ]);
  const recent13D = allEvents.slice(0, 60);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Activist stake disclosures (13D/G) and tracked-filer insider purchases (Form 4 code &quot;P&quot;).
          New here? Read the <Link href="/learn" className="text-blue-400 hover:underline">glossary</Link>.
        </p>
        <div className="mt-3 flex flex-col gap-1 text-xs text-neutral-500">
          <div>
            <span className="text-neutral-400 font-medium">Colored bar on left edge of row:</span>
            <span className="inline-block w-2 h-3 align-middle mx-2 bg-amber-500"></span>activist
            <span className="inline-block w-2 h-3 align-middle mx-2 bg-sky-500"></span>corporate strategic
            <span className="inline-block w-2 h-3 align-middle mx-2 bg-neutral-700"></span>value / growth / concentrated (baseline)
          </div>
          <div>
            <span className="text-neutral-400 font-medium">Direction column:</span> compares each filing&apos;s % ownership against the same filer&apos;s previous filing on the same company. NEW = no prior filing; AMEND = % unchanged.
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          13D / 13G filings ({recent13D.length})
        </h2>
        {recent13D.length === 0 ? (
          <p className="text-sm text-neutral-500">No 13D/G events parsed yet.</p>
        ) : (
          <div className="rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Filed</th>
                  <th className="px-3 py-2 font-medium">Filer</th>
                  <th className="px-3 py-2 font-medium">Form</th>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium text-right">% Owned</th>
                  <th className="px-3 py-2 font-medium">Direction</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {recent13D.map((e) => {
                  const info = filerInfo(e.cik);
                  const t = tier(e.cik);
                  return (
                    <tr key={e.filing_id} className={`hover:bg-neutral-900/50 ${tierBorderClass(t)}`}>
                      <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
                        <span title={e.event_date}>{daysAgo(e.event_date)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-neutral-200">{info?.entity ?? e.filer_name ?? e.cik}</div>
                        {info?.manager && (
                          <div className="text-xs text-neutral-500">
                            {info.manager} · {info.category}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">
                        <FormTooltip term={e.form_subtype} />
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{e.issuer_name ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-neutral-300 tabular-nums">
                        {e.percent_owned != null ? `${e.percent_owned.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${directionClass(e.direction)}`}>
                          {e.direction === "INCREASE" && e.prior_percent != null && e.percent_owned != null
                            ? `↑ +${(e.percent_owned - e.prior_percent).toFixed(1)}%`
                            : e.direction === "DECREASE" && e.prior_percent != null && e.percent_owned != null
                            ? `↓ ${(e.percent_owned - e.prior_percent).toFixed(1)}%`
                            : e.direction}
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

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          Insider purchases — Form 4 code &apos;P&apos; ({insiderBuys.length})
        </h2>
        {insiderBuys.length === 0 ? (
          <p className="text-sm text-neutral-500">No insider buys parsed yet.</p>
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

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          8-K material events ({eightKs.length})
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Companies must disclose any material event (M&amp;A, leadership changes, big contracts, strategic investments) within 4 business days via Form 8-K.
          Filtered to items 1.01, 2.01, 5.02, 8.01 (the high-signal item numbers).
          Rows where the filer is a corporate strategic investor (NVIDIA, Microsoft, etc.) get the sky-blue bar — those are most worth watching.
        </p>
        {eightKs.length === 0 ? (
          <p className="text-sm text-neutral-500">No 8-K filings ingested yet.</p>
        ) : (
          <div className="rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Filed</th>
                  <th className="px-3 py-2 font-medium">Filer</th>
                  <th className="px-3 py-2 font-medium">What happened (items)</th>
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
                      <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
                        <span title={e.filed_at.slice(0, 10)}>{daysAgo(e.filed_at)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-neutral-200">{info?.entity ?? e.filer_name ?? e.cik}</div>
                        {info?.manager && (
                          <div className="text-xs text-neutral-500">{info.manager} · {info.category}</div>
                        )}
                        {!info?.manager && info?.category && (
                          <div className="text-xs text-neutral-500">{info.category}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5">
                          {desc.labels.map((label, i) => (
                            <li key={i} className="text-xs text-neutral-300">
                              <span className={ITEM_PRIORITY.has(label.split(" ")[0]) ? "text-emerald-300" : "text-neutral-400"}>
                                {label}
                              </span>
                            </li>
                          ))}
                        </ul>
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
