// Glossary entries. Source-of-truth used by both the /learn page (full
// definitions) and inline tooltips (shorter `tip` text on form labels).

export type GlossaryEntry = {
  term: string;
  short: string;     // one-sentence definition used in hover tooltips
  long: string;      // longer explanation for the /learn page
  example?: string;  // optional concrete example
};

export const FORMS: Record<string, GlossaryEntry> = {
  "13F-HR": {
    term: "Form 13F",
    short: "Quarterly report of US-listed stock holdings by big investment managers (>$100M AUM). 45-day legal delay.",
    long: "Every institutional investment manager with more than $100M in US-listed equities under management must file Form 13F-HR every quarter. It lists every position they hold — issuer name, CUSIP, share count, dollar value. The catch: there's a 45-day legal delay between quarter-end and the filing being public. So Q1 (ends March 31) holdings become visible mid-May. That's why 13F-derived signals always lag the actual position-taking by 1-3 months.",
    example: "Berkshire Hathaway's Q1 13F filed May 15 shows that Buffett held 905M shares of Apple as of March 31.",
  },
  "13F-HR/A": {
    term: "Form 13F-HR/A",
    short: "Amendment to a previously-filed 13F (correction or update).",
    long: "Same as 13F-HR, but filed to correct or update a previously-submitted 13F. Usually fixes errors, restates positions, or adds late-discovered details.",
  },
  "SC 13D": {
    term: "Schedule 13D",
    short: "An investor crossed 5% ownership of a public company with INTENT to influence — filed within 10 days. The single highest-signal event we track.",
    long: "When any investor (fund, person, corporation) crosses 5% ownership of a US public company AND has intent to influence the company (push for changes, sell, merge, etc.), they must file Schedule 13D within 10 days. This is the most signal-bearing filing because: (a) timely — 10-day disclosure, not 45-day, (b) concentrated — 5%+ is a big bet, (c) intentional — Item 4 of the filing describes what the activist wants to do.",
    example: "Pershing Square crosses 5% of Restaurant Brands → Ackman files SC 13D within 10 days, stating his intent to engage with management.",
  },
  "SCHEDULE 13D": {
    term: "Schedule 13D",
    short: "An investor crossed 5% ownership of a public company with INTENT to influence — filed within 10 days. The single highest-signal event we track.",
    long: "Same as 'SC 13D' above. EDGAR changed the form-type string from 'SC 13D' to 'SCHEDULE 13D' in late 2024 for newer filings. Same legal form, different label in the data feed.",
  },
  "SC 13D/A": {
    term: "Schedule 13D/A",
    short: "Amendment to a previously-filed 13D. Means stake size changed, intent updated, or position closed.",
    long: "Amendment to an existing 13D. Activists file these when their stake size changes meaningfully, when they update their intent (e.g., 'now seeking board seats'), or when they exit. Reading the amendment against the prior filing tells you whether they're building, trimming, or done.",
  },
  "SCHEDULE 13D/A": {
    term: "Schedule 13D/A",
    short: "Amendment to a previously-filed 13D. Means stake size changed, intent updated, or position closed.",
    long: "Same as 'SC 13D/A' — EDGAR's newer form-type label for the same amendment filing.",
  },
  "SC 13G": {
    term: "Schedule 13G",
    short: "An investor crossed 5% but as a PASSIVE holder (no intent to influence). Lower signal than 13D.",
    long: "Same 5% threshold as 13D, but filed by passive holders (mutual funds, index funds, ETFs) who explicitly disclaim activist intent. Lower signal because: a passive 5%+ stake usually means an index automatically owned a share of the company, not a high-conviction bet.",
    example: "Vanguard owning 7% of Apple via the S&P 500 index would file 13G, not 13D.",
  },
  "SCHEDULE 13G": {
    term: "Schedule 13G",
    short: "Passive 5%+ stake. Lower signal than 13D.",
    long: "Same as 'SC 13G' — EDGAR's newer label.",
  },
  "SC 13G/A": {
    term: "Schedule 13G/A",
    short: "Amendment to a previously-filed 13G.",
    long: "Updates a previously-filed 13G. Often just annual confirmations or share-count adjustments — usually low signal.",
  },
  "SCHEDULE 13G/A": {
    term: "Schedule 13G/A",
    short: "Amendment to a previously-filed 13G.",
    long: "Same as 'SC 13G/A' — EDGAR's newer label.",
  },
  "4": {
    term: "Form 4",
    short: "An insider (CEO, CFO, director, or 10%+ owner) bought or sold their own company's stock. Filed within 2 business days.",
    long: "When a corporate insider — defined as an officer, director, or 10%+ owner — buys or sells shares of their own company, they must file Form 4 within 2 business days of the transaction. Each Form 4 contains one or more transactions, each with a transaction code (P for purchase, S for sale, A for grant, etc.). Insider buys (P) are the signal-bearing kind; sales are mostly noise (planned, taxes, diversification).",
    example: "Tim Cook sells 50,000 shares of AAPL at $190 → Apple files Form 4 within 2 business days.",
  },
  "4/A": {
    term: "Form 4/A",
    short: "Correction to a previously-filed Form 4.",
    long: "Amendment to a previously-submitted Form 4. Usually fixes errors in the original filing.",
  },
  "8-K": {
    term: "Form 8-K",
    short: "A material event happened that the company has to disclose within 4 business days — acquisitions, leadership changes, contracts, etc.",
    long: "Companies must file Form 8-K within 4 business days of any 'material event' that shareholders should know about. The form has numbered items defining what kind of event: 1.01 material agreements (M&A, partnerships), 2.01 acquisitions, 5.02 director/officer changes, 8.01 other material events. Most 8-Ks are routine (auditor changes, etc.); a small percentage carry real signal.",
    example: "NVIDIA invests $5B in Intel → both NVIDIA and Intel file 8-K within 4 business days describing the agreement.",
  },
  "8-K/A": {
    term: "Form 8-K/A",
    short: "Amendment to a previously-filed 8-K.",
    long: "Updates or corrects a previously-filed 8-K.",
  },
};

