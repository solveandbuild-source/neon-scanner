// Glossary entries. Source-of-truth used by both the /learn page and
// inline tooltips. Each entry is written *user-centric* — "what this means
// for you as an investor trying to make money" — not Wikipedia definitions.

export type GlossaryEntry = {
  term: string;
  short: string;     // one-sentence for hover tooltips
  meaning: string;   // "what this means for an investor" (plain English)
  example?: string;  // concrete example from real life or our data
};

export const FORMS: Record<string, GlossaryEntry> = {
  "13F-HR": {
    term: "Form 13F",
    short: "A snapshot of what a big fund owns. Updated quarterly, but you see it 45 days late.",
    meaning:
      "Every fund managing more than $100M of US stocks has to publish their full portfolio every 3 months. Catch: the disclosure comes 45 days AFTER quarter-end. So Buffett's March holdings only become public around May 15. You use this to see who holds what, and especially to spot when multiple smart funds independently piled into the same stock in the same quarter — that's the strongest pattern 13Fs surface. Don't use it to react in real time; the data is always 1-3 months old.",
    example:
      "Berkshire's Q1 2025 13F (filed May 15, 2025) shows Buffett held 905M shares of Apple as of March 31, 2025.",
  },
  "13F-HR/A": {
    term: "Form 13F amendment",
    short: "Fund is correcting or updating a previously-filed 13F. Usually a paperwork fix, not new info.",
    meaning:
      "Same as 13F-HR but it's a correction of an earlier filing. Usually low signal — fixes typos, restates a position, adjusts for splits. Rarely changes what the fund actually owns.",
  },
  "SC 13D": {
    term: "Schedule 13D",
    short: "An activist bought >5% of a company AND plans to push for changes. The single highest-signal event in the system.",
    meaning:
      "When any investor crosses 5% ownership of a US public company AND has intent to influence (push for CEO change, sale, breakup, capital return), they MUST file 13D within 10 days. Why this matters more than anything else here: (1) it's FRESH — 10 days, not 45, (2) it's a BIG bet — 5%+ is real money, (3) it's INTENTIONAL — the activist publicly commits in Item 4 to what they want to do. If Ackman files a 13D on a stock you've never heard of, that's worth investigating.",
    example:
      "Ackman buys 7.8% of Restaurant Brands → Pershing Square files 13D within 10 days describing his plan to engage management on capital allocation.",
  },
  "SCHEDULE 13D": {
    term: "Schedule 13D",
    short: "An activist bought >5% AND plans to push for changes. Highest-signal event in the system.",
    meaning:
      "Same as 'SC 13D' above — EDGAR just relabeled the form-type string in late 2024.",
    example:
      "Ackman buys 7.8% of Restaurant Brands → Pershing Square files 13D within 10 days describing his plan to engage management on capital allocation.",
  },
  "SC 13D/A": {
    term: "Schedule 13D amendment",
    short: "Update to a prior 13D. Either the activist's stake changed, their intent changed, or they exited.",
    meaning:
      "Activists file 13D amendments whenever their position size moves meaningfully, when their goals shift, or when they exit. The Direction column tells you which: INCREASE (they're building), DECREASE (trimming/exiting), AMEND (admin update). Reading the amendment vs. prior tells you their conviction trajectory.",
    example:
      "Ackman previously filed 13D at 7.5% on Restaurant Brands. New 13D/A shows 7.8% — Direction column reads 'INCREASE +0.3%'. Means he's adding.",
  },
  "SCHEDULE 13D/A": {
    term: "Schedule 13D amendment",
    short: "Update to a prior 13D. Stake changed, intent changed, or they exited.",
    meaning:
      "Same as 'SC 13D/A' — newer EDGAR label.",
  },
  "SC 13G": {
    term: "Schedule 13G",
    short: "Crossed 5% but as a PASSIVE holder — disclaiming any intent to influence. Lower signal than 13D.",
    meaning:
      "Same 5% threshold as 13D, but 13G filers explicitly say 'we have no intent to influence the company.' Usually filed by index funds (Vanguard, BlackRock, State Street) whose ownership is automatic — mechanical index buying, not a high-conviction bet. Treat as background data, not a signal.",
    example:
      "Vanguard's S&P 500 ETF mechanically owns ~7% of Apple. Vanguard files 13G on Apple — but that says nothing about whether Apple is a good buy.",
  },
  "SCHEDULE 13G": {
    term: "Schedule 13G",
    short: "Passive 5%+ stake. Lower signal than 13D.",
    meaning: "Same as 'SC 13G' — newer EDGAR label.",
  },
  "SC 13G/A": {
    term: "Schedule 13G amendment",
    short: "Routine update to a 13G. Usually just annual confirmation. Low signal.",
    meaning:
      "Updates to a 13G are usually annual rebalancing or share-count adjustments. Mostly noise.",
  },
  "SCHEDULE 13G/A": {
    term: "Schedule 13G amendment",
    short: "Routine update to a 13G. Low signal.",
    meaning: "Same as 'SC 13G/A' — newer EDGAR label.",
  },
  "4": {
    term: "Form 4",
    short: "An insider (CEO, CFO, director) bought or sold their own company's stock. Filed within 2 business days — the FRESHEST data we get.",
    meaning:
      "When a corporate insider — the CEO, CFO, directors, or any 10%+ owner — buys or sells their own company's stock, they must disclose within 2 business days. The signal is INSIDER BUYS specifically (transaction code 'P'). Sales are noisy — they happen for many reasons (taxes, diversification, lifestyle, scheduled 10b5-1 plans). Buys are different — people only buy their own stock if they think it's going up. Multiple insiders buying in a tight window ('cluster') is one of the strongest small-cap signals there is.",
    example:
      "GeneDx CFO and three directors all buy their own company's stock within the same week → insider cluster signal. Suggests management sees something the market hasn't priced in.",
  },
  "4/A": {
    term: "Form 4 amendment",
    short: "Correction to a previous Form 4. Usually a typo fix.",
    meaning:
      "Amendment to a previously-filed Form 4. Usually clerical — fixes a wrong share count or trade date.",
  },
  "8-K": {
    term: "Form 8-K",
    short: "Something material happened that the company has to disclose within 4 business days — M&A, leadership changes, big contracts, strategic investments.",
    meaning:
      "8-K is the 'something happened' filing. Companies must disclose any material event within 4 business days. The form has numbered 'items' that tell you WHAT happened: 1.01 = material agreement (often M&A or partnerships), 2.01 = completed acquisition, 5.02 = CEO/CFO/director change, 8.01 = other material events. Most 8-Ks are routine (auditor changes, etc.); we filter to the items that carry real signal. When NVIDIA invests $5B in Intel, that shows up here. When a company announces a big buyback, here. When a CEO suddenly resigns, here.",
    example:
      "September 2025: NVIDIA agrees to invest $5B in Intel. Both companies file 8-K within 4 business days describing the deal. Massive signal for both stocks.",
  },
  "8-K/A": {
    term: "Form 8-K amendment",
    short: "Update or correction to a previously-filed 8-K.",
    meaning:
      "Amendment to an 8-K. Often adds details that weren't ready in the original filing (e.g., the original announced an acquisition; the amendment adds the financial statements).",
  },
};

