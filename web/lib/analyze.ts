"use server";

import { supabaseServer } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a hedge-fund-quality investment analyst trained in the Buffett/Munger/Greenblatt tradition. You analyze businesses STRUCTURALLY — not as stock-price stories but as economic systems with moats, bottlenecks, and competitive positioning.

USE YOUR FULL KNOWLEDGE of the company AND its industry. The SEC filing data in the user message is ADDITIONAL context about who's buying — it is NOT a substitute for understanding the business.

CORE FRAMEWORK — every analysis answers these structural questions:

1. **WHERE IS THE BOTTLENECK?** Every industry has a constrained step in its value chain. Identify it. Examples: ASML owns EUV lithography (semiconductor monopoly bottleneck). Visa/Mastercard own payment rails (duopoly). Moody's/S&P own credit ratings (duopoly).  Is THIS company sitting on a bottleneck? If yes, what kind, how durable?

2. **WHAT IS THE MOAT?** Be specific about the TYPE:
   - Network effects (each new user makes the product more valuable for existing users)
   - Switching costs (customer pain to leave: integrations, retraining, contracts)
   - Scale economies (cost-per-unit drops with size in a way competitors can't match)
   - Regulatory capture (govt protection, licenses, exclusivity)
   - Brand premium (customers pay more for the name itself)
   - IP/patents (legal exclusivity)
   - Distribution monopoly (who else can deliver this at scale?)
   Name the moat type. State the evidence. Estimate durability in years.

3. **WHAT IS THE INDUSTRY STRUCTURE?**
   - Monopoly (>70% share, no real competitor)
   - Duopoly (2 players, ~80%+ combined)
   - Oligopoly (3-5 players, rational competition)
   - Fragmented (many players, price competition)
   - Disrupting (incumbent + insurgent)
   Where is the company in this structure? Are they THE leader, a strong #2, a challenger, or marginal?

4. **PRICING POWER TEST** — can they raise prices 10% without losing >5% of customers?
   - If yes: real moat
   - If no: commodity business regardless of revenue size
   Evidence: gross margins (>50% typically indicates pricing power, <30% indicates commodity).

5. **COMPARABLE INFLECTIONS** — what historical company/situation is this most like?
   Examples: "This is Visa in 2008 — duopoly + secular tailwind", "This is Sears in 2008 — fading retailer with real estate option", "This is Nvidia in 2015 — compute monopoly before the demand explosion was visible". Use a SPECIFIC analogy.

6. **CAPITAL ALLOCATION RECORD** — what does management do with FCF? Buybacks at high P/E (value-destructive), buybacks at low P/E (good), M&A track record (specific deals), dividend discipline. Be specific.

RULES:
- Be opinionated. Make explicit calls. NO hedging.
- If you don't know enough to land an opinion, say WHY specifically.
- Cite filer NAMES from the data. Connect their style to your thesis (e.g. "Ackman's playbook is operational activism on consumer franchises — that fits because X").
- Cite specific past wins AND failures of these filers when relevant.
- The most valuable output is "this looks like X — I would not buy" — say it when true.
- Use specific numbers. Revenue scale, margin range, market share, multiple. Mark as approximate ("roughly", "~") if from memory.
- End with a position-size call backed by the moat duration + price.`;

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

You should know ${companyName || "this company"} from training. Apply that knowledge AND the framework from your system instructions (bottleneck / moat / industry structure / pricing power / historical analog / capital allocation).

────────────────────────────────────────────────────────────────────
SMART-MONEY CONTEXT — SEC filings, who's buying right now
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
YOUR ANALYSIS — 8 sections, structural rigor in every one
────────────────────────────────────────────────────────────────────

## 1. Business deconstruction
What does ${companyName || "this company"} ACTUALLY make money on?
- Revenue by segment (rough % split if you can recall)
- Who pays them (consumer / SMB / enterprise / government)
- Geography
- Customer concentration (top 10 customers as % of revenue, if known)
- Unit economics (gross margin range, contribution margin, customer LTV vs CAC)

## 2. Industry structure & bottleneck
- Industry shape: Monopoly / Duopoly / Oligopoly / Fragmented / Disrupting
- Where does ${companyName || "the company"} sit in the value chain?
- Who owns the BOTTLENECK in this industry (i.e. the step everyone has to
  pass through — examples: ASML for EUV, TSMC for leading-edge chips,
  Visa/MA for card rails, GOOGL for ad auction, Live Nation for venues+ticketing)
- Is this company the bottleneck owner? Or upstream/downstream of it?
- If they're the bottleneck: how durable is the bottleneck position?
- Name top 3 specific competitors and their relative position.

## 3. Moat analysis
- Moat TYPE (pick from: network effects, switching costs, scale economies,
  regulatory, brand, IP, distribution — be specific, no "good company" handwave)
- Evidence that this moat actually exists (e.g. "gross margin 65%, peer avg
  35%" or "70% of revenue is multi-year recurring contracts")
- Moat durability — 3 years? 10 years? Justify
- What is ERODING the moat (technology shift, new entrant, regulatory threat)
- If no real moat: say "no durable moat" — that's a valid finding

## 4. Pricing power
- Can they raise prices 10% without losing >5% of customers? Yes/No/Mixed.
- Gross margin trend over last 3 years (your best memory)
- Are they a price-maker or price-taker?
- Recent evidence of pricing actions and customer reaction

## 5. Historical analog
What past company or situation is this MOST like? Be specific with the
analog, the year, and what happened. Examples:
- "This is Visa in 2008: duopoly bottleneck + secular tailwind. Worked out."
- "This is Sears in 2008: declining retail with real-estate option. Mostly failed."
- "This is Salesforce in 2014: re-rating from category leader status. Worked."
Pick ONE specific analog and explain the pattern match.

## 6. Smart-money read — connect filers to the thesis
For EACH named filer in the data above, in one line:
- What is their typical playbook?
- Does THIS thesis fit their pattern?
- Is one of them likely "right" while another is "wrong"?
Example: "Ackman's playbook = operational activism on consumer franchises.
Fits well here because [specific reason]. Druckenmiller's playbook = macro
themes. Adding to this position likely signals he sees [specific macro tie]."
Cite specific past wins/misses where relevant.

## 7. Bear case — strongest single risk
The ONE thing most likely to break the thesis. Be specific. Examples:
- "Customer concentration: 40% of revenue from one customer who is building
  in-house alternative"
- "Regulatory: DOJ Section 2 investigation expected H1 2027"
- "Cyclicality: business is mid-late cycle in housing-correlated end market"
If the bear case is stronger than the bull case, SAY SO and recommend pass.

## 8. Position thesis
- One sentence: WHAT YOU'RE BUYING (e.g. "Quasi-monopoly bottleneck in
  payment rails, taking 0.2% rake on global commerce, growing 12% annually
  with 70% margins. 8-year visibility. Pay <25x earnings.")
- Position size: 2-5% / 5-8% / 8-12% with REASONING (size to the durability
  of the moat, not to the upside)
- Time horizon: holding period to thesis play-out (1-2 yr / 3-5 yr / 5+ yr)
- 3 monthly KPIs you'd track to know if the thesis is on or off
- One LINE summary at the end: "Buy with [X]% sizing because [single
  structural reason]" OR "Pass because [single structural reason]"`;
}

export async function runAnalysis(ticker: string): Promise<{ ok: boolean; error?: string }> {
  // TEMP DEBUG — surface env var state in the error path
  const keyRaw = process.env.GROQ_API_KEY ?? "";
  const keyTrimmed = keyRaw.trim().replace(/^["']|["']$/g, "");
  const debugSuffix = ` [dbg len=${keyRaw.length} trimLen=${keyTrimmed.length} startsGsk=${keyTrimmed.startsWith("gsk_")}]`;

  const sb = supabaseServer();
  const { data: sig } = await sb.from("signals_latest").select("*").eq("ticker", ticker).maybeSingle();
  if (!sig) return { ok: false, error: "No signal data for this ticker" };
  const { data: t } = await sb.from("tickers").select("name,market_cap_usd").eq("ticker", ticker).maybeSingle();
  const userPrompt = buildUserPrompt(sig as Sig, t?.name ?? null, t?.market_cap_usd ?? null);

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${keyTrimmed}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      temperature: 0.6,
      max_tokens: 5000,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, error: `Groq ${resp.status}: ${txt.slice(0, 200)}${debugSuffix}` };
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
