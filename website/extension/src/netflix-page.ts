/**
 * Netflix main-world script — the seek arm of the Netflix adapter.
 *
 * Runs in the page's MAIN world (manifest `"world": "MAIN"`), where Netflix's
 * internal player API lives; the isolated-world adapter can't touch it and
 * writing video.currentTime directly stalls the player. The adapter posts a
 * NETFLIX_SEEK window message and this script performs the seek via
 * `netflix.appContext.state.playerApp.getAPI().videoPlayer` — the same route
 * Netflix's own scrub bar uses, so the element still fires normal
 * seeking/seeked events and the engine's echo suppression keeps working.
 */

import { NETFLIX_SEEK_TYPE, type NetflixSeekMessage } from './messages';

/** The undocumented corner of Netflix's player API we rely on. */
interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): { seek(timeMs: number): void } | null;
}

function getVideoPlayer(): { seek(timeMs: number): void } | null {
  const netflixGlobal = (window as unknown as Record<string, unknown>).netflix as
    | {
        appContext?: {
          state?: {
            playerApp?: { getAPI?: () => { videoPlayer?: NetflixVideoPlayerApi } };
          };
        };
      }
    | undefined;

  const videoPlayer = netflixGlobal?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  if (!videoPlayer) return null;

  const ids = videoPlayer.getAllPlayerSessionIds();
  // The real playback session is prefixed "watch-"; other ids are previews.
  const sessionId = ids.find((id) => id.startsWith('watch-')) ?? ids[0];
  return sessionId ? videoPlayer.getVideoPlayerBySessionId(sessionId) : null;
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const msg = event.data as Partial<NetflixSeekMessage> | null;
  if (msg?.type !== NETFLIX_SEEK_TYPE || typeof msg.timeMs !== 'number') return;

  try {
    const player = getVideoPlayer();
    if (player) {
      player.seek(msg.timeMs);
      return;
    }
  } catch {
    // Netflix shipped a new API shape — fall through to the raw element.
  }
  // Last resort: direct currentTime. Unreliable on Netflix but strictly better
  // than silently ignoring the room's seek.
  const video = document.querySelector<HTMLVideoElement>('.watch-video video');
  if (video) video.currentTime = msg.timeMs / 1000;
});