// Filing concepts, codes, and other domain terms.
export const CONCEPTS: GlossaryEntry[] = [
  {
    term: "CIK",
    short: "A unique 10-digit ID the SEC gives every filer (company or fund). It's how we link filings to filers reliably.",
    meaning:
      "The Central Index Key — SEC's primary key. Every fund, every public company, every insider person has one. Berkshire Hathaway = 0001067983, Apple = 0000320193, Ackman's Pershing Square = 0001336528. Don't worry about memorizing them — just know that's how filings link to filers in our system.",
  },
  {
    term: "CUSIP",
    short: "A 9-character ID for a stock — unique across all exchanges. 13F filings list holdings by CUSIP, not ticker.",
    meaning:
      "CUSIP is the universal ID for a security. Each common-stock has its own. 13F filings only report by CUSIP, which is why our Holdings page shows CUSIPs (we haven't built the CUSIP→ticker mapping yet). You can paste a CUSIP into Google to look up the company.",
    example:
      "Apple's CUSIP is 037833100. Restaurant Brands International is 76131D103.",
  },
  {
    term: "Period of Report",
    short: "What date the filing's content is ABOUT — usually different from when the filing was filed.",
    meaning:
      "A 13F filed on May 15 might have period_of_report = March 31. The filing is reporting on what was true on March 31. The gap between the two is the 45-day legal delay. When you see 'period 2025-03-31', that's the date the data is as of, not the filing date.",
  },
  {
    term: "Filer",
    short: "Whoever submitted the SEC filing — fund manager, insider person, or public company.",
    meaning:
      "We track 38 specific filers (28 fund managers + 10 corporate strategic investors). The list and bios are at /filers (coming soon).",
  },
  {
    term: "Issuer",
    short: "The public company whose stock the filing is about.",
    meaning:
      "Don't confuse with filer. The filer is whoever sent the filing in. The issuer is the company whose stock is the subject. When Ackman files 13D on Restaurant Brands, Ackman is the filer, Restaurant Brands is the issuer.",
  },
];

