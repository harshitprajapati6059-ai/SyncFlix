/**
 * Netflix main-world script — the playback-control arm of the Netflix adapter.
 *
 * Runs in the page's MAIN world (manifest `"world": "MAIN"`), where Netflix's
 * internal player API lives; the isolated-world adapter can't touch it, and
 * driving the <video> element directly fights Netflix's own state machine
 * (currentTime writes stall it, play()/pause() get reverted a beat later). The
 * adapter posts a NETFLIX_CMD window message and this script performs the
 * action via `netflix.appContext.state.playerApp.getAPI().videoPlayer` — the
 * same route Netflix's own controls use, so the element still fires normal
 * play/pause/seeking/seeked events and the engine's echo suppression keeps
 * working.
 */

import { NETFLIX_CMD_TYPE, type NetflixCommandMessage } from './messages';

/** The undocumented corner of Netflix's player API we rely on. */
interface NetflixSessionPlayer {
  seek(timeMs: number): void;
  play(): void;
  pause(): void;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(id: string): NetflixSessionPlayer | null;
}

function getVideoPlayer(): NetflixSessionPlayer | null {
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

function watchVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('.watch-video video');
}

/** Last resort when Netflix ships a new API shape: drive the element itself. */
function fallback(msg: NetflixCommandMessage): void {
  const video = watchVideo();
  if (!video) return;
  if (msg.action === 'seek' && typeof msg.timeMs === 'number')
    video.currentTime = msg.timeMs / 1000;
  else if (msg.action === 'play') void video.play().catch(() => undefined);
  else if (msg.action === 'pause') video.pause();
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const msg = event.data as Partial<NetflixCommandMessage> | null;
  if (msg?.type !== NETFLIX_CMD_TYPE) return;
  if (msg.action !== 'seek' && msg.action !== 'play' && msg.action !== 'pause') return;
  if (msg.action === 'seek' && typeof msg.timeMs !== 'number') return;
  const command = msg as NetflixCommandMessage;

  try {
    const player = getVideoPlayer();
    if (player) {
      if (command.action === 'seek') player.seek(command.timeMs as number);
      else if (command.action === 'play') player.play();
      else player.pause();
      return;
    }
  } catch {
    // Netflix shipped a new API shape — fall through to the raw element.
  }
  fallback(command);
});
