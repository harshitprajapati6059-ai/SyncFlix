/**
 * Player content script — runs on the streaming site (YouTube, Netflix).
 *
 * Owns the sync engine:
 *   - Local user actions on the <video> → SYNC_EVENT up to the room page.
 *   - Remote room events → applied to the <video>.
 *   - Echo suppression: before applying a remote command we register the DOM
 *     events we EXPECT it to cause; when they fire, they're consumed instead
 *     of re-broadcast. A bare "currently applying" flag is not enough — events
 *     can arrive late or overlap, so each expectation is matched and consumed
 *     individually (with a TTL as a safety valve).
 *   - Drift correction against the host's POSITION_UPDATE heartbeat:
 *       < 0.5 s  tolerated
 *       0.5–3 s  playbackRate nudge (±5 %) until converged — invisible to the user
 *       > 3 s    hard seek
 */

import { netflixAdapter } from './adapters/netflix';
import { youtubeAdapter } from './adapters/youtube';
import {
  PLAYER_PORT,
  type PortMessage,
  type SyncEventEnvelope,
  type SyncEventType,
} from './messages';

// One adapter per platform; the manifest only injects this script on hosts
// that have one.
const adapter = location.hostname.endsWith('netflix.com') ? netflixAdapter : youtubeAdapter;

const RECONNECT_DELAY_MS = 1000;
const VIDEO_POLL_MS = 1000;
const POSITION_REPORT_MS = 1000;
const EXPECTATION_TTL_MS = 800;
/** Position mismatch (s) below which we don't bother seeking. */
const SEEK_TOLERANCE_S = 1;
/** Drift band (s): below MIN do nothing, above MAX hard-seek, between → nudge. */
const DRIFT_MIN_S = 0.5;
const DRIFT_MAX_S = 3;
/** Drift (s) at which an active nudge is considered converged. */
const NUDGE_DONE_S = 0.15;
const NUDGE_FACTOR = 0.05;

// ─── Port to the service worker ──────────────────────────────────────────────

let port: chrome.runtime.Port | null = null;

function connect(): void {
  try {
    port = chrome.runtime.connect({ name: PLAYER_PORT });
  } catch {
    port = null; // orphaned after an extension reload
    return;
  }

  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'SYNC_EVENT') applyRemote(msg.payload);
  });

  port.onDisconnect.addListener(() => {
    port = null;
    window.setTimeout(() => {
      connect();
      announceAttachment(); // re-announce so the revived worker rebuilds its registry
    }, RECONNECT_DELAY_MS);
  });
}

function sendSync(event: SyncEventType, payload: Record<string, unknown>): void {
  // Every event carries the identity of the video it happened on, so peers on a
  // different video (or none) can refuse to apply it instead of desyncing.
  const envelope: SyncEventEnvelope = {
    event,
    payload: { ...payload, videoId: currentVideo.videoId, videoUrl: currentVideo.videoUrl },
  };
  port?.postMessage({ type: 'SYNC_EVENT', payload: envelope } satisfies PortMessage);
}

function announceAttachment(): void {
  if (video) {
    port?.postMessage({
      type: 'ADAPTER_ATTACHED',
      payload: {
        platform: adapter.platform,
        videoId: currentVideo.videoId,
        videoUrl: currentVideo.videoUrl,
      },
    } satisfies PortMessage);
  } else {
    port?.postMessage({ type: 'ADAPTER_LOST' } satisfies PortMessage);
  }
}

// ─── Echo suppression ────────────────────────────────────────────────────────

type ExpectedAction = 'play' | 'pause' | 'seek' | 'rate';

const expectations: Array<{ action: ExpectedAction; expires: number }> = [];

function expect(action: ExpectedAction): void {
  expectations.push({ action, expires: Date.now() + EXPECTATION_TTL_MS });
}

/**
 * Seek with echo suppression, routed through the adapter's platform-specific
 * seek when it has one (Netflix rejects direct currentTime writes).
 */
function seekTo(v: HTMLVideoElement, seconds: number): void {
  expect('seek');
  if (adapter.seek) adapter.seek(seconds);
  else v.currentTime = seconds;
}

/** True if this DOM event was caused by us applying a remote command. */
function consumeExpectation(action: ExpectedAction): boolean {
  const now = Date.now();
  for (let i = expectations.length - 1; i >= 0; i--) {
    if (expectations[i].expires < now) expectations.splice(i, 1);
  }
  const idx = expectations.findIndex((e) => e.action === action);
  if (idx === -1) return false;
  expectations.splice(idx, 1);
  return true;
}

// ─── Drift correction state ──────────────────────────────────────────────────

/** The room's intended playback rate; nudges deviate from it temporarily. */
let baseRate = 1;
let nudging = false;

function endNudge(v: HTMLVideoElement): void {
  if (!nudging) return;
  nudging = false;
  if (v.playbackRate !== baseRate) {
    expect('rate');
    v.playbackRate = baseRate;
  }
}

// ─── Applying remote events ──────────────────────────────────────────────────

