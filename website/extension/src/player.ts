/**
 * Player content script — runs on the streaming site (YouTube, Netflix).
 *
 * Owns the sync engine:
 *   - Local user actions on the <video> → SYNC_EVENT up to the room page.
 *   - Remote room events → applied to the <video> via the platform adapter.
 *   - Echo suppression: a command we apply on the room's behalf must never come
 *     back out as a local user action, or two peers correct each other forever
 *     (each snapping to the other's stale position, swapping every heartbeat).
 *   - Drift correction against the host's POSITION_UPDATE heartbeat:
 *       < 0.5 s  tolerated
 *       0.5–3 s  playbackRate nudge (±5 %) until converged — invisible to the
 *                user, and only on platforms that honour playbackRate
 *       > 3 s    hard seek
 *
 * ─── Why echo suppression is time-and-position based, not event-counted ─────
 * The original design registered one expectation per DOM event a command was
 * expected to cause, with a short TTL. That holds on YouTube, where a seek is
 * a currentTime write that settles in one frame. It does not hold on Netflix:
 *
 *   - A seek is a round trip (postMessage → main world → player API → buffer
 *     flush) and the `seeked` event can land seconds later, well past any short
 *     TTL. The engine then read its own correction as a user seek, broadcast
 *     it, and dragged every peer back to the position it had just left.
 *   - One logical seek emits several element events — `seeked` more than once,
 *     plus `pause`/`play` around the buffer flush. Extras beyond the single
 *     registered expectation leaked out as user actions: the pause/play storm.
 *
 * So instead: applying a remote command opens a suppression window, and a
 * pending seek is matched by *landing position* rather than by event count, and
 * stays pending until the player actually arrives (or the attempt times out).
 */

import { netflixAdapter } from './adapters/netflix';
import { primeVideoAdapter } from './adapters/primevideo';
import { youtubeAdapter } from './adapters/youtube';
import type { PlatformAdapter } from './adapters/types';
import {
  PLAYER_PORT,
  type PortMessage,
  type SyncEventEnvelope,
  type SyncEventType,
} from './messages';

// One adapter per platform (project rule).
const ADAPTERS: PlatformAdapter[] = [youtubeAdapter, netflixAdapter, primeVideoAdapter];

/**
 * Used only if the manifest injects us somewhere no adapter claims — i.e. the
 * two host lists have drifted. Finding no video means the engine never
 * attaches, so an unclaimed page is inert rather than synced by a guess.
 */
const INERT_ADAPTER: PlatformAdapter = {
  platform: 'Unknown',
  matches: () => false,
  findVideo: () => null,
  getVideoInfo: () => ({ videoId: null, videoUrl: null }),
  onNavigation: () => undefined,
};

const adapter = ADAPTERS.find((a) => a.matches(location.hostname)) ?? INERT_ADAPTER;

const RECONNECT_DELAY_MS = 1000;
const VIDEO_POLL_MS = 1000;
const POSITION_REPORT_MS = 1000;
/** Position mismatch (s) below which we don't bother seeking. */
const SEEK_TOLERANCE_S = 1;
/** Drift band (s): below MIN do nothing, above MAX hard-seek, between → nudge. */
const DRIFT_MIN_S = 0.5;
const DRIFT_MAX_S = 3;
/** Drift (s) at which an active nudge is considered converged. */
const NUDGE_DONE_S = 0.15;
const NUDGE_FACTOR = 0.05;
/** A nudge that hasn't converged by now is abandoned, so the rate can't stick
 *  off-base forever (which would itself manufacture drift). */
const NUDGE_MAX_MS = 15000;

// ─── Echo suppression tuning ─────────────────────────────────────────────────

/** Quiet period after applying a play/pause/rate command on the room's behalf. */
const ECHO_WINDOW_MS = 1000;
/** How long a commanded seek may still be in flight before we give up on it. */
const SEEK_ECHO_WINDOW_MS = 5000;
/** A `seeked` landing this close to the commanded target counts as ours. */
const SEEK_MATCH_TOLERANCE_S = 1.5;
/** Extra quiet period once a commanded seek lands, covering the player's own
 *  pause/play churn either side of the buffer flush. */
const SEEK_SETTLE_MS = 1500;
/** How long we keep recognising a position the room told us to go to, so a
 *  late stray event about it can't be mistaken for the user. */
const REMOTE_TARGET_MEMORY_MS = 5000;
/** Quiet period across an ad break's start and end, where the element's
 *  timeline is swapped out from under us. */
const AD_TRANSITION_QUIET_MS = 2000;

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

/** Until this moment, element events are assumed to be ours, not the user's. */
let quietUntil = 0;
/** A seek we asked for that hasn't landed yet. */
let pendingSeek: { target: number; expires: number } | null = null;
/** The last position the room told us to be at, used to recognise late strays. */
let remoteTarget: { time: number; at: number } | null = null;

