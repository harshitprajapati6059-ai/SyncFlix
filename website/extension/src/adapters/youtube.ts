/**
 * YouTube adapter (v1 platform).
 *
 * YouTube is a single-page app: navigating between videos never reloads the
 * page, and the player may replace its <video> element. It fires a custom
 * `yt-navigate-finish` event on the document after every SPA navigation.
 */

import type { PlatformAdapter } from './types';

export const youtubeAdapter: PlatformAdapter = {
  platform: 'YouTube',

  findVideo() {
    return (
      document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
      document.querySelector<HTMLVideoElement>('#movie_player video')
    );
  },

  onNavigation(callback) {
    document.addEventListener('yt-navigate-finish', callback);
  },
};
