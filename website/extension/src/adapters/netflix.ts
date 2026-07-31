/**
 * Netflix adapter.
 *
 * Netflix is a single-page app like YouTube, but with two platform quirks:
 *   - It exposes no navigation event (nothing like `yt-navigate-finish`), so
 *     the engine's 1 s poll is the primary navigation detector; popstate is
 *     wired up only to catch back/forward a beat faster.
 *   - The <video> element must not be driven directly: writing currentTime
 *     stalls or errors the player, and play()/pause() behind Netflix's back get
 *     reverted by its own state machine. All three go through Netflix's
 *     internal player API via the main-world script (netflix-page.ts).
 */

import { NETFLIX_CMD_TYPE, type NetflixCommand, type NetflixCommandMessage } from '../messages';
import type { PlatformAdapter, VideoInfo } from './types';

/** Post a playback command to the main-world script (netflix-page.ts). */
function command(action: NetflixCommand, timeMs?: number): void {
  const msg: NetflixCommandMessage = { type: NETFLIX_CMD_TYPE, action, timeMs };
  window.postMessage(msg, window.location.origin);
}

/** Extract the title id from a /watch/<id> URL, null elsewhere on the site. */
function parseVideoId(loc: Location): string | null {
  const match = loc.pathname.match(/^\/watch\/(\d+)/);
  return match ? match[1] : null;
}

export const netflixAdapter: PlatformAdapter = {
  platform: 'Netflix',

  matches(hostname) {
    return /(^|\.)netflix\.com$/.test(hostname);
  },

  findVideo() {
    // Only the /watch page hosts the real player; browse pages autoplay muted
    // trailer <video>s that must never be adopted for sync.
    if (!parseVideoId(window.location)) return null;
    return (
      document.querySelector<HTMLVideoElement>('.watch-video video') ??
      document.querySelector<HTMLVideoElement>('video')
    );
  },

  getVideoInfo(): VideoInfo {
    const videoId = parseVideoId(window.location);
    return {
      videoId,
      videoUrl: videoId ? `https://www.netflix.com/watch/${videoId}` : null,
    };
  },

  onNavigation(callback) {
    window.addEventListener('popstate', callback);
  },

  seek(seconds) {
    command('seek', Math.round(seconds * 1000));
  },

  play() {
    command('play');
  },

  pause() {
    command('pause');
  },

  // Netflix re-asserts its own playback rate, so a ±5 % drift nudge either gets
  // wiped (no correction) or sticks (permanent drift). Drift is corrected by
  // seeking instead.
  canNudgeRate: false,
};
