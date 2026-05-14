// CIK → tracked-filer metadata. Sourced from config/tracked_filers.yml.
// When that YAML is edited, also update this map (small list, stable; not worth
// runtime-loading the YAML in a Next.js server component yet).
//
// Categories:
//   activist             — 13D-filers who push for change; highest signal
//   value, concentrated  — long-horizon equity managers
//   growth               — growth/tech books (Tiger cubs)
//   corporate_strategic  — public companies; signal is in 8-K + 13D, not 13F
//
// Multiplier matches signal_weights.yml. activists 2.0, corp strategic 1.5,
// everyone else 1.0. This drives row priority highlighting in tables.

export type FilerCategory =
  | "value"
  | "concentrated"
  | "growth"
  | "activist"
  | "macro"
  | "corporate_strategic";

// Signal-class describes WHAT kind of picks the filer makes, distinct from
// category. 'thesis_driven' = each position is a human-decided bet (Buffett,
// Ackman, etc.). 'algorithmic_basket' = positions chosen by quant models
// (RenTech, stat-arb funds). We exclude algorithmic_basket from our list
// because individual position changes don't carry "smart-money read X" signal.
export type SignalClass = "thesis_driven" | "algorithmic_basket";

export type FilerInfo = {
  cik: string;
  entity: string;       // company-name entity
  manager: string | null;
  category: FilerCategory;
  multiplier: number;

  // coverage_pct: rough estimate of what fraction of this filer's TOTAL book
  // their 13F captures. US-listed equity-only funds: ~95%. Macro / credit /
  // FX-heavy funds: much less. Used to weight signals downstream so we don't
  // over-react to a small slice of someone's book.
  coverage_pct: number;  // 0..1
  signal_class: SignalClass;
  bio?: string;
  publishes_letters?: boolean;  // optional UX hint; not a gate
};

