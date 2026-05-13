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
  | "corporate_strategic";

export type FilerInfo = {
  cik: string;
  entity: string;       // company-name entity, e.g. "Pershing Square Capital Management"
  manager: string | null; // person, e.g. "Ackman" — null for corporations
  category: FilerCategory;
  multiplier: number;
  bio?: string;         // one-line description; shown on Filers profile page
};

const FILERS_LIST: FilerInfo[] = [
  // ─── value / generalists ────────────────────────────────────────────────
  { cik: "0001067983", entity: "Berkshire Hathaway",         manager: "Buffett",        category: "value", multiplier: 1.0, bio: "Warren Buffett. 60+ years of compounding. Concentrated equity book, $300B+ AUM. Apple is the biggest position. The benchmark." },
  { cik: "0001536411", entity: "Duquesne Family Office",     manager: "Druckenmiller",  category: "value", multiplier: 1.0, bio: "Stanley Druckenmiller. ~30% annualized over 30 years, no down years. Famously broke the Bank of England in '92. Macro-driven concentrated bets." },
  { cik: "0001061768", entity: "Baupost Group",              manager: "Klarman",        category: "value", multiplier: 1.0, bio: "Seth Klarman. Deep value, distressed credit, special situations. Author of Margin of Safety. Quiet but consistent." },
  { cik: "0001006438", entity: "Appaloosa Management",       manager: "Tepper",         category: "value", multiplier: 1.0, bio: "David Tepper. Macro + distressed. Famously bullish on banks in March 2009. Owns the Carolina Panthers." },
  { cik: "0000949509", entity: "Oaktree Capital",            manager: "Marks",          category: "value", multiplier: 1.0, bio: "Howard Marks. Credit/distressed investing. His memos to clients are widely read across Wall Street." },
  { cik: "0001079114", entity: "Greenlight Capital",         manager: "Einhorn",        category: "value", multiplier: 1.0, bio: "David Einhorn. Long/short value. Called Lehman in 2008. Recent years pivoted back to deep-value with notable wins." },
  { cik: "0001510387", entity: "Gotham Asset Management",    manager: "Greenblatt",     category: "value", multiplier: 1.0, bio: "Joel Greenblatt. Special situations + the 'Magic Formula' value approach. Wrote The Little Book That Beats the Market." },
  { cik: "0001056831", entity: "Fairholme Capital",          manager: "Berkowitz",      category: "value", multiplier: 1.0, bio: "Bruce Berkowitz. Extreme concentration — fund is essentially 75% St. Joe Company + Sears legacy positions." },
  { cik: "0000915191", entity: "Fairfax Financial",          manager: "Watsa",          category: "value", multiplier: 1.0, bio: "Prem Watsa. Often called 'Canada's Buffett'. Insurance + concentrated equity. Long-term contrarian." },

  // ─── concentrated / contrarian ─────────────────────────────────────────
  { cik: "0001649339", entity: "Scion Asset Management",     manager: "Burry",          category: "concentrated", multiplier: 1.0, bio: "Michael Burry. Famous from The Big Short (housing collapse in 2008). Often hedged, often contrarian, occasionally devastatingly right." },
  { cik: "0001115373", entity: "Semper Augustus Investments",manager: "Bloomstran",     category: "concentrated", multiplier: 1.0, bio: "Chris Bloomstran. Quiet, deep-value, concentrated. Publishes a widely-read annual analysis of Berkshire Hathaway." },
  { cik: "0001697868", entity: "Valley Forge Capital",       manager: "Kantesaria",     category: "concentrated", multiplier: 1.0, bio: "Dev Kantesaria. Quality compounders, concentrated. Strong recent returns (~20% annualized)." },
  { cik: "0001542302", entity: "Lyrical Asset Management",   manager: "Wellington",     category: "concentrated", multiplier: 1.0, bio: "Andrew Wellington. Deep value small-cap. Quiet, disciplined, consistent." },

  // ─── growth / tech ──────────────────────────────────────────────────────
  { cik: "0001167483", entity: "Tiger Global Management",    manager: "Coleman",        category: "growth", multiplier: 1.0, bio: "Chase Coleman, a 'Tiger Cub' (trained under Julian Robertson). Growth/tech focus, big private-company book. Hard 2022 drawdown." },
  { cik: "0001135730", entity: "Coatue Management",          manager: "Laffont",        category: "growth", multiplier: 1.0, bio: "Phil Laffont. Another Tiger Cub. Growth/tech + private investments. AI-adjacent positioning." },
  { cik: "0001061165", entity: "Lone Pine Capital",          manager: "Mandel",         category: "growth", multiplier: 1.0, bio: "Steve Mandel. Returned outside capital in 2019; now runs private money. One of the best long-term records in growth equities." },
  { cik: "0001103804", entity: "Viking Global Investors",    manager: "Halvorsen",      category: "growth", multiplier: 1.0, bio: "Andreas Halvorsen. Disciplined Tiger Cub. More fundamentals-driven than the other cubs. Strong recent record." },
  { cik: "0000934639", entity: "Maverick Capital",           manager: "Ainslie",        category: "growth", multiplier: 1.0, bio: "Lee Ainslie. Long-time Tiger Cub. Long/short global equities. Mixed recent performance." },

  // ─── activists (multiplier 2.0 — heaviest in scorer) ───────────────────
  { cik: "0001336528", entity: "Pershing Square Capital Management", manager: "Ackman", category: "activist", multiplier: 2.0, bio: "Bill Ackman. High-profile activist. Big wins on Chipotle, Hilton. Famous losing fights too (Valeant, Herbalife). Loud, public, opinionated." },
  { cik: "0001040273", entity: "Third Point LLC",            manager: "Loeb",           category: "activist", multiplier: 2.0, bio: "Dan Loeb. Activist + event-driven. Known for sharply-worded letters to CEOs and corporate governance fights." },
  { cik: "0001412093", entity: "Icahn Capital",              manager: "Icahn",          category: "activist", multiplier: 2.0, bio: "Carl Icahn. 88 years old, decades of activist campaigns. Recent years quieter; Icahn Enterprises stock crashed in 2023 after a short report." },
  { cik: "0001345471", entity: "Trian Fund Management",      manager: "Peltz",          category: "activist", multiplier: 2.0, bio: "Nelson Peltz. Constructivist activism — works with management. Big wins on Heinz, PepsiCo, P&G. Recent Disney campaign." },
  { cik: "0001791786", entity: "Elliott Investment Management", manager: "Singer",      category: "activist", multiplier: 2.0, bio: "Paul Singer. The most aggressive large activist firm. Pursues breakups, sales, governance changes. Wins more than it loses." },
  { cik: "0001517137", entity: "Starboard Value LP",         manager: "Smith",          category: "activist", multiplier: 2.0, bio: "Jeff Smith. Mid-cap activist. Famous Olive Garden turnaround. Often pushes for sales or strategic alternatives." },
  { cik: "0001535472", entity: "Corvex Management",          manager: "Meister",        category: "activist", multiplier: 2.0, bio: "Keith Meister. Carl Icahn's protégé. Selective concentrated activist plays — Southwest Gas, Energen historically." },
  { cik: "0001418814", entity: "ValueAct Capital Management",manager: "ValueAct",       category: "activist", multiplier: 2.0, bio: "Mason Morfit's firm. Constructive activist that takes board seats. Big Microsoft position helped Satya Nadella's cloud pivot." },
  { cik: "0001817187", entity: "Inclusive Capital Partners", manager: "Ubben",          category: "activist", multiplier: 2.0, bio: "Jeff Ubben. Founded ValueAct, then left to focus on ESG/impact activism via Inclusive. Fund status reportedly winding down." },

  // ─── corporate strategic investors (multiplier 1.5) ─────────────────────
  { cik: "0001045810", entity: "NVIDIA Corporation",         manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "AI compute leader. Strategic investments in AI infrastructure plays (Run:ai, CoreWeave). $5B Intel investment Sep 2025." },
  { cik: "0000789019", entity: "Microsoft Corporation",      manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "$13B+ in OpenAI; numerous AI/cloud strategic investments. Capital allocation under Satya Nadella has been highly effective." },
  { cik: "0001652044", entity: "Alphabet Inc.",              manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Google parent. Anthropic investment, Waymo, DeepMind. Strategic bets shape the AI/cloud landscape." },
  { cik: "0001018724", entity: "Amazon.com, Inc.",           manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "$4B+ in Anthropic, MGM acquisition, Whole Foods. AWS-driven strategic plays." },
  { cik: "0001326801", entity: "Meta Platforms, Inc.",       manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Scale AI partnership, ongoing AI infrastructure bets, occasional acquisitions." },
  { cik: "0000320193", entity: "Apple Inc.",                 manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Famously acquisition-light. Major investments rare but signal-bearing when they happen (Beats, supplier stakes)." },
  { cik: "0001341439", entity: "Oracle Corporation",         manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Cloud GPU partnerships; OpenAI compute deal. Larry Ellison's strategic bets are concentrated and high-conviction." },
  { cik: "0001730168", entity: "Broadcom Inc.",              manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "VMware acquisition was transformative. Semi industry M&A often signals foundry/ecosystem repositioning." },
  { cik: "0001108524", entity: "Salesforce, Inc.",           manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Slack acquisition, ongoing AI-startup investments. Marc Benioff's capital allocation is acquisitive." },
  { cik: "0000796343", entity: "Adobe Inc.",                 manager: null, category: "corporate_strategic", multiplier: 1.5, bio: "Figma deal (blocked) was a $20B signal of where they think creative-tool consolidation is going. Investments are themed around design + AI." },
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
