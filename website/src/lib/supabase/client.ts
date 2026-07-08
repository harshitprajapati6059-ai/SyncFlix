/**
 * Supabase browser client.
 *
 * Used in Client Components ('use client') — e.g. AuthContext.
 * Reads the public URL + anon key from NEXT_PUBLIC_* env vars.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
    );
  }

  return createBrowserClient(url, anonKey);
}
