// Server-side Supabase client. The secret key bypasses RLS and must NEVER
// be imported from a Client Component or sent to the browser. Anything that
// calls supabaseServer() should be inside an async Server Component.

import { createClient } from "@supabase/supabase-js";

export function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SECRET_KEY missing from web/.env.local",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
