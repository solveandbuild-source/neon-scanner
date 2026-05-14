"use server";

import { supabaseServer } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a SKEPTICAL investment analyst doing due diligence on a public US stock.

USE YOUR FULL KNOWLEDGE of the company. You should know what most public US
companies do, their business model, competitive position, recent news, sector
context. Apply that knowledge actively. The SEC filing data in the user message
is ADDITIONAL CONTEXT showing who's buying/selling — it is NOT the only thing
you know about the company.

Your job is NOT to confirm the buy signal. It is to surface every material
consideration honestly. Push back hard on assumptions. If the case is weak,
say so plainly.

RULES:
1. Use your training-data knowledge of the company actively. Describe what
   they actually do, who their customers are, their key products/segments,
   their competitive position. Don't say "I don't know what they do" unless
   the company is genuinely obscure (most aren't).
2. Do NOT hedge with phrases like "could go either way" or "depends". Make
   explicit calls. If uncertain, say WHY specifically.
3. Do NOT confirm the buy signal just because smart money is in it. Smart
   money is wrong frequently. If you know a specific case where one of these
   filers was wrong on a similar bet, cite it.
4. If the signal LOOKS weak after your review, say "I would not buy this" —
   that's the most valuable output.
5. Cite the filer NAMES in your analysis (not just "smart money").
6. Use specific numbers when you can — revenue scale, margin ranges, market
   share, customer concentration. Mark them as approximate ("roughly", "~")
   when sourced from training-data memory.
7. If you GENUINELY don't know something material, say "I don't know X" —
   but only when it's actually unknown to you, not as a hedge.

Output format: clean markdown, sections 1-6 in order. Be opinionated.`;

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

  return `# Subject: ${s.ticker} — ${companyName || "Unknown"}
Market cap: $${((marketCap || 0) / 1e9).toFixed(1)}B

You should already know this company from your training data. ${companyName ? `Apply your knowledge of ${companyName} actively.` : ""} The data below is ADDITIONAL context about who's buying it.

────────────────────────────────────────────────────────────────────
ADDITIONAL CONTEXT — SEC filings, who's buying
────────────────────────────────────────────────────────────────────

SIGNAL STATE
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
What does ${companyName || "this company"} ACTUALLY do? Use your knowledge.
Primary revenue lines/segments (with rough % split if you know it),
key customers or customer types, geography, who their main competitors are.
Be specific. No marketing speak. If you genuinely don't know the company,
say so — but you should know most listed US companies.

## 2. The strongest bull case
The SINGLE best reason to buy at current price. Tie it to:
  - What this specific business actually does well
  - What's changing in their industry right now
  - Why one of the SPECIFIC filers in the data above (named — e.g. Druckenmiller
    is macro-themed; Ackman does operational activism on consumer brands;
    Aschenbrenner is AI infrastructure focused) might see this as a fit for
    their thesis pattern.
ONE specific catalyst that would make this work in 6-12 months.

## 3. The strongest bear case
The SINGLE best reason NOT to buy. Be specific. Use your knowledge:
  - What's the rough revenue multiple or P/E? Is growth supporting it?
  - Who are the threats (specific competitors, new entrants, substitutes)?
  - Regulatory or macro risk (cite the specific risk)
  - Recent execution issues you remember (guidance cuts, key departures, missed quarters)
  - Where in the cycle? (early/mid/late)
ONE specific thing that could break the thesis. If the bear case is
stronger than the bull case, say so plainly.

## 4. Counterargument to the smart money
Why might the named filers be wrong? Be specific:
  - Are filers TRIMMING while others add (use the data above)?
  - Have these filers had specific past failures on similar bets? (Cite
    actual examples from your knowledge — e.g. "Druckenmiller's 2024 NVDA
    sell was poor timing".)
  - Is this likely a value trap (same filers stuck for years)?
  - For activists: is the position likely to result in a sale, or years
    of operational fights with no clear catalyst?

## 5. What you don't know
List 5 SPECIFIC items that would change conviction one way or the other.
Each must be: (a) actually unknown to you, and (b) findable via a 30-second
Google search. Examples:
  - "Q4 2025 earnings call comments on segment X margins"
  - "Current short interest %"
  - "Recent FDA / regulatory filing status for product Y"
  - "Whether [activist filer] has board representation"
NO generic items like "future market conditions".

## 6. Honest conclusion
- Conviction: [LOW / MEDIUM / HIGH] — one specific sentence why
- Time horizon: [3-6 mo / 1-2 yr / 3+ yr]
- Position sizing: [speculative <2% / normal 2-5% / conviction 5-10%]
- Three specific monitoring items that would change your view monthly`;
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
      temperature: 0.7,
      max_tokens: 3500,
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
