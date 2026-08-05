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

  return createBrowserClient(url, anonKey, {
    realtime: {
      params: {
        // supabase-js defaults to 10 messages/second per client, which WebRTC
        // signaling blows straight through: bringing up one peer bursts an SDP
        // offer plus a few dozen trickled ICE candidates inside a second, and
        // in a mesh call that is multiplied by the number of peers. Everything
        // over the limit is silently throttled away, which is what made calls
        // fail to connect — or connect in only one direction, when one side's
        // candidates survived and the other's did not.
        //
        // webrtc.ts also batches ICE candidates to keep the real rate low; this
        // headroom is what stops a burst from being dropped in the first place.
        eventsPerSecond: 100,
      },
    },
  });
}
