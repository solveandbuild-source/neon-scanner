"use client";

import { useState, useTransition } from "react";
import { runAnalysis } from "@/lib/analyze";

export function RunAnalysisButton({ ticker, label = "Run fresh analysis" }: { ticker: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending || !ticker}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await runAnalysis(ticker);
            if (!r.ok) setError(r.error ?? "Failed");
          });
        }}
        className="px-3 py-1.5 rounded-md bg-emerald-900/40 border border-emerald-700/60 text-emerald-200 text-sm hover:bg-emerald-900/60 disabled:opacity-50"
      >
        {pending ? "Analyzing…" : label}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
