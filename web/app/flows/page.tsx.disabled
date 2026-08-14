import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
import { ETF_UNIVERSE, type EtfMeta } from "@/lib/etfs";
import { runStalenessChecks } from "@/lib/staleness";

// /flows — sector / theme rotation dashboard.
//
// Reads from etf_metrics (refreshed daily by ingest/etf_metrics.py).
// Flow source: etf_flows_monthly — true monthly creation/redemption from
// SEC DERA's N-PORT bulk dataset, ~3-4 month publish lag.
//
// UI principles (per CLAUDE.md §2):
//  - No advice. Every row reads as "what happened", not "what to do".
//  - Show numbers next to plain-English reading.
//  - Multi-select timeframe pills via URL searchParams (server-rendered).

type Tf = "1m" | "3m" | "6m" | "1y";
const ALL_TFS: Tf[] = ["1m", "3m", "6m", "1y"];
const DEFAULT_TFS: Tf[] = ["1m", "3m"];

type Metric = {
  ticker: string;
  aum_usd: number | null;
  price_return_1m: number | null;
  price_return_3m: number | null;
  price_return_6m: number | null;
  price_return_1y: number | null;
  flow_pct_1m: number | null;
  flow_pct_3m: number | null;
  flow_pct_6m: number | null;
  flow_pct_1y: number | null;
  flow_data_as_of: string | null;
  flow_1m_as_of: string | null;
};

type Row = Metric & {
  meta: EtfMeta;
  theme_group: ThemeGroup;
  source_kind: SourceKind; // freshness tier
};

type SourceKind = "live" | "nport_quarterly" | "nport_dera" | "none";

function classifySource(m: Metric): SourceKind {
  if (!m.flow_data_as_of) return "none";
  const d = m.flow_data_as_of;
  const today = new Date();
  const asOf = new Date(d + "T00:00:00");
  const lagDays = Math.floor((today.getTime() - asOf.getTime()) / 86400000);
  if (lagDays <= 7) return "live";              // issuer-direct daily
  if (lagDays <= 90) return "nport_quarterly";  // public N-PORT filing
  return "nport_dera";                          // DERA bulk dataset
}

const SOURCE_BADGE: Record<SourceKind, { label: string; color: string; explain: string }> = {
  live:            { label: "live",  color: "text-emerald-300 bg-emerald-900/30 border-emerald-700/40", explain: "Daily flow from issuer shares-outstanding × NAV. Fresh to yesterday." },
  nport_quarterly: { label: "~2-3mo", color: "text-amber-300 bg-amber-900/20 border-amber-700/40",       explain: "Back-solved from individual public N-PORT filing (with dividend correction)." },
  nport_dera:      { label: "~4-5mo", color: "text-neutral-400 bg-neutral-900/40 border-neutral-700/40", explain: "SEC DERA bulk N-PORT dataset. Best data we have but most-stale." },
  none:            { label: "no data", color: "text-neutral-500 bg-neutral-900/40 border-neutral-800",   explain: "Doesn't file N-PORT (commodity/crypto trust without issuer feed)." },
};

// ───────────────────────────────────────────────────────────────────────
// Macro theme groupings — cross-cuts category. One group per ticker.
// ───────────────────────────────────────────────────────────────────────
type ThemeGroup = "defensive" | "cyclical" | "growth_long_duration" | "rate_sensitive" | "broad";

const THEME_GROUP: Record<string, ThemeGroup> = {
  XLP: "defensive", XLU: "defensive", XLV: "defensive", XLRE: "defensive", GLD: "defensive",
  XLF: "cyclical", XLI: "cyclical", XLB: "cyclical", XLE: "cyclical", XLY: "cyclical",
  KRE: "cyclical", EEM: "cyclical", EFA: "cyclical", GDX: "cyclical", ITA: "cyclical", XAR: "cyclical",
  XLK: "growth_long_duration", XLC: "growth_long_duration", QQQ: "growth_long_duration",
  IGV: "growth_long_duration", SOXX: "growth_long_duration", SMH: "growth_long_duration",
  BOTZ: "growth_long_duration", IBB: "growth_long_duration", XBI: "growth_long_duration",
  ESPO: "growth_long_duration", ICLN: "growth_long_duration", TAN: "growth_long_duration",
  KWEB: "growth_long_duration", URA: "growth_long_duration", IBIT: "growth_long_duration",
  IEF: "rate_sensitive", TLT: "rate_sensitive",
  SPY: "broad",
};