const FILERS_LIST: FilerInfo[] = [
  // ─── value / generalists ────────────────────────────────────────────────
  { cik: "0001067983", entity: "Berkshire Hathaway",         manager: "Buffett",        category: "value", multiplier: 1.0, coverage_pct: 0.90, signal_class: "thesis_driven", publishes_letters: true, bio: "Warren Buffett. 60+ years of compounding. Concentrated equity book, $300B+ AUM. Apple is the biggest position. The benchmark." },
  { cik: "0001536411", entity: "Duquesne Family Office",     manager: "Druckenmiller",  category: "value", multiplier: 1.0, coverage_pct: 0.30, signal_class: "thesis_driven", publishes_letters: false, bio: "Stanley Druckenmiller. ~30% annualized over 30 years, no down years. Famously broke the Bank of England in '92. Macro-driven — 13F shows only the US-equity slice (~30% of book)." },
  { cik: "0001061768", entity: "Baupost Group",              manager: "Klarman",        category: "value", multiplier: 1.0, coverage_pct: 0.40, signal_class: "thesis_driven", publishes_letters: false, bio: "Seth Klarman. Deep value, distressed credit, special situations. Author of Margin of Safety. 13F shows the equity slice (~40%); rest is credit/distressed." },
  { cik: "0001006438", entity: "Appaloosa Management",       manager: "Tepper",         category: "value", multiplier: 1.0, coverage_pct: 0.50, signal_class: "thesis_driven", publishes_letters: false, bio: "David Tepper. Macro + distressed. Famously bullish on banks in March 2009. Owns the Carolina Panthers. 13F shows the long-equity portion." },
  { cik: "0000949509", entity: "Oaktree Capital",            manager: "Marks",          category: "value", multiplier: 1.0, coverage_pct: 0.20, signal_class: "thesis_driven", publishes_letters: true, bio: "Howard Marks. Mostly credit/distressed — 13F equity slice small. His memos are the real signal source." },
  { cik: "0001079114", entity: "Greenlight Capital",         manager: "Einhorn",        category: "value", multiplier: 1.0, coverage_pct: 0.80, signal_class: "thesis_driven", publishes_letters: true, bio: "David Einhorn. Long/short value. Called Lehman in 2008. Recent years pivoted back to deep-value with notable wins." },
  { cik: "0001510387", entity: "Gotham Asset Management",    manager: "Greenblatt",     category: "value", multiplier: 1.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: true, bio: "Joel Greenblatt. Special situations + the 'Magic Formula' value approach. Wrote The Little Book That Beats the Market." },
  { cik: "0001056831", entity: "Fairholme Capital",          manager: "Berkowitz",      category: "value", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Bruce Berkowitz. Extreme concentration — fund is essentially 75% St. Joe Company + Sears legacy positions." },
  { cik: "0000915191", entity: "Fairfax Financial",          manager: "Watsa",          category: "value", multiplier: 1.0, coverage_pct: 0.70, signal_class: "thesis_driven", publishes_letters: true, bio: "Prem Watsa. Often called 'Canada's Buffett'. Insurance + concentrated equity. Long-term contrarian." },
  { cik: "0000807985", entity: "Southeastern Asset Management",manager: "Hawkins",      category: "value", multiplier: 1.0, coverage_pct: 0.90, signal_class: "thesis_driven", publishes_letters: true, bio: "Mason Hawkins / Longleaf Partners. 50+ year value firm. Concentrated, contrarian, long-horizon. Famous for sticking with positions through painful drawdowns." },
  { cik: "0001325447", entity: "First Eagle Investment Management", manager: "McLennan", category: "value", multiplier: 1.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: true, bio: "Matthew McLennan. Global value with a gold-as-hedge philosophy (founded by Jean-Marie Eveillard). Quality bias, mid-cap fundamentals focus." },

  // ─── concentrated / contrarian ─────────────────────────────────────────
  { cik: "0001649339", entity: "Scion Asset Management",     manager: "Burry",          category: "concentrated", multiplier: 1.0, coverage_pct: 0.70, signal_class: "thesis_driven", publishes_letters: false, bio: "Michael Burry. Famous from The Big Short. Often hedged via options (some hedges show in 13F); often contrarian; occasionally devastatingly right." },
  { cik: "0001115373", entity: "Semper Augustus Investments",manager: "Bloomstran",     category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: true, bio: "Chris Bloomstran. Quiet, deep-value, concentrated. Publishes a widely-read annual analysis of Berkshire Hathaway." },
  { cik: "0001697868", entity: "Valley Forge Capital",       manager: "Kantesaria",     category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Dev Kantesaria. Quality compounders, concentrated. Strong recent returns (~20% annualized)." },
  { cik: "0001542302", entity: "Lyrical Asset Management",   manager: "Wellington",     category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Andrew Wellington. Deep value small-cap. Quiet, disciplined, consistent." },
  { cik: "0002045724", entity: "Situational Awareness LP",   manager: "Aschenbrenner",  category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: true, bio: "Leopold Aschenbrenner, ex-OpenAI superalignment. Launched 2024 on the thesis of his viral 'Situational Awareness' essay — AGI requires massive compute capex, so buy the picks-and-shovels: power (Bloom Energy, EQT), data center hosting (CoreWeave, Core Scientific, IREN), chips & optics (Intel, Lumentum, Coherent). $5.5B AUM by end of 2025. Filed 13D on Core Scientific Aug 2025. Short track record but highly thesis-coherent." },
  { cik: "0001112520", entity: "Akre Capital Management",    manager: "Akre",           category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: true, bio: "Chuck Akre. Quality compounders only — 'three-legged stool' of high return on capital, durable competitive advantage, and management that allocates capital well. Visa, Mastercard, Moody's, KKR. Long holding periods." },
  { cik: "0001553733", entity: "Brave Warrior Advisors",     manager: "Greenberg",      category: "concentrated", multiplier: 1.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Glenn Greenberg, ex-Chieftain Capital. Concentrated value, ~15 positions typical. Strong long-term record over multiple decades." },
  { cik: "0001138995", entity: "Glenview Capital Management",manager: "Robbins",        category: "concentrated", multiplier: 1.0, coverage_pct: 0.80, signal_class: "thesis_driven", publishes_letters: false, bio: "Larry Robbins. Healthcare-focused concentrated long/short. Major positions in managed care, healthcare services, pharma. Top-10 typically >60% of book." },
  { cik: "0001224962", entity: "Perceptive Advisors",        manager: "Edelman",        category: "concentrated", multiplier: 1.0, coverage_pct: 0.70, signal_class: "thesis_driven", publishes_letters: false, bio: "Joseph Edelman. Biotech specialist — concentrated long/short book in small/mid-cap drug developers. One of the most accomplished biotech investors of the 21st century." },
  { cik: "0001517857", entity: "Soroban Capital Partners",   manager: "Mandelblatt",    category: "concentrated", multiplier: 1.0, coverage_pct: 0.80, signal_class: "thesis_driven", publishes_letters: false, bio: "Eric Mandelblatt, ex-TPG-Axon. Concentrated long/short with low turnover. Multi-billion AUM. Quality + special situations." },

  // ─── growth / tech ──────────────────────────────────────────────────────
  { cik: "0001167483", entity: "Tiger Global Management",    manager: "Coleman",        category: "growth", multiplier: 1.0, coverage_pct: 0.30, signal_class: "thesis_driven", publishes_letters: false, bio: "Chase Coleman, a 'Tiger Cub'. Huge private-company book — 13F shows ~30%. Hard 2022 drawdown on public + private markdowns." },
  { cik: "0001135730", entity: "Coatue Management",          manager: "Laffont",        category: "growth", multiplier: 1.0, coverage_pct: 0.30, signal_class: "thesis_driven", publishes_letters: false, bio: "Phil Laffont. Another Tiger Cub. Growth/tech + private investments. AI-adjacent. 13F shows ~30%." },
  { cik: "0001061165", entity: "Lone Pine Capital",          manager: "Mandel",         category: "growth", multiplier: 1.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: false, bio: "Steve Mandel. Returned outside capital in 2019; now runs private money. One of the best long-term records in growth equities." },
  { cik: "0001103804", entity: "Viking Global Investors",    manager: "Halvorsen",      category: "growth", multiplier: 1.0, coverage_pct: 0.70, signal_class: "thesis_driven", publishes_letters: false, bio: "Andreas Halvorsen. Disciplined Tiger Cub. More fundamentals-driven than the other cubs. Strong recent record." },
  { cik: "0000934639", entity: "Maverick Capital",           manager: "Ainslie",        category: "growth", multiplier: 1.0, coverage_pct: 0.80, signal_class: "thesis_driven", publishes_letters: false, bio: "Lee Ainslie. Long-time Tiger Cub. Long/short global equities. Mixed recent performance." },
  { cik: "0001747057", entity: "D1 Capital Partners",        manager: "Sundheim",       category: "growth", multiplier: 1.0, coverage_pct: 0.50, signal_class: "thesis_driven", publishes_letters: false, bio: "Dan Sundheim, ex-Viking Global CIO. Multi-billion crossover fund — half public equity, half private. 13F captures ~50% of book; private investments are large." },
  { cik: "0001569049", entity: "Light Street Capital",       manager: "Kacher",         category: "growth", multiplier: 1.0, coverage_pct: 0.60, signal_class: "thesis_driven", publishes_letters: false, bio: "Glen Kacher. Tech-focused Tiger Cub. Smaller than the famous Cubs but high-conviction in software/internet/semis." },
  { cik: "0001700574", entity: "Holocene Advisors",          manager: "Haley",          category: "growth", multiplier: 1.0, coverage_pct: 0.65, signal_class: "thesis_driven", publishes_letters: false, bio: "Brandon Haley, ex-Citadel pod manager. Long/short tech, market-neutral-leaning. Net long bias historically." },

  // ─── activists (multiplier 2.0 — heaviest in scorer) ───────────────────
  { cik: "0001336528", entity: "Pershing Square Capital Management", manager: "Ackman", category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: true, bio: "Bill Ackman. High-profile activist. Big wins on Chipotle, Hilton. Famous losing fights too (Valeant, Herbalife). Loud, public, opinionated." },
  { cik: "0001040273", entity: "Third Point LLC",            manager: "Loeb",           category: "activist", multiplier: 2.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: true, bio: "Dan Loeb. Activist + event-driven. Known for sharply-worded letters to CEOs and corporate governance fights." },
  { cik: "0001412093", entity: "Icahn Capital",              manager: "Icahn",          category: "activist", multiplier: 2.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: false, bio: "Carl Icahn. 88 years old, decades of activist campaigns. Recent years quieter; Icahn Enterprises stock crashed in 2023 after a short report." },
  { cik: "0001345471", entity: "Trian Fund Management",      manager: "Peltz",          category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Nelson Peltz. Constructivist activism — works with management. Big wins on Heinz, PepsiCo, P&G. Recent Disney campaign." },
  { cik: "0001791786", entity: "Elliott Investment Management", manager: "Singer",      category: "activist", multiplier: 2.0, coverage_pct: 0.50, signal_class: "thesis_driven", publishes_letters: false, bio: "Paul Singer. The most aggressive large activist firm. Multi-strategy — equity activism, credit, distressed sovereigns. 13F shows the equity portion." },
  { cik: "0001517137", entity: "Starboard Value LP",         manager: "Smith",          category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Jeff Smith. Mid-cap activist. Famous Olive Garden turnaround. Often pushes for sales or strategic alternatives." },
  { cik: "0001535472", entity: "Corvex Management",          manager: "Meister",        category: "activist", multiplier: 2.0, coverage_pct: 0.90, signal_class: "thesis_driven", publishes_letters: false, bio: "Keith Meister. Carl Icahn's protégé. Selective concentrated activist plays — Southwest Gas, Energen historically." },
  { cik: "0001418814", entity: "ValueAct Capital Management",manager: "ValueAct",       category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Mason Morfit's firm. Constructive activist that takes board seats. Big Microsoft position helped Satya Nadella's cloud pivot." },
  { cik: "0001817187", entity: "Inclusive Capital Partners", manager: "Ubben",          category: "activist", multiplier: 2.0, coverage_pct: 0.90, signal_class: "thesis_driven", publishes_letters: false, bio: "Jeff Ubben. Founded ValueAct, then left to focus on ESG/impact activism via Inclusive. Fund status reportedly winding down." },
  { cik: "0001159159", entity: "JANA Partners",              manager: "Rosenstein",     category: "activist", multiplier: 2.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: false, bio: "Barry Rosenstein. Big mid-large cap activist wins: Whole Foods (sold to Amazon), Tiffany. Plays both constructive and confrontational." },
  { cik: "0001582090", entity: "Sachem Head Capital Management", manager: "Ferguson",   category: "activist", multiplier: 2.0, coverage_pct: 0.85, signal_class: "thesis_driven", publishes_letters: false, bio: "Scott Ferguson, Ackman alum. Concentrated activist book, mid-cap focus." },
  { cik: "0001695459", entity: "Mantle Ridge LP",            manager: "Hilal",          category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Paul Hilal. Most famous for the CSX activist campaign (replaced CEO with Hunter Harrison). Very concentrated — sometimes ~1-3 positions at a time." },
  { cik: "0001559771", entity: "Engaged Capital",            manager: "Welling",        category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Glenn Welling. Mid-cap activist; constructive in approach. Catches situations the mega-activists ignore." },
  { cik: "0001665590", entity: "Engine Capital Management",  manager: "Ajdler",         category: "activist", multiplier: 2.0, coverage_pct: 0.95, signal_class: "thesis_driven", publishes_letters: false, bio: "Arnaud Ajdler. Small-cap activist. Operates below the radar of big activists; catches sub-$1B situations." },

  // ─── macro ──────────────────────────────────────────────────────────────
  // Re-added under the softened rule (coverage_pct annotation, not exclusion).
  // Their 13F shows a small slice of mostly-macro books — signal gets
  // de-weighted automatically but isn't silently dropped.
  { cik: "0001420192", entity: "Hayman Capital Management",  manager: "Bass",           category: "macro", multiplier: 1.0, coverage_pct: 0.10, signal_class: "thesis_driven", publishes_letters: false, bio: "Kyle Bass. Sovereign macro/credit specialist. 13F captures ~10% of book — the small US-equity slice. Recent macro calls (Japan, China) have been wrong; track with skepticism." },

  // ─── corporate strategic investors (multiplier 1.5) ─────────────────────
  { cik: "0001045810", entity: "NVIDIA Corporation",         manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "AI compute leader. Strategic investments in AI infrastructure plays (Run:ai, CoreWeave). $5B Intel investment Sep 2025." },
  { cik: "0000789019", entity: "Microsoft Corporation",      manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "$13B+ in OpenAI; numerous AI/cloud strategic investments. Capital allocation under Satya Nadella has been highly effective." },
  { cik: "0001652044", entity: "Alphabet Inc.",              manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Google parent. Anthropic investment, Waymo, DeepMind. Strategic bets shape the AI/cloud landscape." },
  { cik: "0001018724", entity: "Amazon.com, Inc.",           manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "$4B+ in Anthropic, MGM acquisition, Whole Foods. AWS-driven strategic plays." },
  { cik: "0001326801", entity: "Meta Platforms, Inc.",       manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Scale AI partnership, ongoing AI infrastructure bets, occasional acquisitions." },
  { cik: "0000320193", entity: "Apple Inc.",                 manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Famously acquisition-light. Major investments rare but signal-bearing when they happen (Beats, supplier stakes)." },
  { cik: "0001341439", entity: "Oracle Corporation",         manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Cloud GPU partnerships; OpenAI compute deal. Larry Ellison's strategic bets are concentrated and high-conviction." },
  { cik: "0001730168", entity: "Broadcom Inc.",              manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "VMware acquisition was transformative. Semi industry M&A often signals foundry/ecosystem repositioning." },
  { cik: "0001108524", entity: "Salesforce, Inc.",           manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Slack acquisition, ongoing AI-startup investments. Marc Benioff's capital allocation is acquisitive." },
  { cik: "0000796343", entity: "Adobe Inc.",                 manager: null, category: "corporate_strategic", multiplier: 1.5, coverage_pct: 1.0, signal_class: "thesis_driven", bio: "Figma deal (blocked) was a $20B signal of where they think creative-tool consolidation is going. Investments are themed around design + AI." },
];

const BY_CIK = new Map(FILERS_LIST.map((f) => [f.cik, f]));

export function filerInfo(cik: string | null | undefined): FilerInfo | null {
  if (!cik) return null;
  return BY_CIK.get(cik.padStart(10, "0")) ?? null;
}

export function allFilers(): FilerInfo[] {
  return FILERS_LIST;
}

// Visual priority tier for table-row highlighting.
// Higher tier = colored more prominently.
export function tier(cik: string | null | undefined): 0 | 1 | 2 {
  const info = filerInfo(cik);
  if (!info) return 0;
  if (info.category === "activist") return 2; // top tier
  if (info.category === "corporate_strategic") return 1; // mid
  return 0;
}
