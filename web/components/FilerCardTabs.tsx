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
      <div className="flex border-b border-neutral-900 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setTab("current")}
          className={`px-3 py-1.5 transition-colors ${
            tab === "current"
              ? "text-neutral-100 border-b-2 border-emerald-500 -mb-px"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Current positions
        </button>
        <button
          type="button"
          onClick={() => setTab("changes")}
          className={`px-3 py-1.5 transition-colors ${
            tab === "changes"
              ? "text-neutral-100 border-b-2 border-amber-500 -mb-px"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Changes vs last quarter
          {changesCount > 0 && (
            <span className={`ml-1.5 px-1 py-0.5 rounded text-[10px] ${tab === "changes" ? "bg-amber-600/30 text-amber-200" : "bg-neutral-800 text-neutral-400"}`}>
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
