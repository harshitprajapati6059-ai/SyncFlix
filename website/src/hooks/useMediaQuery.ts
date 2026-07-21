'use client';

import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from JS.
 *
 * Always returns false on the server and on the very first client render —
 * the server has no viewport to measure, so committing anything else here
 * would produce markup that disagrees with the server's and trip React's
 * hydration check. The real value lands in the effect, one paint later.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync up immediately after hydration
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True on devices that cannot run the browser extension: phones and tablets.
 *
 * This deliberately tests the *input device* rather than the viewport. A narrow
 * desktop window is still a machine that can install the extension, whereas an
 * iPad Pro in landscape is 1366px wide and still can't — iOS only allows Safari
 * web extensions shipped inside a native App Store app, and Chrome on Android
 * supports no extensions at all.
 *
 * `hover: none` is what excludes touchscreen laptops, which report a coarse
 * pointer for the screen but still have a real hovering pointer available.
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse) and (hover: none)');
}
