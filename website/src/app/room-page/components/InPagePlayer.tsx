'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Play } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import { loadYouTubeApi, parseYouTubeId, youTubeWatchUrl, type YTPlayer } from '@/services/youtube';

/**
 * In-page YouTube player — the extension-free playback path.
 *
 * The extension drives a real youtube.com tab from the outside; this embeds a
 * player we own directly in the room. It exists because no mobile browser can
 * run the extension, and it doubles as a desktop fallback when it isn't
 * installed.
 *
 * The sync contract deliberately mirrors `extension/src/player.ts`:
 *   - deliberate local actions broadcast PLAY / PAUSE / SEEK
 *   - position is reported to local state only; the host's 2s heartbeat is the
 *     only thing that puts a clock on the wire
 *   - programmatic changes are suppressed so they don't echo back out
 */

/** YouTube player states. The API exposes these, but we also read them in the
 *  position poll where the namespace isn't in scope. */
const PLAYING = 1;
const BUFFERING = 3;

/** Position poll / local report cadence. */
const TICK_MS = 1000;
/**
 * How long a programmatic change stays "expected".
 *
 * Must comfortably exceed TICK_MS: a corrective seek is only recognised as ours
 * when the *next* position tick samples it, so a TTL shorter than the tick lets
 * our own seeks expire unclaimed and get rebroadcast as if the user had scrubbed.
 */
const ECHO_TTL_MS = 3000;
/** Jump between ticks larger than this is a seek, not normal playback. */
const SEEK_EPSILON = 1.5;
/**
 * Ignore seek detection entirely when the gap between ticks is this many times
 * the nominal cadence. Background tabs have their timers throttled hard — on a
 * phone, switching apps for a minute would otherwise look like a 60-second jump
 * and broadcast a SEEK that drags the whole room back.
 */
const TICK_STALL_FACTOR = 2;
/** Drift beyond this pulls a viewer back to the host's position. */
const CORRECT_THRESHOLD = 1.5;
/** Minimum gap between corrective seeks, so we never seek-thrash. */
const CORRECT_COOLDOWN_MS = 3000;

type EchoKind = 'play' | 'pause' | 'seek';

/**
 * Turn an IFrame API error code into something actionable.
 *
 * Measured against the live API rather than assumed: 150 is returned both for
 * videos whose owner blocks embedding *and* for ids that don't resolve, so the
 * two can't be told apart and the message covers both. Major-label music (the
 * usual suspect for embed blocks) generally does embed fine.
 *
 * 153 is undocumented and means the origin check failed — it fires when the
 * `origin` playerVar is missing or disagrees with the embedding page, and is
 * also what an ad/privacy blocker intercepting the embed tends to surface.
 */
function describePlayerError(code: number): string {
  switch (code) {
    case 100:
    case 101:
    case 150:
      return 'This video isn’t available for embedding. It may be private, deleted, or blocked by its owner. Try a different video.';
    case 153:
      return 'YouTube refused to load this embed. A browser extension blocking YouTube is the usual cause, so try disabling it or open the video on YouTube.';
    case 2:
      return 'That video link doesn’t look valid.';
    case 5:
      return 'This video can’t be played in the browser’s HTML5 player.';
    default:
      return 'This video can’t be played here.';
  }
}

