import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Earnings: upcoming earnings dates for large-caps + tracked-filer holdings,
// soonest first, with trailing 1w / 1m return context. Sorted by DATE, not
// return — a calendar, not a momentum leaderboard (CLAUDE.md §2.2).

type Row = {
  ticker: string;
  name: string | null;
  next_earnings: string | null;
  return_1w: number | null;
  return_1m: number | null;
  in_smart_money: boolean;
};

async function fetchRows(): Promise<Row[]> {
  const sb = supabaseServer();
  const out: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("earnings_calendar")
      .select("ticker,name,next_earnings,return_1w,return_1m,in_smart_money")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function Pct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-neutral-600">—</span>;
  const cls = v >= 0 ? "text-emerald-300" : "text-rose-300";
  return (
    <span className={`tabular-nums ${cls}`}>
      {v >= 0 ? "+" : ""}
      {(v * 100).toFixed(1)}%
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(iso: string): string {
  const d = Math.ceil((new Date(iso + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 14) return `in ${d}d`;
  return `in ${Math.round(d / 7)}w`;
}

export default async function EarningsPage() {
  const rows = await fetchRows();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((r) => r.next_earnings && r.next_earnings >= today)
    .sort((a, b) => a.next_earnings!.localeCompare(b.next_earnings!));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
        <p className="mt-2 text-sm text-neutral-400 max-w-3xl">
          Upcoming earnings dates for large-caps (&gt; $10B) and every stock your tracked filers
          hold, soonest first. The 1-week / 1-month columns are trailing return context —
          the list is sorted by date, not performance. <span className="text-amber-300/80">SM</span> =
          held by a tracked filer.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Dates are Yahoo&rsquo;s estimates and can shift a day or two until confirmed.{" "}
          <span className="text-neutral-400">{upcoming.length}</span> upcoming.
        </p>
      </header>

      {upcoming.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No earnings loaded yet — the ingester is still populating. Refresh in a few minutes.
        </p>
      ) : (
        <div className="rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Next earnings</th>
                <th className="px-3 py-2 font-medium text-right">1W return</th>
                <th className="px-3 py-2 font-medium text-right">1M return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {upcoming.map((r) => (
                <tr key={r.ticker} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 align-top">
                    <span className="font-mono text-neutral-100">{r.ticker}</span>
                    {r.in_smart_money && (
                      <span
                        className="ml-2 text-[10px] uppercase tracking-wide text-amber-300/80"
                        title="Held by a tracked filer"
                      >
                        SM
                      </span>
                    )}
                    {r.name && (
                      <div className="text-xs text-neutral-500 truncate max-w-xs">{r.name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap align-top">
                    <span className="text-neutral-100 tabular-nums">{fmtDate(r.next_earnings!)}</span>
                    <span className="text-neutral-500 text-xs ml-2">{daysUntil(r.next_earnings!)}</span>
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <Pct v={r.return_1w} />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <Pct v={r.return_1m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
