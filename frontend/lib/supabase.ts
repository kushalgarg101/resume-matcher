/**
 * Browser Supabase client (email/password auth only).
 *
 * Uses the anon key (NEXT_PUBLIC_*). After login, the session JWT is read by
 * `lib/api.ts` and attached as a Bearer token to backend requests.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly during build/runtime so missing Vercel env vars are obvious.
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set them in your Vercel project environment."
  );
}

export const supabase: SupabaseClient = createClient(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
