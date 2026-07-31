/**
 * Prime Video adapter.
 *
 * Prime Video is served from two families of host — primevideo.com and the
 * regional Amazon storefronts (/gp/video/...) — running the same web player
 * ("atvwebplayersdk"). Platform quirks:
 *   - No navigation event, and playback often opens as an overlay without a URL
 *     change at all, so the engine's 1 s poll is the real navigation detector.
 *     popstate is wired up only to catch back/forward a beat faster.
 *   - Detail pages autoplay muted trailers in their own <video>. Only elements
 *     inside the web player's container are ever adopted, or the room would
 *     sync against a trailer.
 *   - The ad tier plays ads on the same element under a different timeline —
 *     see `isAdPlaying`.
 *
 * Unlike Netflix, the element itself can be driven directly: currentTime writes
 * and play()/pause() are honoured, so no main-world script is needed.
 */

import type { PlatformAdapter, VideoInfo } from './types';

/** Amazon storefronts that serve Prime Video, plus primevideo.com itself. */
const HOST_PATTERN =
  /(^|\.)(primevideo\.com|amazon\.(com|ca|com\.br|com\.mx|co\.uk|de|fr|it|es|nl|se|pl|com\.tr|ae|sa|in|sg|co\.jp|com\.au))$/;

/**
 * Containers the web player mounts into. Ordered most- to least-specific;
 * several ship simultaneously across regions and player versions, so all are
 * tried rather than betting on one.
 */
const PLAYER_CONTAINERS = [
  '.webPlayerSDKContainer',
  '.webPlayerElement',
  '#dv-web-player',
  '.dv-player-fullscreen',
];

/**
 * Markers the player renders only during an ad break ("Ad · 15s remaining",
 * the skip button). Class names here are Amazon's internals and may drift with
 * player releases; a miss degrades to treating the ad as content rather than
 * breaking sync, so an over-broad list is the safer bet.
 */
const AD_MARKERS = [
  '.atvwebplayersdk-adtimeindicator-text',
  '.atvwebplayersdk-ad-timer-remaining-time',
  '.atvwebplayersdk-adbadge-text',
  '.atvwebplayersdk-adskipbutton-button',
  '[data-testid="ad-timer"]',
  '[data-testid="ad-badge"]',
];

/** True if the element exists and is actually rendered (not just in the DOM). */
function visible(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  // getClientRects() over offsetParent: the player's overlays are position:fixed,
  // for which offsetParent is null even when on screen.
  return !!el && el.getClientRects().length > 0;
}

/**
 * Title id, tried in order of reliability:
 *   1. an explicit asin/gti query param (present on most playback URLs)
 *   2. a /detail/<id> or /dp/<id> path segment, on either host family
 * Amazon ASINs are 10 chars; primevideo.com GTIs vary, hence the loose bound.
 */
function parseVideoId(loc: Location): string | null {
  const params = new URLSearchParams(loc.search);
  const param = params.get('asin') ?? params.get('gti');
  if (param) return param;

  const match = loc.pathname.match(/\/(?:detail|dp)\/([A-Za-z0-9]{8,})/);
  return match ? match[1] : null;
}

export const primeVideoAdapter: PlatformAdapter = {
  platform: 'Prime Video',

  matches(hostname) {
    return HOST_PATTERN.test(hostname);
  },

  findVideo() {
    for (const container of PLAYER_CONTAINERS) {
      const video = document.querySelector<HTMLVideoElement>(`${container} video`);
      if (video) return video;
    }
    // No bare `video` fallback on purpose: detail pages autoplay muted trailers
    // that must never be adopted for sync.
    return null;
  },

  getVideoInfo(): VideoInfo {
    const videoId = parseVideoId(window.location);
    if (!videoId) return { videoId: null, videoUrl: null };
    // Build the link on whichever host we're on, so the popup's "Open video"
    // sends peers to the storefront that actually carries this title.
    const path = window.location.pathname.includes('/gp/video/')
      ? `/gp/video/detail/${videoId}`
      : `/detail/${videoId}`;
    return { videoId, videoUrl: `${window.location.origin}${path}` };
  },

  onNavigation(callback) {
    window.addEventListener('popstate', callback);
  },

  isAdPlaying() {
    return AD_MARKERS.some(visible);
  },
};
