import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth callback route.
 *
 * Supabase redirects here after email confirmation / OAuth sign-in with a
 * `code` query param. We exchange it for a session and then redirect the user
 * to `next` (defaults to the home page).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to an error state if the code is missing/invalid.
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
