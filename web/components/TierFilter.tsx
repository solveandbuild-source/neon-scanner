"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useTransition } from "react";

// Client-side tier filter — checkboxes write to ?tier=S,A,B,C in the URL
// and trigger a server re-render of the parent page with the new filter.
// Holding page reads the searchParam and filters the filers list before
// rendering. Empty param = all tiers visible (default).

const ALL_TIERS = ["S", "A", "B", "C"] as const;
type Tier = (typeof ALL_TIERS)[number];

const TIER_CHIP: Record<Tier, string> = {
  S: "bg-emerald-600/30 text-emerald-300 border border-emerald-700/50",
  A: "bg-sky-600/30 text-sky-300 border border-sky-700/50",
  B: "bg-neutral-800 text-neutral-400 border border-neutral-700",
  C: "bg-neutral-800 text-neutral-500 border border-neutral-700",
};

export function TierFilter({ counts }: { counts: Record<Tier, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Parse current selection from URL. Missing param = all selected.
  const raw = searchParams.get("tier");
  const selected: Set<Tier> = raw
    ? new Set(raw.split(",").filter((t): t is Tier => (ALL_TIERS as readonly string[]).includes(t)))
    : new Set(ALL_TIERS);

  const toggle = useCallback(
    (t: Tier) => {
      const next = new Set(selected);
      if (next.has(t)) next.delete(t);
      else next.add(t);

      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next.size === 0 || next.size === ALL_TIERS.length) {
        params.delete("tier");
      } else {
        params.set("tier", Array.from(next).sort().join(","));
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [selected, searchParams, pathname, router],
  );

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-neutral-500 shrink-0">Tier:</span>
      {ALL_TIERS.map((t) => {
        const isOn = selected.has(t);
        return (
          <label
            key={t}
            className={`inline-flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded border transition-opacity ${
              isOn ? "opacity-100" : "opacity-40 hover:opacity-70"
            } ${TIER_CHIP[t]}`}
          >
            <input
              type="checkbox"
              checked={isOn}
              onChange={() => toggle(t)}
              className="accent-current w-3 h-3"
              disabled={pending}
            />
            <span className="font-mono">{t}</span>
            <span className="text-neutral-500">({counts[t] ?? 0})</span>
          </label>
        );
      })}
      {pending && <span className="text-neutral-500 italic">…</span>}
    </div>
  );
}
