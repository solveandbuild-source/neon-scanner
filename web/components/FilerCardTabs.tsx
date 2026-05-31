"use client";

import { useState } from "react";

// Tab toggle for each filer card on /holdings. Three views:
//   "current"  — top 10 latest positions (the snapshot table)
//   "changes"  — News + Adds (positive moves vs prior 13F)
//   "sold"     — Exits + Major Trims (negative moves vs prior 13F)
//
// Per CLAUDE.md §2.3 — exits get equal prominence to entries. Sold lives
// in its own tab (not buried in a footer) so a glance at any filer's
// rotation tells you what they bought AND what they shed.
//
// UI state is purely client-side: all three views are server-rendered as
// siblings and we toggle visibility via CSS. No router push, no re-fetch.

export function FilerCardTabs({
  current,
  changes,
  sold,
  changesCount,
  soldCount,
}: {
  current: React.ReactNode;
  changes: React.ReactNode;
  sold: React.ReactNode;
  changesCount: number;
  soldCount: number;
}) {
  const [tab, setTab] = useState<"current" | "changes" | "sold">("current");

  const tabBtn = (
    name: "current" | "changes" | "sold",
    label: string,
    count: number | null,
    activeClasses: string,
  ) => {
    const isOn = tab === name;
    return (
      <button
        type="button"
        onClick={() => setTab(name)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors ${
          isOn
            ? activeClasses
            : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700"
        }`}
      >
        <span>{label}</span>
        {count != null && count > 0 && (
          <span
            className={`px-1 py-0.5 rounded text-[10px] tabular-nums ${
              isOn ? "bg-black/30 text-current" : "bg-neutral-800 text-neutral-400"
            }`}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-neutral-950 border-b border-neutral-900 text-[11px] font-medium">
        {tabBtn("current", "Current positions", null, "bg-emerald-600/20 text-emerald-200 border-emerald-700/60")}
        {tabBtn("changes", "Bought (new + adds)", changesCount, "bg-amber-600/20 text-amber-200 border-amber-700/60")}
        {tabBtn("sold", "Sold (trims + exits)", soldCount, "bg-red-600/20 text-red-200 border-red-700/60")}
      </div>
      <div className={tab === "current" ? "" : "hidden"}>{current}</div>
      <div className={tab === "changes" ? "" : "hidden"}>{changes}</div>
      <div className={tab === "sold" ? "" : "hidden"}>{sold}</div>
    </>
  );
}