// Filing concepts, codes, and other domain terms.
export const CONCEPTS: GlossaryEntry[] = [
  {
    term: "CIK",
    short: "Central Index Key — the unique 10-digit ID the SEC uses for each filer or company.",
    long: "Every entity that interacts with the SEC (companies, funds, individual insiders) gets a 10-digit CIK number. It's the SEC's primary key for filings. Both fund managers (e.g., Pershing Square = 0001336528) and public companies (Apple = 0000320193) have CIKs.",
  },
  {
    term: "CUSIP",
    short: "A 9-character ID for a specific security (stock, bond). Universal across exchanges.",
    long: "CUSIP (Committee on Uniform Securities Identification Procedures) is a 9-character ID for a security. Each common-stock issue has its own CUSIP. 13F filings report holdings by CUSIP rather than ticker — that's why our Holdings page shows CUSIPs (mapping to tickers is a separate enrichment we haven't done yet).",
    example: "Apple common stock CUSIP = 037833100. Restaurant Brands CUSIP = 76131D103.",
  },
  {
    term: "Accession Number",
    short: "Unique ID for a specific SEC filing. Looks like 0001234567-26-001234.",
    long: "Every SEC filing gets a unique accession number assigned by EDGAR. It's the way we deduplicate filings (same accession = same filing). Format is filer-id-year-sequence.",
  },
  {
    term: "Period of Report",
    short: "What date the filing's content is reporting on (e.g., end of Q1 = 2025-03-31).",
    long: "Distinct from 'filed date'. A 13F filed on May 15, 2025 typically has period_of_report = March 31, 2025 (the end of Q1). The gap between period_of_report and filed_date is the 45-day legal delay.",
  },
  {
    term: "Filer",
    short: "The entity submitting the SEC filing — could be a fund, an insider person, or a public company.",
    long: "In our system, 'filer' is whoever submitted the filing. For 13F, it's the investment manager. For 13D, it's the activist. For Form 4, it's the insider person. We track 38 specific filers — see the Filers page for the list and bios.",
  },
  {
    term: "Issuer",
    short: "The public company whose stock the filing is about.",
    long: "For 13F, the issuer is each company in the holdings list. For 13D, the issuer is the company the activist bought into. For Form 4, the issuer is the company the insider works at.",
  },
];