function beQuiet(ms: number): void {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}

/** True while a commanded seek is still outstanding (expires on its own). */
function seekPending(): boolean {
  if (pendingSeek && Date.now() > pendingSeek.expires) pendingSeek = null;
  return pendingSeek !== null;
}

/** True if this element event is more likely ours than the user's. */
function isEcho(): boolean {
  return seekPending() || Date.now() < quietUntil;
}

/** Remember where the room wants us, so a late event about it isn't rebroadcast. */
function noteRemoteTarget(seconds: number): void {
  remoteTarget = { time: seconds, at: Date.now() };
}

/**
 * True if `position` is where the room recently put us. Playback keeps moving
 * after a command lands, so the remembered target is advanced by elapsed time.
 */
function isRemoteTarget(position: number): boolean {
  if (!remoteTarget) return false;
  const age = Date.now() - remoteTarget.at;
  if (age > REMOTE_TARGET_MEMORY_MS) return false;
  const advanced =
    video && !video.paused
      ? remoteTarget.time + (age / 1000) * video.playbackRate
      : remoteTarget.time;
  return Math.abs(position - advanced) <= SEEK_MATCH_TOLERANCE_S;
}

// ─── Ad breaks ───────────────────────────────────────────────────────────────
// Ad-supported platforms (Prime Video) play ads on the same element under a
// different timeline. A position measured mid-ad means nothing to the room, so
// the engine goes quiet for the duration: it neither reports nor applies.

let inAd = false;

/** True while the platform is showing an ad. */
function adBreak(): boolean {
  return inAd;
}

/**
 * Re-read the platform's ad state. Called from the same 1 s tick that reports
 * position and from each local event, so a break is noticed promptly.
 */
function pollAdState(): void {
  const now = adapter.isAdPlaying?.() === true;
  if (now === inAd) return;
  inAd = now;
  // Entering or leaving a break swaps the timeline underneath us. Whatever the
  // element emits across that transition is the platform's doing, and any seek
  // still in flight was aimed at the timeline we just left.
  beQuiet(AD_TRANSITION_QUIET_MS);
  pendingSeek = null;
  remoteTarget = null;
  if (video) lastTime = video.currentTime;
}

// ─── Driving the player ──────────────────────────────────────────────────────
// Each of these applies a room command, so each opens a suppression window
// before touching the player. Platform overrides are used where present: some
// players (Netflix) revert changes made to the element behind their back.

function seekTo(v: HTMLVideoElement, seconds: number): void {
  pendingSeek = { target: seconds, expires: Date.now() + SEEK_ECHO_WINDOW_MS };
  noteRemoteTarget(seconds);
  beQuiet(ECHO_WINDOW_MS);
  if (adapter.seek) adapter.seek(seconds);
  else v.currentTime = seconds;
}

function playVideo(v: HTMLVideoElement): void {
  beQuiet(ECHO_WINDOW_MS);
  if (adapter.play) adapter.play();
  // A play() interrupted by a pause rejects; that's expected here, not an error.
  else void v.play().catch(() => undefined);
}

function pauseVideo(v: HTMLVideoElement): void {
  beQuiet(ECHO_WINDOW_MS);
  if (adapter.pause) adapter.pause();
  else v.pause();
}

function setRate(v: HTMLVideoElement, rate: number): void {
  beQuiet(ECHO_WINDOW_MS);
  v.playbackRate = rate;
}

// ─── Drift correction state ──────────────────────────────────────────────────

/** The room's intended playback rate; nudges deviate from it temporarily. */
let baseRate = 1;
let nudging = false;
let nudgeStartedAt = 0;
const canNudge = adapter.canNudgeRate !== false;

function endNudge(v: HTMLVideoElement): void {
  if (!nudging) return;
  nudging = false;
  if (v.playbackRate !== baseRate) setRate(v, baseRate);
}

// ─── Applying remote events ──────────────────────────────────────────────────

function applyRemote({ event, payload }: SyncEventEnvelope): void {
  if (!video) return;
  // Mid-ad the element is on the ad's timeline, so a room position would seek
  // us inside the ad. Skip; the host's heartbeat re-syncs us the moment content
  // resumes.
  if (adBreak()) return;
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
      if (typeof t === 'number') alignTo(v, t);
      if (v.paused) playVideo(v);
      break;
    }
    case 'PAUSE': {
      if (!v.paused) pauseVideo(v);
      const t = payload.currentTime;
      if (typeof t === 'number') alignTo(v, t);
      break;
    }
    case 'SEEK': {
      const to = payload.to;
      if (typeof to === 'number') alignTo(v, to);
      break;
    }
    case 'PLAYBACK_SPEED': {
      const rate = payload.rate;
      if (typeof rate === 'number') {
        baseRate = rate;
        if (!nudging && v.playbackRate !== rate) setRate(v, rate);
      }
      break;
    }
    case 'POSITION_UPDATE':
      onHostHeartbeat(v, payload);
      break;
  }
}

