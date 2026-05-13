// ETF metadata — mirror of config/etf_universe.yml.
// Used by /flows page to group + label tickers. When YAML changes, update here.

export type EtfCategory = "cross_asset" | "us_sector" | "theme";
export type EtfSubtype =
  | "equity"
  | "bonds"
  | "commodity"
  | "crypto"
  | "foreign_equity"
  | "ai"
  | "healthcare"
  | "defense"
  | "consumer"
  | "energy_transition"
  | "foreign"
  | "nuclear"
  | "financials"
  | "us_sector"
  | null;

export type EtfMeta = {
  ticker: string;
  label: string;
  category: EtfCategory;
  subtype: EtfSubtype;
  long_name: string;
};

export const ETF_UNIVERSE: EtfMeta[] = [
  // cross-asset
  { ticker: "SPY", label: "US Equities (broad)", category: "cross_asset", subtype: "equity", long_name: "SPDR S&P 500 ETF" },
  { ticker: "QQQ", label: "US Tech (Nasdaq-100)", category: "cross_asset", subtype: "equity", long_name: "Invesco QQQ Trust" },
  { ticker: "IEF", label: "US Treasuries (7-10y)", category: "cross_asset", subtype: "bonds", long_name: "iShares 7-10 Year Treasury Bond ETF" },
  { ticker: "TLT", label: "US Treasuries (20y+)", category: "cross_asset", subtype: "bonds", long_name: "iShares 20+ Year Treasury Bond ETF" },
  { ticker: "GLD", label: "Gold", category: "cross_asset", subtype: "commodity", long_name: "SPDR Gold Shares" },
  { ticker: "IBIT", label: "Bitcoin", category: "cross_asset", subtype: "crypto", long_name: "iShares Bitcoin Trust" },
  { ticker: "EFA", label: "International Developed", category: "cross_asset", subtype: "foreign_equity", long_name: "iShares MSCI EAFE ETF" },
  { ticker: "EEM", label: "Emerging Markets", category: "cross_asset", subtype: "foreign_equity", long_name: "iShares MSCI Emerging Markets ETF" },

  // us sectors
  { ticker: "XLK", label: "Technology", category: "us_sector", subtype: "us_sector", long_name: "Technology Select Sector SPDR" },
  { ticker: "XLV", label: "Health Care", category: "us_sector", subtype: "us_sector", long_name: "Health Care Select Sector SPDR" },
  { ticker: "XLF", label: "Financials", category: "us_sector", subtype: "us_sector", long_name: "Financial Select Sector SPDR" },
  { ticker: "XLE", label: "Energy", category: "us_sector", subtype: "us_sector", long_name: "Energy Select Sector SPDR" },
  { ticker: "XLI", label: "Industrials", category: "us_sector", subtype: "us_sector", long_name: "Industrial Select Sector SPDR" },
  { ticker: "XLY", label: "Consumer Discretionary", category: "us_sector", subtype: "us_sector", long_name: "Consumer Discretionary Select Sector SPDR" },
  { ticker: "XLP", label: "Consumer Staples", category: "us_sector", subtype: "us_sector", long_name: "Consumer Staples Select Sector SPDR" },
  { ticker: "XLU", label: "Utilities", category: "us_sector", subtype: "us_sector", long_name: "Utilities Select Sector SPDR" },
  { ticker: "XLB", label: "Materials", category: "us_sector", subtype: "us_sector", long_name: "Materials Select Sector SPDR" },
  { ticker: "XLRE", label: "Real Estate", category: "us_sector", subtype: "us_sector", long_name: "Real Estate Select Sector SPDR" },
  { ticker: "XLC", label: "Comm. Services", category: "us_sector", subtype: "us_sector", long_name: "Communication Services Select Sector SPDR" },

  // themes
  { ticker: "SOXX", label: "Semiconductors", category: "theme", subtype: "ai", long_name: "iShares Semiconductor ETF" },
  { ticker: "SMH", label: "Semis (alt)", category: "theme", subtype: "ai", long_name: "VanEck Semiconductor ETF" },
  { ticker: "IGV", label: "Software", category: "theme", subtype: "ai", long_name: "iShares Expanded Tech-Software Sector ETF" },
  { ticker: "BOTZ", label: "Robotics & AI", category: "theme", subtype: "ai", long_name: "Global X Robotics & AI ETF" },
  { ticker: "XBI", label: "Biotech", category: "theme", subtype: "healthcare", long_name: "SPDR S&P Biotech ETF" },
  { ticker: "IBB", label: "Biotech (alt)", category: "theme", subtype: "healthcare", long_name: "iShares Biotechnology ETF" },
  { ticker: "ITA", label: "Defense", category: "theme", subtype: "defense", long_name: "iShares U.S. Aerospace & Defense ETF" },
  { ticker: "XAR", label: "Defense (alt)", category: "theme", subtype: "defense", long_name: "SPDR S&P Aerospace & Defense ETF" },
  { ticker: "ESPO", label: "Video Gaming", category: "theme", subtype: "consumer", long_name: "VanEck Video Gaming & eSports ETF" },
  { ticker: "ICLN", label: "Clean Energy", category: "theme", subtype: "energy_transition", long_name: "iShares Global Clean Energy ETF" },
  { ticker: "TAN", label: "Solar", category: "theme", subtype: "energy_transition", long_name: "Invesco Solar ETF" },
  { ticker: "KWEB", label: "China Internet", category: "theme", subtype: "foreign", long_name: "KraneShares CSI China Internet ETF" },
  { ticker: "URA", label: "Uranium", category: "theme", subtype: "nuclear", long_name: "Global X Uranium ETF" },
  { ticker: "GDX", label: "Gold Miners", category: "theme", subtype: "commodity", long_name: "VanEck Gold Miners ETF" },
  { ticker: "KRE", label: "Regional Banks", category: "theme", subtype: "financials", long_name: "SPDR S&P Regional Banking ETF" },
];

const BY_TICKER = new Map(ETF_UNIVERSE.map((e) => [e.ticker, e]));
export function etfMeta(ticker: string): EtfMeta | null {
  return BY_TICKER.get(ticker) ?? null;
}
