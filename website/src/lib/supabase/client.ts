/**
 * Supabase browser client.
 *
 * Used in Client Components ('use client') — e.g. AuthContext.
 * Reads the public URL + anon key from NEXT_PUBLIC_* env vars.
 */
import { createBrowserClient } from '@supabase/ssr';

/** True when an env var is unset or still holds the template placeholder. */
function isPlaceholder(value: string | undefined): value is undefined {
  return !value || value.toUpperCase().includes('YOUR-PROJECT-REF') || value === 'YOUR-ANON-KEY';
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isPlaceholder(url) || isPlaceholder(anonKey)) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        'in website/.env.local (Supabase dashboard → Project Settings → API), then restart the dev server.'
    );
  }

  return createBrowserClient(url, anonKey);
}