function applyRemote({ event, payload }: SyncEventEnvelope): void {
  if (!video) return;
  // Video-identity gate: a remote event stamped with a different videoId was
  // recorded on different content — applying its timeline here would corrupt
  // playback (e.g. the sender's video ending would seek ours to 0:00). Events
  // without a stamp (older peers) are allowed through.
  const remoteVideoId = payload.videoId;
  if (
    typeof remoteVideoId === 'string' &&
    currentVideo.videoId !== null &&
    remoteVideoId !== currentVideo.videoId
  ) {
    return;
  }
  const v = video;

  switch (event) {
    case 'PLAY': {
      const t = payload.currentTime;
      if (typeof t === 'number' && Math.abs(v.currentTime - t) > SEEK_TOLERANCE_S) {
        seekTo(v, t);
      }
      if (v.paused) {
        expect('play');
        void v.play();
      }
      break;
    }
    case 'PAUSE': {
      if (!v.paused) {
        expect('pause');
        v.pause();
      }
      const t = payload.currentTime;
      if (typeof t === 'number' && Math.abs(v.currentTime - t) > SEEK_TOLERANCE_S) {
        seekTo(v, t);
      }
      break;
    }
    case 'SEEK': {
      const to = payload.to;
      if (typeof to === 'number') {
        seekTo(v, to);
      }
      break;
    }
    case 'PLAYBACK_SPEED': {
      const rate = payload.rate;
      if (typeof rate === 'number') {
        baseRate = rate;
        if (!nudging && v.playbackRate !== rate) {
          expect('rate');
          v.playbackRate = rate;
        }
      }
      break;
    }
    case 'POSITION_UPDATE':
      onHostHeartbeat(v, payload);
      break;
  }
}

function onHostHeartbeat(v: HTMLVideoElement, payload: Record<string, unknown>): void {
  const hostTime = payload.currentTime;
  if (typeof hostTime !== 'number') return;
  const hostPlaying = Boolean(payload.playing);

  // Play/pause state follows the host.
  if (hostPlaying === v.paused) {
    if (hostPlaying) {
      expect('play');
      void v.play();
    } else {
      expect('pause');
      v.pause();
    }
  }

  const drift = v.currentTime - hostTime; // positive = we are ahead
  const abs = Math.abs(drift);

  if (!hostPlaying) {
    // While paused, converge with a plain seek — rate nudges do nothing.
    if (abs > SEEK_TOLERANCE_S) {
      seekTo(v, hostTime);
    }
    endNudge(v);
    return;
  }

  if (abs > DRIFT_MAX_S) {
    seekTo(v, hostTime);
    endNudge(v);
  } else if (abs > DRIFT_MIN_S) {
    nudging = true;
    const target = drift > 0 ? baseRate * (1 - NUDGE_FACTOR) : baseRate * (1 + NUDGE_FACTOR);
    if (v.playbackRate !== target) v.playbackRate = target; // suppressed via `nudging` flag
  } else if (nudging && abs < NUDGE_DONE_S) {
    endNudge(v);
  }
}

// ─── Local events → room ─────────────────────────────────────────────────────

/** Last steady position, used as `from` when the user seeks. */
let lastTime = 0;

function onPlay(): void {
  if (!video || consumeExpectation('play')) return;
  sendSync('PLAY', { currentTime: video.currentTime, platform: adapter.platform });
}

function onPause(): void {
  if (!video || consumeExpectation('pause')) return;
  sendSync('PAUSE', { currentTime: video.currentTime });
}

function onSeeked(): void {
  if (!video) return;
  const from = lastTime;
  const to = video.currentTime;
  lastTime = to;
  if (consumeExpectation('seek')) return;
  sendSync('SEEK', { from, to });
}

function onRateChange(): void {
  if (!video || nudging || consumeExpectation('rate')) return;
  baseRate = video.playbackRate;
  sendSync('PLAYBACK_SPEED', { rate: video.playbackRate });
}

function onTimeUpdate(): void {
  if (video && !video.seeking) lastTime = video.currentTime;
}

// ─── Video attach / detach ───────────────────────────────────────────────────

let video: HTMLVideoElement | null = null;
let currentVideo: ReturnType<typeof adapter.getVideoInfo> = { videoId: null, videoUrl: null };

function attach(v: HTMLVideoElement): void {
  v.addEventListener('play', onPlay);
  v.addEventListener('pause', onPause);
  v.addEventListener('seeked', onSeeked);
  v.addEventListener('ratechange', onRateChange);
  v.addEventListener('timeupdate', onTimeUpdate);
  lastTime = v.currentTime;
  baseRate = v.playbackRate;
  nudging = false;
}

function detach(v: HTMLVideoElement): void {
  v.removeEventListener('play', onPlay);
  v.removeEventListener('pause', onPause);
  v.removeEventListener('seeked', onSeeked);
  v.removeEventListener('ratechange', onRateChange);
  v.removeEventListener('timeupdate', onTimeUpdate);
}

/**
 * Re-locate the video and re-read its identity. YouTube may replace the
 * element on SPA navigation — or keep the same element but load a different
 * video (autoplay/next), which must also trigger a re-announce so peers stop
 * applying our old-video timeline.
 */
function checkVideo(): void {
  const found = adapter.findVideo();
  const info = adapter.getVideoInfo();
  const elementChanged = found !== video;
  const videoChanged = info.videoId !== currentVideo.videoId;
  if (!elementChanged && !videoChanged) return;

  if (elementChanged) {
    if (video) detach(video);
    video = found;
    if (video) attach(video);
  }
  currentVideo = info;
  announceAttachment();
}

adapter.onNavigation(checkVideo);
window.setInterval(checkVideo, VIDEO_POLL_MS);

// Report the real player position up to the page every second. On the host it
// feeds the room heartbeat; on viewers it drives the drift display.
window.setInterval(() => {
  if (!video) return;
  sendSync('POSITION_UPDATE', { currentTime: video.currentTime, playing: !video.paused });
}, POSITION_REPORT_MS);

connect();
checkVideo();
