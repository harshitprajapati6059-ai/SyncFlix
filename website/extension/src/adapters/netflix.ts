/**
 * Netflix adapter.
 *
 * Netflix is a single-page app like YouTube, but with two platform quirks:
 *   - It exposes no navigation event (nothing like `yt-navigate-finish`), so
 *     the engine's 1 s poll is the primary navigation detector; popstate is
 *     wired up only to catch back/forward a beat faster.
 *   - Writing video.currentTime directly stalls or errors the player, so
 *     seeks go through Netflix's internal player API via the main-world
 *     script (netflix-page.ts) — see the `seek` override below.
 */

import { NETFLIX_SEEK_TYPE, type NetflixSeekMessage } from '../messages';
import type { PlatformAdapter, VideoInfo } from './types';

/** Extract the title id from a /watch/<id> URL, null elsewhere on the site. */
function parseVideoId(loc: Location): string | null {
  const match = loc.pathname.match(/^\/watch\/(\d+)/);
  return match ? match[1] : null;
}

export const netflixAdapter: PlatformAdapter = {
  platform: 'Netflix',

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
    const msg: NetflixSeekMessage = {
      type: NETFLIX_SEEK_TYPE,
      timeMs: Math.round(seconds * 1000),
    };
    window.postMessage(msg, window.location.origin);
  },
};