// Transaction codes on Form 4
export const FORM4_CODES: GlossaryEntry[] = [
  {
    term: "P — Purchase",
    short: "Open-market or private buy with the insider's own money. THE signal you care about.",
    meaning:
      "An insider buying their own company's stock on the open market. The cleanest insider signal — they're spending their own money on their own employer. Especially valuable when 3+ insiders buy in a short window.",
  },
  {
    term: "S — Sale",
    short: "Open-market sell. Mostly noisy. People sell for many reasons.",
    meaning:
      "Insider sells happen for many reasons that have nothing to do with their view on the stock: taxes, diversification, lifestyle, vested-RSU obligations, scheduled 10b5-1 plans. Usually not signal-bearing in isolation. A LARGE cluster of unscheduled sales might be worth investigating.",
  },
  {
    term: "A — Award/Grant",
    short: "Insider was GIVEN shares (RSU vesting, etc.). Not a market decision.",
    meaning:
      "The company gave the insider shares as compensation. Not a market signal — it's just payroll in stock form.",
  },
  {
    term: "M — Option Exercise",
    short: "Insider converted options into shares. Often paired with an immediate sale to cover taxes.",
    meaning:
      "They had a stock option, they exercised it (paid the strike price, got the shares). Usually paired with an S transaction on the same day to cover the strike + taxes. Not directly signal-bearing.",
  },
  {
    term: "F — Tax Payment",
    short: "Shares surrendered to cover tax on vested compensation. Not a market decision.",
    meaning:
      "When RSUs vest, the IRS wants taxes. Many companies let the employee 'sell to cover' — surrender some shares back to pay the tax. The F code marks that. Definitely not a market signal.",
  },
  {
    term: "G — Gift",
    short: "Shares gifted to charity, family, or a trust. Not a market decision.",
    meaning:
      "Charitable gifts or transfers to family trusts. Disclosable but not signal-bearing.",
  },
  {
    term: "C — Conversion",
    short: "Conversion of one security type to another (e.g., convertible debt into common stock).",
    meaning:
      "Mechanical conversion between security types. Not market-driven.",
  },
];

// Filer categories
export const FILER_CATEGORIES: GlossaryEntry[] = [
  {
    term: "activist (amber bar — highest priority)",
    short: "Funds whose business is taking big stakes and forcing changes. Their filings are the highest-signal events here.",
    meaning:
      "Funds whose strategy is: identify an underperforming public company, buy 5%+ of the shares, then publicly push for changes (board seats, new CEO, sell the company, break it up, return cash). When you see a fresh 13D from an activist (amber-bar row on Events), pay attention. They've done months of analysis before filing, and once filed they HAVE to follow through publicly. Examples: Ackman (Pershing Square), Singer (Elliott), Smith (Starboard), Peltz (Trian), Meister (Corvex), Loeb (Third Point).",
  },
  {
    term: "value (no colored bar — baseline priority)",
    short: "Long-only fundamental value investors. Slower-moving signals, but their positions point to underlying quality.",
    meaning:
      "Funds that buy what they think is underpriced and wait for years. Slower than activists but their picks often signal quality. The Buffett/Klarman crowd — they don't push for change; they just hold what they like. Examples: Buffett (Berkshire), Klarman (Baupost), Watsa (Fairfax), Tepper (Appaloosa).",
  },
  {
    term: "concentrated (no colored bar — baseline priority)",
    short: "High-conviction concentrated/contrarian funds. When they buy something it's a strong vote.",
    meaning:
      "Funds that hold only a handful of names. Every position is a high-conviction bet. Often contrarian. Examples: Burry (Scion — famous from The Big Short), Bloomstran (Semper Augustus), Kantesaria (Valley Forge).",
  },
  {
    term: "growth (no colored bar — baseline priority)",
    short: "Growth and tech-focused funds. Most are 'Tiger Cubs'.",
    meaning:
      "Funds focused on growth and technology. Most are 'Tiger Cubs' — managers who trained under Julian Robertson at Tiger Management in the '90s. Examples: Coleman (Tiger Global), Laffont (Coatue), Mandel (Lone Pine), Halvorsen (Viking).",
  },
  {
    term: "corporate_strategic (sky-blue bar — mid priority)",
    short: "Public companies (NVIDIA, Microsoft, etc.) making strategic equity investments in OTHER companies.",
    meaning:
      "When NVIDIA invests $5B in Intel, that's a different KIND of signal than a fund manager picking a stock. NVIDIA isn't saying 'Intel will outperform the S&P.' They're saying 'Intel's foundry success matters to my supply chain.' Strategic intent. Equally valuable but read differently — these are industry-roadmap bets. Examples in our list: NVIDIA, Microsoft, Alphabet, Amazon, Meta, Apple, Oracle, Broadcom, Salesforce, Adobe.",
  },
];

// Direction labels
export const DIRECTIONS: GlossaryEntry[] = [
  {
    term: "NEW (green)",
    short: "First filing we've seen from this filer on this company. They opened a fresh position.",
    meaning:
      "Either a genuinely new position OR our first visibility into it (our data goes back 3 years). When an activist shows NEW, it's the most actionable variant — go read what they intend to do.",
  },
  {
    term: "INCREASE (green, with +x.x%)",
    short: "Filer raised their stake vs. their previous filing. They're buying more.",
    meaning:
      "Suggests growing conviction. The +x.x% tells you how big the bump was.",
  },
  {
    term: "DECREASE (red, with -x.x%)",
    short: "Filer trimmed their stake vs. previous filing. Taking profits or exiting.",
    meaning:
      "Could be profit-taking, partial exit, or full exit. If %owned drops below 5%, the activist usually files a final amendment and walks away.",
  },
  {
    term: "AMEND (gray)",
    short: "Filing is an amendment but the % didn't materially change (or % couldn't be extracted).",
    meaning:
      "Routine paperwork — share counts adjusting for buybacks, periodic refile, etc. Low signal in isolation.",
  },
];

// Helper: look up a form's short text (used for tooltips)
export function formTip(formType: string): string {
  return FORMS[formType]?.short ?? formType;
}
