"use server";

import { supabaseServer } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function getWatchlist(): Promise<Set<string>> {
  const sb = supabaseServer();
  const { data, error } = await sb.from("watchlist").select("ticker");
  if (error) return new Set();
  return new Set((data ?? []).map((r: { ticker: string }) => r.ticker));
}

export async function toggleWatchlist(ticker: string): Promise<{ added: boolean }> {
  const sb = supabaseServer();
  // Check if exists
  const { data: existing } = await sb.from("watchlist").select("ticker").eq("ticker", ticker).maybeSingle();
  if (existing) {
    await sb.from("watchlist").delete().eq("ticker", ticker);
    revalidatePath("/signals");
    revalidatePath("/signals/analysis");
    return { added: false };
  } else {
    await sb.from("watchlist").insert({ ticker });
    revalidatePath("/signals");
    revalidatePath("/signals/analysis");
    return { added: true };
  }
}