// Transaction codes on Form 4
export const FORM4_CODES: GlossaryEntry[] = [
  { term: "P — Purchase", short: "Open-market or private purchase. The signal-bearing insider buy.", long: "P-coded transactions are open-market or private purchases with the insider's own money. These are the high-signal events worth watching." },
  { term: "S — Sale", short: "Open-market or private sale. Usually noisy.", long: "Insider sales happen for many reasons (taxes, diversification, lifestyle, planned 10b5-1 sales). Most are noise. A few are signal — large unscheduled clusters of sales can be worth investigating." },
  { term: "A — Award/Grant", short: "Shares granted (RSU vesting, etc.). Not the insider's own money.", long: "Award or grant of shares — typically RSU vesting, performance shares, or option grants. Not a market decision; the company is just paying compensation in stock." },
  { term: "M — Option Exercise", short: "Insider exercised an option. Often paired with an immediate sale.", long: "Exercise of a previously-granted option. The insider converts options into stock; often immediately sold (code S on the same day) to cover the strike price + taxes." },
  { term: "F — Tax Payment", short: "Shares surrendered to cover tax on vested compensation.", long: "Shares 'sold to cover' the tax owed when a grant vests. Not a market decision." },
  { term: "G — Gift", short: "Shares gifted to a charity, family member, or trust.", long: "Charitable gift, gift to family, or transfer to a trust. Not a market decision but disclosable." },
  { term: "C — Conversion", short: "Conversion of one security type into another (e.g., debt → equity).", long: "Conversion between security types — e.g., convertible debt to common stock." },
];

// Filer category meanings (drives row priority highlighting)
export const FILER_CATEGORIES: GlossaryEntry[] = [
  { term: "activist", short: "13D-filers who actively push for change at the companies they buy. Highest weight signal.", long: "Funds whose strategy is taking 5%+ stakes and then pushing for changes — board seats, capital allocation, strategic alternatives. Their 13D filings are the highest-signal events because they're recent (10-day disclosure), concentrated (5%+ stake), and intentional. Examples: Ackman (Pershing Square), Singer (Elliott), Peltz (Trian)." },
  { term: "value", short: "Long-horizon equity managers who buy what they think is mispriced and hold. Baseline weight.", long: "Long-only fundamental value investors. They buy what they think is underpriced and wait. Slower-moving, but their positions often signal underlying quality. Examples: Buffett (Berkshire), Klarman (Baupost), Watsa (Fairfax)." },
  { term: "concentrated", short: "High-conviction concentrated/contrarian books. Often only 5-15 positions.", long: "Funds that concentrate heavily in a small number of positions. When they buy something it's a strong vote. Examples: Burry (Scion), Bloomstran (Semper Augustus), Kantesaria (Valley Forge)." },
  { term: "growth", short: "Growth/tech-focused funds. Mostly Tiger Cubs.", long: "Funds focused on growth and technology — most are 'Tiger Cubs' trained under Julian Robertson at Tiger Management. Examples: Coleman (Tiger Global), Laffont (Coatue), Mandel (Lone Pine)." },
  { term: "corporate_strategic", short: "Public companies whose strategic investments (8-K + 13D) are signal-bearing.", long: "Public companies whose strategic equity investments matter — different from fund picks. When NVIDIA invests $5B in Intel, it's not 'NVIDIA the smart investor' — it's 'NVIDIA the company saying Intel matters to their roadmap'. Examples: NVIDIA, Microsoft, Alphabet, Amazon, Meta, Apple." },
];

// Direction-column labels meaning
export const DIRECTIONS: GlossaryEntry[] = [
  { term: "NEW", short: "First filing from this filer on this issuer (no prior filing found).", long: "Either a genuinely new position or our first visibility into it (data goes back 3 years). When an activist shows NEW it's most actionable." },
  { term: "INCREASE", short: "Stake grew vs. previous filing. The activist is buying more.", long: "Filer's % ownership went up versus their previous filing on the same company. Suggests they're building the position." },
  { term: "DECREASE", short: "Stake shrunk vs. previous filing. They're trimming or exiting.", long: "Filer's % ownership went down. Could be a trim, profit-taking, or full exit." },
  { term: "AMEND", short: "Stake unchanged within rounding (or % couldn't be extracted).", long: "Filing is an amendment but the percentage didn't materially change. Usually just routine paperwork updates — share counts adjusting for buybacks, periodic refile, etc." },
];

// Helper: look up a form's short text (used for tooltips)
export function formTip(formType: string): string {
  return FORMS[formType]?.short ?? formType;
}