export default function InPagePlayer() {
  const {
    amHost,
    hostVideo,
    playbackState,
    inPagePlayer,
    setInPageVideo,
    reportInPagePosition,
    registerPositionSampler,
    subscribeRemoteSync,
    broadcastEvent,
  } = useRoom();

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  /** Set when playback was requested but the browser blocked it (mobile autoplay). */
  const [needsGesture, setNeedsGesture] = useState(false);

  const videoId = inPagePlayer.videoId;
  // The position poll and remote handler need this without being torn down and
  // rebuilt every time the role changes.
  const amHostRef = useRef(amHost);
  amHostRef.current = amHost;

  // ─── Echo suppression ──────────────────────────────────────────────────────
  // Every programmatic call registers an expectation; the state change it causes
  // consumes that expectation instead of being rebroadcast as a user action.
  // Expirations are queued per kind rather than held one-deep — two seeks can be
  // in flight at once (a PLAY that also corrects position, say), and collapsing
  // them into a single slot leaks the second one back onto the wire.
  const echo = useRef<Map<EchoKind, number[]>>(new Map());
  const expect = useCallback((kind: EchoKind) => {
    const queue = echo.current.get(kind) ?? [];
    queue.push(Date.now() + ECHO_TTL_MS);
    echo.current.set(kind, queue);
  }, []);
  const consume = useCallback((kind: EchoKind) => {
    const queue = echo.current.get(kind);
    if (!queue?.length) return false;
    const now = Date.now();
    while (queue.length && queue[0] < now) queue.shift(); // drop stale expectations
    if (!queue.length) return false;
    queue.shift();
    return true;
  }, []);

  // Position bookkeeping for seek detection and correction cooldown.
  const lastTick = useRef<{ at: number; time: number } | null>(null);
  const lastCorrection = useRef(0);
  const gestureTimeout = useRef<number | null>(null);

  // ─── Surrender the clock on unmount ────────────────────────────────────────
  // e.g. the extension attaches mid-session and RoomLayout swaps us out. Leaving
  // `active` set would keep the dead-reckoning ticker disabled and keep a stale
  // videoId on the host's heartbeat with no player left to back it up.
  useEffect(() => () => setInPageVideo(null), [setInPageVideo]);

  // ─── A viewer always follows the host's video ──────────────────────────────
  useEffect(() => {
    if (amHost) return;
    if (!hostVideo.videoId) return;
    if (hostVideo.videoId === videoId) return;
    setInPageVideo(hostVideo.videoId);
  }, [amHost, hostVideo.videoId, videoId, setInPageVideo]);

  // ─── Create / tear down the player ─────────────────────────────────────────
  useEffect(() => {
    if (!videoId || !mountRef.current) return;

    let cancelled = false;
    let player: YTPlayer | null = null;
    // Captured for the cleanup: the Map itself is stable, but reading the ref
    // during teardown is what the exhaustive-deps rule warns about.
    const pending = echo.current;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;

        player = new YT.Player(mountRef.current, {
          // The API writes these onto the iframe it creates; the wrapper's CSS
          // pins it to the box regardless, but this avoids a flash at 640x390.
          width: '100%',
          height: '100%',
          videoId,
          playerVars: {
            // playsinline is what stops iOS hijacking playback into its
            // native fullscreen player, where we lose all programmatic control.
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            // Required by YouTube whenever enablejsapi is set: it verifies the
            // embedding page against this. Omitting it makes the embed fail
            // with the undocumented error 153 on some origins and profiles —
            // intermittent enough to look like "this one video is broken".
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              playerRef.current = e.target;
              setReady(true);
              setError(null);
            },
            onStateChange: (e) => {
              if (cancelled) return;
              const p = e.target;
              if (e.data === PLAYING) {
                setNeedsGesture(false);
                if (!consume('play')) {
                  broadcastEvent('PLAY', {
                    currentTime: p.getCurrentTime(),
                    platform: 'YouTube',
                    videoId,
                    videoUrl: youTubeWatchUrl(videoId),
                  });
                }
              } else if (e.data === 2 /* PAUSED */) {
                if (!consume('pause')) {
                  broadcastEvent('PAUSE', {
                    currentTime: p.getCurrentTime(),
                    videoId,
                    videoUrl: youTubeWatchUrl(videoId),
                  });
                }
              }
            },
            onError: (e) => {
              if (!cancelled) setError(describePlayerError(e.data));
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the YouTube player.');
      });

    return () => {
      cancelled = true;
      setReady(false);
      setNeedsGesture(false);
      lastTick.current = null;
      pending.clear();
      if (gestureTimeout.current !== null) {
        window.clearTimeout(gestureTimeout.current);
        gestureTimeout.current = null;
      }
      try {
        player?.destroy();
      } catch {
        // The iframe may already be gone if the API tore it down first.
      }
      playerRef.current = null;
    };
  }, [videoId, broadcastEvent, consume]);

  // ─── Live position sampler ─────────────────────────────────────────────────
  // The host's heartbeat reads this instead of the once-a-second React state, so
  // the position it broadcasts is sampled at send time. Going through state
  // added up to a full tick of staleness to every heartbeat — a systematic bias
  // of the same order as CORRECT_THRESHOLD, which had viewers being seeked
  // backwards on a loop.
  useEffect(() => {
    if (!ready) return;
    return registerPositionSampler(() => {
      const p = playerRef.current;
      if (!p) return null;
      try {
        return { currentTime: p.getCurrentTime(), playing: p.getPlayerState() === PLAYING };
      } catch {
        return null;
      }
    });
  }, [ready, registerPositionSampler]);

  // ─── Local position reporting + seek detection ─────────────────────────────
  useEffect(() => {
    if (!ready || !videoId) return;

    const interval = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;

      let time: number;
      let playing: boolean;
      let duration: number;
      try {
        time = p.getCurrentTime();
        playing = p.getPlayerState() === PLAYING;
        duration = p.getDuration(); // 0 until metadata loads
      } catch {
        return; // player torn down between the guard and the call
      }

      // The IFrame API has no seek event, so infer one: compare where playback
      // actually is against where normal playback would have put it. Only the
      // host publishes inferred seeks — the inference is not reliable enough to
      // let an arbitrary viewer move the whole room, and a viewer that is behind
      // is already being corrected by the heartbeat.
      const prev = lastTick.current;
      const now = Date.now();
      if (prev && amHostRef.current) {
        const elapsed = (now - prev.at) / 1000;
        // A throttled/backgrounded tab produces a huge elapsed with no real
        // playback behind it. Resync the baseline instead of reading it as a seek.
        if (elapsed <= (TICK_MS / 1000) * TICK_STALL_FACTOR) {
          const expected = prev.time + (playing ? elapsed : 0);
          if (Math.abs(time - expected) > SEEK_EPSILON && !consume('seek')) {
            broadcastEvent('SEEK', {
              from: prev.time,
              to: time,
              videoId,
              videoUrl: youTubeWatchUrl(videoId),
            });
          }
        }
      }
      lastTick.current = { at: now, time };

      reportInPagePosition(time, playing, duration);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [ready, videoId, broadcastEvent, consume, reportInPagePosition]);

  // ─── Apply remote events ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !videoId) return;

    const unsubscribe = subscribeRemoteSync((event, payload) => {
      const p = playerRef.current;
      if (!p) return;

      // Ignore anything recorded against a different video.
      const remoteVid = typeof payload.videoId === 'string' ? payload.videoId : null;
      if (remoteVid && remoteVid !== videoId) return;

      const at = typeof payload.currentTime === 'number' ? payload.currentTime : null;

      /** Start playback and verify it actually started (mobile blocks autoplay). */
      const playAndVerify = () => {
        expect('play');
        p.playVideo();
        if (gestureTimeout.current !== null) window.clearTimeout(gestureTimeout.current);
        gestureTimeout.current = window.setTimeout(() => {
          gestureTimeout.current = null;
          const still = playerRef.current;
          if (!still) return;
          try {
            // BUFFERING counts as success — on a phone it's the normal state a
            // second in, and flagging it would throw a "tap to play" overlay
            // over a video that is about to start on its own.
            const state = still.getPlayerState();
            if (state !== PLAYING && state !== BUFFERING) setNeedsGesture(true);
          } catch {
            /* player gone */
          }
        }, 1500);
      };

      try {
        switch (event) {
          case 'PLAY': {
            if (at !== null && Math.abs(p.getCurrentTime() - at) > CORRECT_THRESHOLD) {
              expect('seek');
              p.seekTo(at, true);
            }
            playAndVerify();
            break;
          }
          case 'PAUSE': {
            expect('pause');
            p.pauseVideo();
            if (at !== null) {
              // Seeking a just-paused player can emit a transient PLAYING on
              // some clients; expecting a play here keeps that from being
              // rebroadcast as "someone pressed play" right after a pause.
              expect('play');
              expect('seek');
              p.seekTo(at, true);
            }
            break;
          }
          case 'SEEK': {
            const to = typeof payload.to === 'number' ? payload.to : null;
            if (to === null) break;
            expect('seek');
            p.seekTo(to, true);
            break;
          }
          case 'POSITION_UPDATE': {
            if (at === null) break;
            const hostPlaying = Boolean(payload.playing);

            // Match the host's play/pause state.
            const state = p.getPlayerState();
            if (hostPlaying && state !== PLAYING && state !== BUFFERING) {
              playAndVerify();
            } else if (!hostPlaying && state === PLAYING) {
              expect('pause');
              p.pauseVideo();
            }

            // Correct drift by seeking. Unlike the extension we can't nudge the
            // rate: the IFrame API snaps setPlaybackRate to YouTube's discrete
            // ladder (0.25/0.5/…/2), so a ±5% correction is not expressible.
            const drift = p.getCurrentTime() - at;
            const now = Date.now();
            if (
              Math.abs(drift) > CORRECT_THRESHOLD &&
              now - lastCorrection.current > CORRECT_COOLDOWN_MS
            ) {
              lastCorrection.current = now;
              expect('seek');
              p.seekTo(at, true);
            }
            break;
          }
          default:
            break;
        }
      } catch {
        // Player disposed mid-apply; the next event will find a fresh one.
      }
    });

    return unsubscribe;
  }, [ready, videoId, subscribeRemoteSync, expect]);

  // ─── Host video picker ─────────────────────────────────────────────────────
  const onSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(urlInput);
    if (!id) {
      setInputError('That doesn’t look like a YouTube link.');
      return;
    }
    setInputError(null);
    setUrlInput('');
    setInPageVideo(id);
  };

  const tapToPlay = () => {
    setNeedsGesture(false);
    expect('play');
    playerRef.current?.playVideo();
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!videoId) {
    return (
      <div className="px-4 sm:px-5 pt-2 shrink-0">
        <div className="rounded-xl border border-border bg-card p-4">
          {amHost ? (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Paste a YouTube link to play it for everyone in the room.
              </p>
              <form onSubmit={onSubmitUrl} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  inputMode="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    if (inputError) setInputError(null);
                  }}
                  placeholder="https://youtube.com/watch?v=…"
                  aria-label="YouTube video link"
                  className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary transition-colors"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shrink-0 hover:opacity-90 transition-opacity"
                >
                  Load
                </button>
              </form>
              {inputError && (
                <p className="flex items-center gap-1.5 mt-2 text-xs text-[var(--status-error)]">
                  <AlertCircle size={12} className="shrink-0" />
                  {inputError}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for the host to pick a video. It’ll start here automatically.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-5 pt-2 shrink-0">
      <div className="relative rounded-xl overflow-hidden border border-border bg-black aspect-video">
        {/*
          The IFrame API *replaces* the node it's given with its own <iframe>,
          so the mount point is keyed on videoId: without that, switching videos
          would rebuild the player into a div React had long since detached, and
          the video area would go permanently black. The child selector styles
          the iframe the API leaves behind in its place.
        */}
        <div className="absolute inset-0 [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:w-full [&>iframe]:h-full">
          <div key={videoId} ref={mountRef} />
        </div>

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-card">
            <AlertCircle size={20} className="text-[var(--status-error)]" />
            <p className="text-xs text-muted-foreground">{error}</p>
            <a
              href={youTubeWatchUrl(videoId)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline"
            >
              Open on YouTube
            </a>
          </div>
        )}

        {needsGesture && !error && (
          <button
            type="button"
            onClick={tapToPlay}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm"
          >
            <Play size={28} className="text-primary" />
            <span className="text-xs font-semibold">Tap to join playback</span>
            <span className="text-[10px] text-muted-foreground px-6 text-center">
              Your browser needs a tap before it will start the video
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1 mt-2">
        {/* A freshly loaded video sits cued: browsers won't let us start it
            without a gesture, and there's nothing on the player itself saying
            that the first press is what starts the room. */}
        {amHost && !playbackState.playing && !error ? (
          <p className="text-xs text-primary">Press play to start it for everyone</p>
        ) : (
          <span />
        )}

        {amHost && (
          <button
            type="button"
            onClick={() => setInPageVideo(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Change video
          </button>
        )}
      </div>
    </div>
  );
}