const THEME_LABEL: Record<ThemeGroup, string> = {
  defensive: "Defensive",
  cyclical: "Cyclical",
  growth_long_duration: "Growth / long-duration",
  rate_sensitive: "Rate-sensitive (bonds)",
  broad: "Broad market",
};

// ───────────────────────────────────────────────────────────────────────
// Formatters
// ───────────────────────────────────────────────────────────────────────
function fmtPct(n: number | null, digits = 1): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
function fmtPriceRet(n: number | null): string {
  if (n == null) return "—";
  return fmtPct(n * 100);
}
function fmtFlow(n: number | null): string {
  return fmtPct(n);
}
function pctColor(n: number | null): string {
  if (n == null) return "text-neutral-500";
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-red-400";
  return "text-neutral-400";
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const TF_LABEL: Record<Tf, string> = { "1m": "1M", "3m": "3M", "6m": "6M", "1y": "1Y" };
function priceFor(r: Row, tf: Tf): number | null {
  return r[`price_return_${tf}` as const];
}
function flowFor(r: Row, tf: Tf): number | null {
  return r[`flow_pct_${tf}` as const];
}

// ───────────────────────────────────────────────────────────────────────
// "So what" reading — one sentence per row. Observational, not advisory.
// ───────────────────────────────────────────────────────────────────────
function reading(r: Row, selected: Tf[]): string {
  const name = r.meta.label;
  const p1m = r.price_return_1m;
  const p3m = r.price_return_3m;
  const p6m = r.price_return_6m;
  const p1y = r.price_return_1y;
  const f1m = r.flow_pct_1m;
  const f3m = r.flow_pct_3m;
  const f6m = r.flow_pct_6m;
  const f1y = r.flow_pct_1y;

  // Pick the "primary" timeframe = shortest selected with both price + flow
  const orderedSelected: Tf[] = (["1m", "3m", "6m", "1y"] as Tf[]).filter((t) => selected.includes(t));
  const primary = orderedSelected.find((t) => priceFor(r, t) != null && flowFor(r, t) != null) ?? "3m";

  const p = priceFor(r, primary);
  const f = flowFor(r, primary);

  if (p == null && f == null) return `${name} — no data.`;

  // Special pattern: flow direction flipped recently
  if (f1m != null && f6m != null) {
    if (f1m > 1 && f6m < -1) {
      return `${name} — money has rotated IN over the last month (${fmtFlow(f1m)}) after pulling out over 6M (${fmtFlow(f6m)}). Direction has flipped.`;
    }
    if (f1m < -1 && f6m > 1) {
      return `${name} — money has rotated OUT over the last month (${fmtFlow(f1m)}) after flowing in over 6M (${fmtFlow(f6m)}). Direction has flipped.`;
    }
  }

  // Crowded warning — very strong price + heavy fresh inflow
  if (p6m != null && p3m != null && f1m != null && p6m > 0.20 && p3m > 0.10 && f1m > 3) {
    return `${name} — price ${fmtPriceRet(p6m)} over 6M and ${fmtPriceRet(p3m)} over 3M with ${fmtFlow(f1m)} fresh inflow. Late-cycle: reward asymmetric to risk.`;
  }

  // Confirmed leader — positive price + positive flow at primary TF + supportive 1Y
  if (p != null && f != null && p > 0.02 && f > 1 && (p1y ?? 0) > 0.05) {
    return `${name} — price ${fmtPriceRet(p)} and money continuing to flow in (${fmtFlow(f)}) over ${TF_LABEL[primary]}. Trend intact across multiple timeframes.`;
  }

  // Distribution — price up but flow leaving
  if (p != null && f != null && p > 0.02 && f < -1) {
    return `${name} — price ${fmtPriceRet(p)} over ${TF_LABEL[primary]} but ${fmtFlow(f)} flow out. Money taking profits while price holds.`;
  }

  // Accumulation — price down but flow in
  if (p != null && f != null && p < -0.02 && f > 1) {
    return `${name} — price ${fmtPriceRet(p)} over ${TF_LABEL[primary]} but ${fmtFlow(f)} flow in. Buyers active on the weakness.`;
  }

  // Capitulation — both down
  if (p != null && f != null && p < -0.02 && f < -1) {
    return `${name} — price ${fmtPriceRet(p)} and ${fmtFlow(f)} flow over ${TF_LABEL[primary]}. Both price and money leaving in the same direction.`;
  }

  // Fading: price still up but flow decelerating noticeably
  if (p != null && f3m != null && f6m != null && p > 0.02 && f3m < f6m - 3 && f3m < 2) {
    return `${name} — price ${fmtPriceRet(p)} over ${TF_LABEL[primary]} but flow decelerating (3M ${fmtFlow(f3m)} vs 6M ${fmtFlow(f6m)}). Trend losing fuel.`;
  }

  // Price story only (no flow data — GLD/IBIT)
  if (f1m == null && f3m == null && f6m == null && p1y != null) {
    return `${name} — price ${fmtPriceRet(p1y)} over 1Y. No SEC N-PORT flow data (not an N-PORT-filing fund).`;
  }

  // Mild / neutral
  return `${name} — small moves on both sides over ${TF_LABEL[primary]} (price ${fmtPriceRet(p)}, flow ${fmtFlow(f)}). Nothing strong to read.`;
}

// ───────────────────────────────────────────────────────────────────────
// Top insight cards
// ───────────────────────────────────────────────────────────────────────
type InsightCard = { title: string; body: string; tone: "positive" | "warning" | "neutral" };

function buildInsights(rows: Row[]): InsightCard[] {
  const out: InsightCard[] = [];

  // 1) Strongest fresh inflow (1M)
  const top1m = [...rows]
    .filter((r) => r.flow_pct_1m != null)
    .sort((a, b) => (b.flow_pct_1m as number) - (a.flow_pct_1m as number))[0];
  if (top1m && (top1m.flow_pct_1m as number) > 3) {
    out.push({
      title: "Strongest fresh inflow (1M)",
      body: `${top1m.meta.label} (${top1m.meta.ticker}) — ${fmtFlow(top1m.flow_pct_1m)} of fund in the last month. Price: ${fmtPriceRet(top1m.price_return_1m)}.`,
      tone: "positive",
    });
  }

  // 2) Strongest fresh outflow (1M)
  const bot1m = [...rows]
    .filter((r) => r.flow_pct_1m != null)
    .sort((a, b) => (a.flow_pct_1m as number) - (b.flow_pct_1m as number))[0];
  if (bot1m && (bot1m.flow_pct_1m as number) < -2) {
    out.push({
      title: "Strongest outflow (1M)",
      body: `${bot1m.meta.label} (${bot1m.meta.ticker}) — ${fmtFlow(bot1m.flow_pct_1m)} of fund pulled out. Price: ${fmtPriceRet(bot1m.price_return_1m)}.`,
      tone: "warning",
    });
  }

  // 3) Biggest flow flip — sign change between 6M and 1M
  const flippedIn = rows
    .filter((r) => r.flow_pct_1m != null && r.flow_pct_6m != null && (r.flow_pct_1m as number) > 1 && (r.flow_pct_6m as number) < -1)
    .sort((a, b) => (a.flow_pct_6m as number) - (b.flow_pct_6m as number))[0];
  if (flippedIn) {
    out.push({
      title: "Flow direction flipped IN",
      body: `${flippedIn.meta.label} (${flippedIn.meta.ticker}) — was bleeding ${fmtFlow(flippedIn.flow_pct_6m)} over 6M, now ${fmtFlow(flippedIn.flow_pct_1m)} in last month.`,
      tone: "positive",
    });
  }

  const flippedOut = rows
    .filter((r) => r.flow_pct_1m != null && r.flow_pct_6m != null && (r.flow_pct_1m as number) < -1 && (r.flow_pct_6m as number) > 1)
    .sort((a, b) => (b.flow_pct_6m as number) - (a.flow_pct_6m as number))[0];
  if (flippedOut) {
    out.push({
      title: "Flow direction flipped OUT",
      body: `${flippedOut.meta.label} (${flippedOut.meta.ticker}) — was attracting ${fmtFlow(flippedOut.flow_pct_6m)} over 6M, now ${fmtFlow(flippedOut.flow_pct_1m)} in last month.`,
      tone: "warning",
    });
  }

  // 4) Distribution — strongest price-up + flow-out divergence at 1M
  const dist = rows
    .filter((r) => r.price_return_1m != null && r.flow_pct_1m != null && (r.price_return_1m as number) > 0.03 && (r.flow_pct_1m as number) < -1)
    .sort((a, b) => (a.flow_pct_1m as number) - (b.flow_pct_1m as number))[0];
  if (dist) {
    out.push({
      title: "Distribution (price up, money leaving)",
      body: `${dist.meta.label} (${dist.meta.ticker}) — price ${fmtPriceRet(dist.price_return_1m)} but ${fmtFlow(dist.flow_pct_1m)} flow out over 1M.`,
      tone: "warning",
    });
  }

  // 5) Accumulation — price down + flow in
  const acc = rows
    .filter((r) => r.price_return_1m != null && r.flow_pct_1m != null && (r.price_return_1m as number) < -0.03 && (r.flow_pct_1m as number) > 1)
    .sort((a, b) => (b.flow_pct_1m as number) - (a.flow_pct_1m as number))[0];
  if (acc) {
    out.push({
      title: "Accumulation (price down, money in)",
      body: `${acc.meta.label} (${acc.meta.ticker}) — price ${fmtPriceRet(acc.price_return_1m)} but ${fmtFlow(acc.flow_pct_1m)} flow in over 1M.`,
      tone: "positive",
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Sector rotation matrix (3M view)
// ───────────────────────────────────────────────────────────────────────
function RotationMatrix({ rows }: { rows: Row[] }) {
  const points = rows
    .filter((r) => r.price_return_3m != null && r.flow_pct_3m != null)
    .map((r) => ({
      ticker: r.meta.ticker,
      x: (r.price_return_3m as number) * 100,
      y: r.flow_pct_3m as number,
    }));

  if (points.length === 0) {
    return (
      <div className="rounded-md border border-neutral-800 p-6 text-sm text-neutral-500">
        No 3M flow data available.
      </div>
    );
  }

  const maxX = Math.max(15, ...points.map((p) => Math.abs(p.x)));
  const maxY = Math.max(15, ...points.map((p) => Math.abs(p.y)));
  const W = 700, H = 460, PAD = 56;
  const sx = (x: number) => PAD + ((x + maxX) / (2 * maxX)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y + maxY) / (2 * maxY)) * (H - 2 * PAD);

  return (
    <div className="rounded-md border border-neutral-800 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Subtle quadrant tints (existing) */}
        <rect x={sx(0)} y={PAD} width={W - PAD - sx(0)} height={sy(0) - PAD} fill="rgb(6 78 59 / 0.20)" />
        <rect x={PAD} y={PAD} width={sx(0) - PAD} height={sy(0) - PAD} fill="rgb(2 132 199 / 0.18)" />
        <rect x={sx(0)} y={sy(0)} width={W - PAD - sx(0)} height={H - PAD - sy(0)} fill="rgb(180 83 9 / 0.18)" />
        <rect x={PAD} y={sy(0)} width={sx(0) - PAD} height={H - PAD - sy(0)} fill="rgb(127 29 29 / 0.18)" />

        {/* BUY ZONE — Accumulation quadrant (top-left): price ↓, flow ↑ */}
        <rect
          x={PAD} y={PAD}
          width={sx(0) - PAD} height={sy(0) - PAD}
          fill="none"
          stroke="rgb(110 231 183)" strokeWidth={2} strokeDasharray="6 4"
          opacity={0.7}
        />
        <text
          x={(PAD + sx(0)) / 2} y={(PAD + sy(0)) / 2}
          textAnchor="middle"
          className="fill-emerald-200/40"
          fontSize="42"
          fontWeight="700"
          letterSpacing="3"
        >
          BUY
        </text>

        {/* SELL ZONE — Distribution quadrant (bottom-right): price ↑, flow ↓ */}
        <rect
          x={sx(0)} y={sy(0)}
          width={W - PAD - sx(0)} height={H - PAD - sy(0)}
          fill="none"
          stroke="rgb(252 165 165)" strokeWidth={2} strokeDasharray="6 4"
          opacity={0.7}
        />
        <text
          x={(sx(0) + W - PAD) / 2} y={(sy(0) + H - PAD) / 2 + 14}
          textAnchor="middle"
          className="fill-red-200/40"
          fontSize="42"
          fontWeight="700"
          letterSpacing="3"
        >
          SELL
        </text>

        {/* Axes */}
        <line x1={PAD} y1={sy(0)} x2={W - PAD} y2={sy(0)} stroke="rgb(82 82 82)" strokeWidth={1} />
        <line x1={sx(0)} y1={PAD} x2={sx(0)} y2={H - PAD} stroke="rgb(82 82 82)" strokeWidth={1} />

        {/* Quadrant labels — kept for clarity */}
        <text x={W - PAD - 8} y={PAD + 14} textAnchor="end" className="fill-emerald-300/80" fontSize="11">Leaders (price ↑ flow ↑)</text>
        <text x={PAD + 8} y={PAD + 14} className="fill-sky-300/80" fontSize="11">Accumulation (price ↓ flow ↑)</text>
        <text x={W - PAD - 8} y={H - PAD - 6} textAnchor="end" className="fill-amber-300/80" fontSize="11">Distribution (price ↑ flow ↓)</text>
        <text x={PAD + 8} y={H - PAD - 6} className="fill-red-300/80" fontSize="11">Avoid (price ↓ flow ↓)</text>
        <text x={W / 2} y={H - 14} textAnchor="middle" className="fill-neutral-400" fontSize="11">3-month price return</text>
        <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="fill-neutral-400" fontSize="11">3-month flow % of AUM</text>
        <text x={PAD - 4} y={sy(0) + 4} textAnchor="end" className="fill-neutral-500" fontSize="10">{(-maxX).toFixed(0)}%</text>
        <text x={W - PAD + 4} y={sy(0) + 4} className="fill-neutral-500" fontSize="10">+{maxX.toFixed(0)}%</text>
        <text x={sx(0) + 4} y={PAD - 4} className="fill-neutral-500" fontSize="10">+{maxY.toFixed(0)}%</text>
        <text x={sx(0) + 4} y={H - PAD + 12} className="fill-neutral-500" fontSize="10">{(-maxY).toFixed(0)}%</text>
        {points.map((p) => {
          const fill = p.x > 0 && p.y > 0 ? "rgb(110 231 183)"
                     : p.x > 0 && p.y < 0 ? "rgb(252 211 77)"
                     : p.x < 0 && p.y > 0 ? "rgb(125 211 252)"
                     :                      "rgb(248 113 113)";
          return (
            <g key={p.ticker}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill={fill} fillOpacity={0.85} />
              <text x={sx(p.x) + 7} y={sy(p.y) + 4} className="fill-neutral-200" fontSize="10">{p.ticker}</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-3 text-xs text-neutral-500">
        Each dot is one ETF. Position = 3M price return × 3M flow %.{" "}
        <span className="text-emerald-300">BUY zone</span> (top-left, dashed green): price down but money flowing in — smart-money accumulation on weakness.{" "}
        <span className="text-red-300">SELL zone</span> (bottom-right, dashed red): price up but money leaving — distribution.{" "}
        Top-right is the trend-following Leaders quadrant — strong but watch for late-stage crowding; bottom-left is sustained outflow.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Timeframe pills — multi-select via URL searchParams
// ───────────────────────────────────────────────────────────────────────
function TfPills({ selected }: { selected: Tf[] }) {
  function toggleHref(tf: Tf): string {
    const has = selected.includes(tf);
    let next: Tf[];
    if (has) next = selected.filter((t) => t !== tf);
    else next = [...selected, tf];
    // Keep canonical order
    next = ALL_TFS.filter((t) => next.includes(t));
    if (next.length === 0) next = [tf]; // never leave all unselected
    const param = next.join(",");
    // If we'd reset to default, drop the param for a clean URL
    if (next.length === DEFAULT_TFS.length && DEFAULT_TFS.every((t) => next.includes(t))) {
      return "/flows";
    }
    return `/flows?tf=${param}`;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs uppercase tracking-wider text-neutral-500">Timeframes:</span>
      {ALL_TFS.map((tf) => {
        const active = selected.includes(tf);
        return (
          <Link
            key={tf}
            href={toggleHref(tf)}
            scroll={false}
            className={
              "px-3 py-1 rounded-md text-xs font-medium border transition-colors " +
              (active
                ? "bg-emerald-900/40 border-emerald-700/60 text-emerald-200"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300")
            }
          >
            {TF_LABEL[tf]}
          </Link>
        );
      })}
      <span className="ml-2 text-xs text-neutral-600">click to toggle</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Data fetch
// ───────────────────────────────────────────────────────────────────────
async function fetchMetrics(): Promise<Metric[]> {
  const sb = supabaseServer();
  const { data, error } = await sb.from("etf_metrics").select("*");
  if (error) throw error;
  return (data as Metric[]) ?? [];
}

function buildRows(metrics: Metric[]): Row[] {
  const byTicker = new Map(metrics.map((m) => [m.ticker, m]));
  const rows: Row[] = [];
  for (const meta of ETF_UNIVERSE) {
    const m = byTicker.get(meta.ticker);
    if (!m) {
      const empty: Metric = {
        ticker: meta.ticker, aum_usd: null,
        price_return_1m: null, price_return_3m: null, price_return_6m: null, price_return_1y: null,
        flow_pct_1m: null, flow_pct_3m: null, flow_pct_6m: null, flow_pct_1y: null,
        flow_data_as_of: null, flow_1m_as_of: null,
      };
      rows.push({ ...empty, meta, theme_group: THEME_GROUP[meta.ticker] ?? "broad", source_kind: "none" });
      continue;
    }
    rows.push({ ...m, meta, theme_group: THEME_GROUP[meta.ticker] ?? "broad", source_kind: classifySource(m) });
  }
  return rows;
}

function parseTfs(raw: string | string[] | undefined): Tf[] {
  if (!raw) return DEFAULT_TFS;
  const s = Array.isArray(raw) ? raw.join(",") : raw;
  const parts = s.split(",").map((p) => p.trim().toLowerCase()) as Tf[];
  const valid = parts.filter((p): p is Tf => (ALL_TFS as string[]).includes(p));
  return valid.length > 0 ? ALL_TFS.filter((t) => valid.includes(t)) : DEFAULT_TFS;
}

// ───────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────
export default async function FlowsPage({
  searchParams,
}: {
  searchParams: Promise<{ tf?: string | string[] }>;
}) {
  const sp = await searchParams;
  const selected = parseTfs(sp.tf);
  const [metrics, staleness] = await Promise.all([fetchMetrics(), runStalenessChecks()]);
  const rows = buildRows(metrics);
  const insights = buildInsights(rows);
  const stalenessIssues = staleness.filter((s) => !s.ok);

  // Group by theme
  const themeOrder: ThemeGroup[] = ["broad", "growth_long_duration", "cyclical", "defensive", "rate_sensitive"];
  const byTheme = new Map<ThemeGroup, Row[]>();
  for (const g of themeOrder) byTheme.set(g, []);
  for (const r of rows) byTheme.get(r.theme_group)!.push(r);
  for (const arr of byTheme.values()) {
    // Sort by 1M flow desc within each group (nulls last)
    arr.sort((a, b) => (b.flow_pct_1m ?? -Infinity) - (a.flow_pct_1m ?? -Infinity));
  }

  // Money rotating IN: 1M flow > +2% AND 1M flow > 6M flow (recent acceleration up)
  const rotatingIn = rows
    .filter((r) => r.flow_pct_1m != null && r.flow_pct_6m != null && (r.flow_pct_1m as number) > 2 && (r.flow_pct_1m as number) > (r.flow_pct_6m as number))
    .sort((a, b) => (b.flow_pct_1m as number) - (a.flow_pct_1m as number))
    .slice(0, 8);

  // Money rotating OUT: 1M flow < -1.5% AND 1M flow < 6M flow
  const rotatingOut = rows
    .filter((r) => r.flow_pct_1m != null && r.flow_pct_6m != null && (r.flow_pct_1m as number) < -1.5 && (r.flow_pct_1m as number) < (r.flow_pct_6m as number))
    .sort((a, b) => (a.flow_pct_1m as number) - (b.flow_pct_1m as number))
    .slice(0, 8);

  // Latest flow as-of for footer
  const asOfDates = rows.map((r) => r.flow_data_as_of).filter((d): d is string => !!d).sort();
  const latestAsOf = asOfDates[asOfDates.length - 1] ?? null;
  const earliestAsOf = asOfDates[0] ?? null;

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flows — sector & theme rotation</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Real monthly creation/redemption flow from SEC N-PORT, paired with daily price returns. Pick which timeframes to show.
          </p>
        </div>

        <div className="rounded-md border border-amber-700/40 bg-amber-950/20 p-3 text-xs leading-relaxed">
          <span className="text-amber-200 font-medium">Flow ≠ price.</span>{" "}
          <span className="text-neutral-300">A fund&apos;s price can rise while money leaves it (people taking profits) and fall while money flows in (people buying the dip). The disagreement is often the signal — that&apos;s why both columns are shown.</span>
        </div>

        {/* STALENESS BANNER — fires loud when any ingest pipeline stops updating */}
        {stalenessIssues.length > 0 && (
          <div className="rounded-md border border-red-700/60 bg-red-950/30 p-3 text-xs">
            <div className="font-medium text-red-200 mb-1.5">⚠ Ingest pipeline appears stale</div>
            <ul className="space-y-0.5 text-neutral-200">
              {stalenessIssues.map((s) => (
                <li key={s.source}>
                  <span className="font-mono text-red-300">{s.source}</span>:{" "}
                  {s.latest
                    ? <>latest data is <span className="font-medium">{s.latest}</span> ({s.age_days}d old, expected ≤ {s.threshold_days}d)</>
                    : <>no data at all</>}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-neutral-400">Check <code className="text-neutral-300">/tmp/etf_ingest_YYYYMMDD.log</code> or run <code className="text-neutral-300">scripts/daily_ingest.sh</code> manually.</p>
          </div>
        )}
      </header>

      {/* ─── INSIGHT CARDS ─── */}
      {insights.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">What&apos;s moving</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {insights.map((c, i) => {
              const border = c.tone === "positive" ? "border-emerald-800/60"
                          : c.tone === "warning"  ? "border-amber-800/60"
                          :                          "border-neutral-800";
              const titleColor = c.tone === "positive" ? "text-emerald-300"
                              : c.tone === "warning"  ? "text-amber-300"
                              :                          "text-neutral-300";
              return (
                <div key={i} className={`rounded-md border ${border} p-3`}>
                  <div className={`text-xs font-medium uppercase tracking-wide ${titleColor}`}>{c.title}</div>
                  <div className="mt-1 text-sm text-neutral-200">{c.body}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── SECTOR ROTATION MATRIX ─── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">Sector rotation matrix — 3M view</h2>
        <RotationMatrix rows={rows} />
      </section>

      {/* ─── MONEY ROTATING IN / OUT ─── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-emerald-300 mb-3">Money rotating IN</h2>
          <p className="text-xs text-neutral-500 mb-2">1M flow positive and accelerating vs the 6M baseline.</p>
          <div className="rounded-md border border-emerald-900/40">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">ETF</th>
                  <th className="px-3 py-2 font-medium text-right">1M flow</th>
                  <th className="px-3 py-2 font-medium text-right">6M flow</th>
                  <th className="px-3 py-2 font-medium text-right">1M price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {rotatingIn.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-neutral-500 text-xs">No ETFs meet the rotating-in criteria right now.</td></tr>
                )}
                {rotatingIn.map((r) => (
                  <tr key={r.ticker}>
                    <td className="px-3 py-2">
                      <span className="text-neutral-100">{r.meta.label}</span>{" "}
                      <span className="text-xs text-neutral-500 font-mono">({r.ticker})</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.flow_pct_1m)}`}>{fmtFlow(r.flow_pct_1m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.flow_pct_6m)}`}>{fmtFlow(r.flow_pct_6m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.price_return_1m)}`}>{fmtPriceRet(r.price_return_1m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-red-300 mb-3">Money rotating OUT</h2>
          <p className="text-xs text-neutral-500 mb-2">1M flow negative and accelerating vs the 6M baseline.</p>
          <div className="rounded-md border border-red-900/40">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">ETF</th>
                  <th className="px-3 py-2 font-medium text-right">1M flow</th>
                  <th className="px-3 py-2 font-medium text-right">6M flow</th>
                  <th className="px-3 py-2 font-medium text-right">1M price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {rotatingOut.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-neutral-500 text-xs">No ETFs meet the rotating-out criteria right now.</td></tr>
                )}
                {rotatingOut.map((r) => (
                  <tr key={r.ticker}>
                    <td className="px-3 py-2">
                      <span className="text-neutral-100">{r.meta.label}</span>{" "}
                      <span className="text-xs text-neutral-500 font-mono">({r.ticker})</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.flow_pct_1m)}`}>{fmtFlow(r.flow_pct_1m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.flow_pct_6m)}`}>{fmtFlow(r.flow_pct_6m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.price_return_1m)}`}>{fmtPriceRet(r.price_return_1m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── MULTI-TIMEFRAME TABLE (with reading column) ─── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400 mb-3">
          All ETFs — price + flow + reading
        </h2>
        <div className="mb-3">
          <TfPills selected={selected} />
        </div>
        <p className="text-xs text-neutral-500 mb-2">
          Showing {selected.map((t) => TF_LABEL[t]).join(" + ")}.
        </p>
        <div className="rounded-md border border-neutral-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th rowSpan={2} className="px-3 py-2 font-medium border-r border-neutral-800 align-bottom">ETF</th>
                <th rowSpan={2} className="px-3 py-2 font-medium border-r border-neutral-800 align-bottom" title="Flow data freshness">Source</th>
                {selected.length > 0 && (
                  <>
                    <th colSpan={selected.length} className="px-3 py-1 font-medium text-center border-r border-neutral-800 border-b border-neutral-800">Price return</th>
                    <th colSpan={selected.length} className="px-3 py-1 font-medium text-center border-r border-neutral-800 border-b border-neutral-800">Flow % of AUM</th>
                  </>
                )}
                <th rowSpan={2} className="px-3 py-2 font-medium align-bottom">Reading</th>
              </tr>
              <tr>
                {selected.map((tf) => (
                  <th key={`p-${tf}`} className="px-3 py-1 font-medium text-right">{TF_LABEL[tf]}</th>
                ))}
                {selected.map((tf, i) => (
                  <th key={`f-${tf}`} className={`px-3 py-1 font-medium text-right ${i === selected.length - 1 ? "border-r border-neutral-800" : ""}`}>{TF_LABEL[tf]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {themeOrder.flatMap((g) => {
                const groupRows = byTheme.get(g) ?? [];
                if (groupRows.length === 0) return [];
                return [
                  <tr key={`hdr-${g}`} className="bg-neutral-950/80">
                    <td colSpan={3 + 2 * selected.length} className="px-3 py-1.5 text-xs uppercase tracking-wider text-neutral-500 border-t border-neutral-800">
                      {THEME_LABEL[g]}
                    </td>
                  </tr>,
                  ...groupRows.map((r) => {
                    const badge = SOURCE_BADGE[r.source_kind];
                    return (
                    <tr key={r.ticker} className="hover:bg-neutral-900/40 border-t border-neutral-900">
                      <td className="px-3 py-2 border-r border-neutral-900 whitespace-nowrap">
                        <div className="text-neutral-100">{r.meta.label}</div>
                        <div className="text-xs text-neutral-500 font-mono">{r.ticker}</div>
                      </td>
                      <td className="px-3 py-2 border-r border-neutral-900 whitespace-nowrap" title={`${badge.explain}${r.flow_data_as_of ? `\nAs of: ${r.flow_data_as_of}` : ""}`}>
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${badge.color}`}>
                          {badge.label}
                        </span>
                        {r.flow_data_as_of && (
                          <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">{r.flow_data_as_of}</div>
                        )}
                      </td>
                      {selected.map((tf) => (
                        <td key={`p-${tf}`} className={`px-3 py-2 text-right tabular-nums ${pctColor(priceFor(r, tf))}`}>
                          {fmtPriceRet(priceFor(r, tf))}
                        </td>
                      ))}
                      {selected.map((tf, i) => (
                        <td key={`f-${tf}`} className={`px-3 py-2 text-right tabular-nums ${pctColor(flowFor(r, tf))} ${i === selected.length - 1 ? "border-r border-neutral-900" : ""}`}>
                          {fmtFlow(flowFor(r, tf))}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-xs text-neutral-300 leading-snug">
                        {reading(r, selected)}
                      </td>
                    </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-xs text-neutral-500 pt-4 border-t border-neutral-900 space-y-2">
        <p>
          <span className="text-emerald-300 font-medium">live</span> = daily flow computed from issuer&apos;s shares-outstanding × NAV, fresh to yesterday. Currently the 10 iShares ETFs (TLT, IEF, IGV, SOXX, EEM, EFA, IBB, ITA, ICLN, IBIT). Same calculation etf.com / Bloomberg use.
        </p>
        <p>
          <span className="text-amber-300 font-medium">~2-3mo</span> = back-solved from individual public N-PORT filing (with dividend-bias correction), 60-90 day filing lag.
        </p>
        <p>
          <span className="text-neutral-400 font-medium">~4-5mo</span> = SEC DERA bulk N-PORT dataset (authoritative monthly sales-redemption), 1-quarter publish lag. Fallback for ETFs not yet covered by an issuer-direct feed.
        </p>
        <p>
          Newest flow data across the universe: <span className="text-neutral-300">{fmtDate(latestAsOf)}</span>. Oldest most-recent: <span className="text-neutral-300">{fmtDate(earliestAsOf)}</span>. Price returns from yfinance daily close. GLD doesn&apos;t file N-PORT (commodity trust) and has no issuer feed yet — price only.
        </p>
      </footer>
    </div>
  );
}
