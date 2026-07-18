/**
 * YouTube adapter (v1 platform).
 *
 * YouTube is a single-page app: navigating between videos never reloads the
 * page, and the player may replace its <video> element. It fires a custom
 * `yt-navigate-finish` event on the document after every SPA navigation.
 */

import type { PlatformAdapter, VideoInfo } from './types';

/** Extract the video id from any YouTube page URL shape. */
function parseVideoId(loc: Location): string | null {
  const v = new URLSearchParams(loc.search).get('v');
  if (v) return v;
  // /shorts/ID, /embed/ID, /live/ID
  const match = loc.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
  return match ? match[1] : null;
}

export const youtubeAdapter: PlatformAdapter = {
  platform: 'YouTube',

  findVideo() {
    return (
      document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
      document.querySelector<HTMLVideoElement>('#movie_player video')
    );
  },

  getVideoInfo(): VideoInfo {
    const videoId = parseVideoId(window.location);
    return {
      videoId,
      // Canonical watch URL — shorts/embed ids play fine on the watch page.
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
    };
  },

  onNavigation(callback) {
    document.addEventListener('yt-navigate-finish', callback);
  },
};
