"use client";

import { useEffect, useState, useCallback } from "react";

// S/A/B/C tier filter for /holdings.
//
// Architecture choice (May 2026): all cards render server-side with a
// data-tier attribute. This client component manages selected state +
// imperatively toggles `.hidden` on card elements via DOM. Avoids the
// Next.js 16 router.push() + useSearchParams reactivity gotcha that
// kept the checkboxes from updating. Also instant — no server roundtrip
// per toggle.
//
// URL sync via window.history.replaceState so the selection is
// bookmarkable + survives back/forward, without re-rendering the page.

const ALL_TIERS = ["S", "A", "B", "C"] as const;
type Tier = (typeof ALL_TIERS)[number];

const TIER_CHIP: Record<Tier, string> = {
  S: "bg-emerald-600/30 text-emerald-300 border border-emerald-700/50",
  A: "bg-sky-600/30 text-sky-300 border border-sky-700/50",
  B: "bg-neutral-800 text-neutral-400 border border-neutral-700",
  C: "bg-neutral-800 text-neutral-500 border border-neutral-700",
};

function parseFromURL(): Set<Tier> {
  if (typeof window === "undefined") return new Set(ALL_TIERS);
  const raw = new URLSearchParams(window.location.search).get("tier");
  if (!raw) return new Set(ALL_TIERS);
  const tiers = raw.split(",").filter((t): t is Tier => (ALL_TIERS as readonly string[]).includes(t));
  return tiers.length === 0 ? new Set(ALL_TIERS) : new Set(tiers);
}

function applyFilter(selected: Set<Tier>) {
  // Find every card with a data-tier attribute and toggle .hidden based on selection.
  const cards = document.querySelectorAll<HTMLElement>("[data-tier]");
  let visibleCount = 0;
  cards.forEach((el) => {
    const t = el.dataset.tier as Tier | undefined;
    const show = t ? selected.has(t) : true;
    el.classList.toggle("hidden", !show);
    if (show) visibleCount++;
  });
  // Show/hide the "no filers match" empty state
  const empty = document.getElementById("tier-filter-empty");
  if (empty) empty.classList.toggle("hidden", visibleCount > 0);
}

function writeURL(selected: Set<Tier>) {
  const params = new URLSearchParams(window.location.search);
  if (selected.size === 0 || selected.size === ALL_TIERS.length) {
    params.delete("tier");
  } else {
    params.set("tier", Array.from(selected).sort().join(","));
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function TierFilter({ counts }: { counts: Record<Tier, number> }) {
  const [selected, setSelected] = useState<Set<Tier>>(() => parseFromURL());

  // Apply filter to DOM on every state change (including initial render after hydration).
  useEffect(() => {
    applyFilter(selected);
    writeURL(selected);
  }, [selected]);

  const toggle = useCallback((t: Tier) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
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
            />
            <span className="font-mono">{t}</span>
            <span className="text-neutral-500">({counts[t] ?? 0})</span>
          </label>
        );
      })}
    </div>
  );
}
