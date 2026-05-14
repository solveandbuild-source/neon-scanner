"use server";

import { supabaseServer } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a SKEPTICAL investment analyst doing due diligence.

Your job is NOT to confirm the buy signal. It is to surface every material
consideration honestly. Push back hard on assumptions. If the case is weak,
say so plainly.

RULES:
1. Do NOT hedge with phrases like "could go either way" or "depends". Make explicit calls. If uncertain, say WHY.
2. Do NOT confirm the buy signal just because smart money is in it. Smart money is wrong frequently.
3. Do NOT use generic investing platitudes. Every claim must be specific and testable.
4. If the signal LOOKS weak after your review, say "I would not buy this".
5. Cite the filer NAMES in your analysis.
6. If you don't know something material, say "I don't know X" — epistemic humility is required.

Output format: clean markdown, sections 1-6 in order.`;

type Sig = {
  ticker: string;
  score: number;
  num_sources: number;
  components: Record<string, { n?: number; score?: number; applied?: boolean; n_types?: number }>;
  contributing_filers: { new?: string[]; add?: string[]; velocity?: [string, number][]; activist?: string[]; insider_buyers?: string[] };
  return_1m: number | null;
  return_6m: number | null;
  return_ytd: number | null;
};

function buildUserPrompt(s: Sig, companyName: string | null, marketCap: number | null): string {
  const components = s.components || {};
  const cf = s.contributing_filers || {};
  const breakdown: string[] = [];
  for (const [key, label] of [["insider_cluster", "insider_cluster"], ["thirteenf_new", "13F_new"], ["thirteenf_add", "13F_add"], ["activist_13d", "activist_13D"], ["share_velocity", "share_velocity"], ["cross_q_confluence", "cross-quarter_confluence"]] as const) {
    const c = components[key];
    if (c && (c.n || 0) > 0) breakdown.push(`${label}=${c.n}`);
  }
  const filerLines: string[] = [];
  for (const n of (cf.new || []).slice(0, 5)) filerLines.push(`  • ${n}: NEW position in latest 13F`);
  for (const n of (cf.add || []).slice(0, 5)) filerLines.push(`  • ${n}: ADDED ≥20% share-count`);
  for (const [n, r] of (cf.velocity || []).slice(0, 5)) filerLines.push(`  • ${n}: share-count velocity ${r}x in latest quarter`);
  for (const n of (cf.activist || []).slice(0, 3)) filerLines.push(`  • ${n}: filed initial 13D (activist stake)`);
  const insiderLines = (cf.insider_buyers || []).slice(0, 5).map((n) => `  • ${n}: open-market buy`);
  const r6 = s.return_6m ?? 0;
  const priceStance = r6 > 30 ? `stock has run hard (+${r6}% over 6M)` : r6 < -10 ? `stock has lagged (${r6}% over 6M)` : `stock has chopped (≈${r6}% over 6M)`;

  return `# Subject: ${s.ticker} (${companyName || "Unknown"})
Market cap: $${((marketCap || 0) / 1e9).toFixed(1)}B

────────────────────────────────────────────────────────────────────
CONTEXT — SEC filing data
────────────────────────────────────────────────────────────────────

CURRENT SIGNAL STATE
- Confluence score: ${s.score} (BUY threshold: 4.0)
- Signal types firing: ${s.num_sources} of 7
- Multi-source bonus (★): ${(components.multi_source_bonus?.applied) ? "yes" : "no"}
- Breakdown: ${breakdown.join(", ") || "(none)"}

SMART-MONEY POSITIONING:
${filerLines.join("\n") || "  (none with material activity)"}

INSIDER OPEN-MARKET PURCHASES (last 30 days):
${insiderLines.join("\n") || "  (no insider buys in window)"}

PRICE CONTEXT
- 1M return: ${s.return_1m ?? "—"}    6M: ${s.return_6m ?? "—"}    YTD: ${s.return_ytd ?? "—"}
- Price stance: ${priceStance}

────────────────────────────────────────────────────────────────────
YOUR ANALYSIS — answer ALL six sections, in this exact order
────────────────────────────────────────────────────────────────────

## 1. Business in one paragraph
What does this company actually do? Primary revenue lines, customers, geography. No marketing language. If you don't know, say so.

## 2. The strongest bull case
The SINGLE best reason to buy at current price. Connect it to a SPECIFIC filer's known investing style. Identify ONE specific catalyst that would make this work in 6-12 months.

## 3. The strongest bear case
The SINGLE best reason NOT to buy. Look hard at valuation, competitive position, regulatory risk, execution risk, cyclicality. Identify ONE specific thing that could break the thesis. Be willing to say "the bear case is stronger" if it is.

## 4. Counterargument to the smart money
Why might the filers buying be WRONG? Mixed signals? Past misses? Value trap? Activist drama vs sale?

## 5. What you don't know
List 5 SPECIFIC, RESEARCHABLE items that would change conviction but aren't in the data above. Each item must be checkable via Google.

## 6. Honest conclusion
- Conviction: [LOW / MEDIUM / HIGH] — one-sentence why
- Time horizon: [3-6 mo / 1-2 yr / 3+ yr]
- Position sizing: [speculative <2% / normal 2-5% / conviction 5-10%]
- Three specific things to monitor monthly that would change your view`;
}

export async function runAnalysis(ticker: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseServer();
  const { data: sig } = await sb.from("signals_latest").select("*").eq("ticker", ticker).maybeSingle();
  if (!sig) return { ok: false, error: "No signal data for this ticker" };
  const { data: t } = await sb.from("tickers").select("name,market_cap_usd").eq("ticker", ticker).maybeSingle();
  const userPrompt = buildUserPrompt(sig as Sig, t?.name ?? null, t?.market_cap_usd ?? null);

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      temperature: 0.4,
      max_tokens: 3000,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, error: `Groq ${resp.status}: ${txt.slice(0, 200)}` };
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};
  await sb.from("signal_analyses").insert({
    ticker,
    analysis_md: content,
    input_context: sig,
    model: GROQ_MODEL,
    tokens_in: usage.prompt_tokens,
    tokens_out: usage.completion_tokens,
  });
  revalidatePath("/signals/analysis");
  return { ok: true };
}