/**
 * Move to `target` if we're not already there.
 *
 * The tolerance check is what stops an echoed SEEK from sustaining itself: a
 * redundant seek is a real, event-emitting operation on Netflix, so applying
 * one unconditionally meant every stray echo produced another seek, which
 * produced another echo. Positions we're already at are simply remembered, so a
 * late event about them is still recognised as the room's doing.
 */
function alignTo(v: HTMLVideoElement, target: number): void {
  if (Math.abs(v.currentTime - target) > SEEK_TOLERANCE_S) seekTo(v, target);
  else noteRemoteTarget(target);
}

function onHostHeartbeat(v: HTMLVideoElement, payload: Record<string, unknown>): void {
  const hostTime = payload.currentTime;
  if (typeof hostTime !== 'number') return;
  const hostPlaying = Boolean(payload.playing);

  // A correction is already in flight. Netflix seeks routinely outlast the 2 s
  // heartbeat, and re-issuing against a now-stale hostTime while the player is
  // still buffering is what turned one correction into a stutter loop.
  if (seekPending() || v.seeking) return;

  // Play/pause state follows the host.
  if (hostPlaying === v.paused) {
    if (hostPlaying) playVideo(v);
    else pauseVideo(v);
  }

  const drift = v.currentTime - hostTime; // positive = we are ahead
  const abs = Math.abs(drift);

  if (!hostPlaying) {
    // While paused, converge with a plain seek — rate nudges do nothing.
    if (abs > SEEK_TOLERANCE_S) seekTo(v, hostTime);
    endNudge(v);
    return;
  }

  if (abs > DRIFT_MAX_S) {
    seekTo(v, hostTime);
    endNudge(v);
  } else if (!canNudge) {
    // Nothing to do: this platform ignores playbackRate, so sub-DRIFT_MAX drift
    // is tolerated rather than corrected with a disruptive seek.
  } else if (abs > DRIFT_MIN_S) {
    if (!nudging) {
      nudging = true;
      nudgeStartedAt = Date.now();
    } else if (Date.now() - nudgeStartedAt > NUDGE_MAX_MS) {
      endNudge(v); // not converging; stop rather than hold an off-base rate
      return;
    }
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
  pollAdState();
  if (!video || adBreak() || isEcho()) return;
  sendSync('PLAY', { currentTime: video.currentTime, platform: adapter.platform });
}

function onPause(): void {
  pollAdState();
  if (!video || adBreak() || isEcho()) return;
  sendSync('PAUSE', { currentTime: video.currentTime });
}

function onSeeked(): void {
  pollAdState();
  if (!video || adBreak()) return;
  const from = lastTime;
  const to = video.currentTime;
  lastTime = to;

  if (seekPending()) {
    // Match by landing position, not by event count: one commanded seek can
    // emit several `seeked` events, and only the one that actually arrives at
    // the target retires the command.
    if (Math.abs(to - pendingSeek!.target) <= SEEK_MATCH_TOLERANCE_S) {
      pendingSeek = null;
      beQuiet(SEEK_SETTLE_MS);
    }
    return;
  }
  if (Date.now() < quietUntil) return;
  // Last line of defence: a seek that lands exactly where the room last put us
  // is the room's doing, however late it arrives. Without this a slow platform
  // could still bounce a correction back at its sender.
  if (isRemoteTarget(to)) return;

  sendSync('SEEK', { from, to });
}

function onRateChange(): void {
  pollAdState();
  if (!video || adBreak() || nudging || isEcho()) return;
  baseRate = video.playbackRate;
  sendSync('PLAYBACK_SPEED', { rate: video.playbackRate });
}

function onTimeUpdate(): void {
  // An ad's positions must not become the `from` of a later seek.
  if (video && !video.seeking && !adBreak()) lastTime = video.currentTime;
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
  // Suppression state describes the element we just left; carrying it over
  // would mute (or leak) the first events on the new one.
  pendingSeek = null;
  remoteTarget = null;
  quietUntil = 0;
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
// feeds the room heartbeat; on viewers it drives the drift display. Silent
// during an ad — that position belongs to the ad's timeline, and broadcasting
// it would seek every peer into their own ad slot.
window.setInterval(() => {
  pollAdState();
  if (!video || adBreak()) return;
  sendSync('POSITION_UPDATE', { currentTime: video.currentTime, playing: !video.paused });
}, POSITION_REPORT_MS);

connect();
checkVideo();
