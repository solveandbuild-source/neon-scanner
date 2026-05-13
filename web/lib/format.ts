// Human-readable form type labels. Source-of-truth is filings_raw.form_type.

const LABELS: Record<string, string> = {
  "13F-HR": "13F holdings",
  "13F-HR/A": "13F amendment",
  "SC 13D": "13D activist stake",
  "SC 13D/A": "13D amendment",
  "SC 13G": "13G passive 5%+",
  "SC 13G/A": "13G amendment",
  "4": "Form 4 insider",
  "4/A": "Form 4 amendment",
};

export function formLabel(t: string): string {
  return LABELS[t] ?? t;
}

export function shortDate(iso: string): string {
  // iso is "YYYY-MM-DDT..." — just slice
  return iso.slice(0, 10);
}

export function daysAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
