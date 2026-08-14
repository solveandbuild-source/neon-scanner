import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";
import { RunAnalysisButton } from "@/components/RunAnalysisButton";

type Analysis = {
  id: string;
  ticker: string;
  analyzed_at: string;
  analysis_md: string;
  model: string;
  tokens_out: number | null;
};

async function getWatchlistTickers(): Promise<{ ticker: string; company_name: string | null }[]> {
  const sb = supabaseServer();
  const { data: wl } = await sb.from("watchlist").select("ticker").order("added_at", { ascending: false });
  if (!wl || wl.length === 0) return [];
  const tickers = wl.map((r: { ticker: string }) => r.ticker);
  const { data: ts } = await sb.from("tickers").select("ticker,name").in("ticker", tickers);
  const nameMap = new Map<string, string>((ts ?? []).map((r: { ticker: string; name: string }) => [r.ticker, r.name]));
  return tickers.map((t) => ({ ticker: t, company_name: nameMap.get(t) ?? null }));
}

async function getLatestAnalysis(ticker: string): Promise<Analysis | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("signal_analyses")
    .select("id,ticker,analyzed_at,analysis_md,model,tokens_out")
    .eq("ticker", ticker)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Analysis) ?? null;
}

// Tiny markdown renderer (just enough — headers, bold, lists, paragraphs)
function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // headers
  html = html
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold tracking-tight text-neutral-100 mt-6 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-semibold tracking-tight text-neutral-100 mt-6 mb-3">$1</h1>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-neutral-100">$1</strong>');
  // bullets
  html = html.replace(/^[-*•] (.+)$/gm, '<li class="ml-5 list-disc text-neutral-300 my-0.5">$1</li>');
  // paragraphs: wrap remaining lines
  html = html
    .split("\n\n")
    .map((para) => {
      if (para.startsWith("<h") || para.startsWith("<li")) return para;
      return `<p class="text-neutral-300 my-2 leading-relaxed">${para.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
  return html;
}

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  const sp = await searchParams;
  const watchlist = await getWatchlistTickers();
  const selectedTicker = sp.ticker ?? watchlist[0]?.ticker ?? null;
  const analysis = selectedTicker ? await getLatestAnalysis(selectedTicker) : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link href="/signals" className="text-sm text-neutral-400 hover:text-neutral-200">← back to signals</Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Deep Analysis</h1>
        <p className="text-sm text-neutral-400">
          Skeptical due-diligence analysis on watchlisted tickers. Uses Llama 3.3 70B
          via Groq. The prompt is designed to push back on the buy signal, not
          confirm it — so a &ldquo;weak case&rdquo; output is the most valuable signal.
        </p>
      </header>

      {watchlist.length === 0 ? (
        <div className="rounded-md border border-neutral-800 p-6 text-center text-sm text-neutral-500">
          No watchlist items yet. Go to <Link href="/signals" className="text-emerald-400 hover:underline">/signals</Link>
          {" "}and click the <code className="text-neutral-300 bg-neutral-900 px-1 rounded">+</code> on any row to add it here.
        </div>
      ) : (
        <>
          {/* Selector */}
          <form method="get" className="flex items-center gap-3 text-sm flex-wrap">
            <label htmlFor="ticker" className="text-neutral-400">Watchlist:</label>
            <select
              id="ticker"
              name="ticker"
              defaultValue={selectedTicker ?? ""}
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-100 focus:outline-none focus:border-emerald-600 min-w-[280px]"
            >
              {watchlist.map((w) => (
                <option key={w.ticker} value={w.ticker}>
                  {w.ticker} — {w.company_name ?? "(unknown)"}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3 py-1 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 hover:bg-neutral-700"
            >
              Load
            </button>
            {selectedTicker && <RunAnalysisButton ticker={selectedTicker} label={analysis ? "Re-run analysis" : "Run analysis"} />}
          </form>

          {/* Analysis output */}
          {analysis ? (
            <article className="rounded-md border border-neutral-800 p-6 bg-neutral-950/50">
              <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-neutral-900">
                <div>
                  <h2 className="text-lg font-mono text-neutral-100">{analysis.ticker}</h2>
                  <p className="text-xs text-neutral-500 mt-1">
                    Analyzed {new Date(analysis.analyzed_at).toLocaleString()} · {analysis.model} · {analysis.tokens_out ?? "?"} tokens
                  </p>
                </div>
              </div>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis.analysis_md) }} />
            </article>
          ) : selectedTicker ? (
            <div className="rounded-md border border-neutral-800 p-6 text-center text-sm text-neutral-400">
              No analysis yet for <span className="font-mono">{selectedTicker}</span>. Click &ldquo;Run analysis&rdquo; above (takes ~5-10 sec).
            </div>
          ) : null}
        </>
      )}

      <footer className="text-xs text-neutral-500 pt-4 border-t border-neutral-900">
        Analysis output is LLM-generated from SEC filings data we have on the ticker.
        It is NOT investment advice. Verify every claim independently. Per §2.4, the underlying
        signal score components are visible on the /signals page for any pick.
      </footer>
    </div>
  );
}
