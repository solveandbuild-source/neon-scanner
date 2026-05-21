"use client";

import { useState } from "react";

// Tab toggle for each filer card on /holdings.
// Two views:
//   "current"  — top 10 latest positions (existing table)
//   "changes"  — News + Adds + Trims + Exits, each as a proper row list
//
// Per CLAUDE.md §2.3, exits and changes get equal prominence to entries.
// Default tab: current (latest snapshot).
//
// The tab is purely UI state — both views are server-rendered as siblings
// and we toggle visibility via CSS. No router push, no re-fetch.

export function FilerCardTabs({
  current,
  changes,
  changesCount,
}: {
  current: React.ReactNode;
  changes: React.ReactNode;
  changesCount: number;
}) {
  const [tab, setTab] = useState<"current" | "changes">("current");
  return (
    <>
      <div className="flex gap-1.5 px-3 py-2 bg-neutral-950 border-b border-neutral-900 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setTab("current")}
          className={`px-2.5 py-1 rounded border transition-colors ${
            tab === "current"
              ? "bg-emerald-600/20 text-emerald-200 border-emerald-700/60"
              : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700"
          }`}
        >
          Current positions
        </button>
        <button
          type="button"
          onClick={() => setTab("changes")}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors ${
            tab === "changes"
              ? "bg-amber-600/20 text-amber-200 border-amber-700/60"
              : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700"
          }`}
        >
          <span>Changes vs last quarter</span>
          {changesCount > 0 && (
            <span className={`px-1 py-0.5 rounded text-[10px] tabular-nums ${tab === "changes" ? "bg-amber-700/40 text-amber-100" : "bg-neutral-800 text-neutral-400"}`}>
              {changesCount}
            </span>
          )}
        </button>
      </div>
      <div className={tab === "current" ? "" : "hidden"}>{current}</div>
      <div className={tab === "changes" ? "" : "hidden"}>{changes}</div>
    </>
  );
}
