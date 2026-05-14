"use client";

import { useState, useTransition } from "react";
import { toggleWatchlist } from "@/lib/watchlist";

export function WatchlistToggle({ ticker, initialAdded }: { ticker: string; initialAdded: boolean }) {
  const [added, setAdded] = useState(initialAdded);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await toggleWatchlist(ticker);
          setAdded(result.added);
        });
      }}
      title={added ? "Remove from watchlist" : "Add to watchlist"}
      className={
        "w-7 h-7 flex items-center justify-center rounded transition-colors " +
        (added
          ? "bg-emerald-900/40 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60"
          : "border border-neutral-700 text-neutral-500 hover:text-neutral-200 hover:border-neutral-500") +
        (pending ? " opacity-50 cursor-wait" : "")
      }
    >
      {added ? "✓" : "+"}
    </button>
  );
}
