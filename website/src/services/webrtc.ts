/**
 * WebRTC call manager — mesh video/audio calls between room participants.
 *
 * Media never touches our servers: peers connect directly (or via STUN/TURN for
 * NAT traversal), and signaling (SDP offers/answers, ICE candidates) piggybacks
 * on the room's existing Supabase Realtime channel as WEBRTC_SIGNAL broadcasts,
 * addressed to a single recipient the same way the rest of the app already
 * broadcasts room-wide events.
 *
 * The design goal is that a join *always* connects, whenever it happens and
 * however many people join at once. Five properties get us there:
 *
 *  1. Deterministic initiator. For any pair, the lower userId makes the first
 *     offer and the higher one waits. Two people joining simultaneously can no
 *     longer both offer, so the fragile glare/rollback path is never exercised
 *     during initial connect. (Perfect negotiation is still implemented as a
 *     safety net for any later renegotiation.)
 *
 *  2. Fixed transceivers. Every connection is built with exactly one audio and
 *     one video transceiver up front, in the same order, whether or not we have
 *     a camera. Tracks are swapped in with replaceTrack. Turning the camera on
 *     mid-call therefore needs no renegotiation at all — which is what used to
 *     produce "one person can see the other but not vice versa".
 *
 *  3. Nothing is dropped. Incoming signals are handled through a per-peer
 *     promise queue (so setRemote/setLocalDescription can never interleave),
 *     remote ICE candidates arriving before the answer are buffered instead of
 *     thrown away, and signals that land before our own getUserMedia resolves
 *     are replayed rather than discarded.
 *
 *  4. Nothing is sent too fast. Local ICE candidates are coalesced into batched
 *     messages, because Realtime enforces a per-client event rate limit and a
 *     dropped candidate is an unexplained connection failure.
 *
 *  5. Self-healing. A watchdog re-checks every peer on a timer: it recreates
 *     missing connections, restarts ICE on stalled ones, and rebuilds dead ones
 *     from scratch (coordinated with the far side via a `reset` signal and a
 *     generation counter). It keeps trying for as long as both people are in
 *     the call, so a transient failure recovers instead of stranding the tile
 *     on "Connecting…" forever.
 */

import type { RealtimeChannel } from './realtimeService';
import type { CallMediaError, PeerConnectionStatus, WebrtcSignalPayload } from '@/types/room';

/**
 * Phones default to capturing at far higher resolution than a mesh call can
 * afford — every participant receives a copy of it, over mobile upload. Asking
 * for 640×360/24fps keeps a tile sharp while leaving the link headroom, and
 * `ideal` (not `exact`) means a device that can't do it still gets a stream
 * rather than an OverconstrainedError.
 */
const videoConstraints = (facing: 'user' | 'environment'): MediaTrackConstraints => ({
  facingMode: facing,
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
});

/**
 * Explicit rather than left to the browser: on a phone held in the hand, the
 * speaker feeds straight back into the mic, and echo cancellation is the
 * difference between a usable call and howling feedback.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Why getUserMedia can't even be attempted, or null if it can.
 *
 * getUserMedia is gated on a secure context, so `navigator.mediaDevices` is
 * simply absent over plain http. Phones hit this constantly — opening a dev
 * server at http://192.168.x.x has no camera or mic — and the failure otherwise
 * surfaces as a bare TypeError that reads exactly like a denied permission.
 */
function mediaUnavailableReason(): CallMediaError | null {
  if (typeof navigator === 'undefined') return 'unavailable';
  // Typed as always present, but genuinely absent outside a secure context —
  // which is exactly the case this function exists to detect.
  const devices: MediaDevices | undefined = navigator.mediaDevices;
  if (typeof devices?.getUserMedia === 'function') return null;
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  return secure ? 'unavailable' : 'insecure';
}

/**
 * STUN alone cannot traverse symmetric NAT, which is common on mobile carriers
 * and corporate networks — those calls simply never connect without a relay.
 * OpenRelay is a free public TURN service (the project's cost goal rules out a
 * paid one by default); set NEXT_PUBLIC_TURN_* to point at your own if you'd
 * rather not depend on it.
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  const customUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (customUrl) {
    servers.push({
      urls: customUrl.split(',').map((u) => u.trim()),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
    return servers;
  }

  servers.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
  return servers;
}

/** Total in-call participants (including the joiner) above which a new join defaults to audio-only. */
const VIDEO_PARTICIPANT_THRESHOLD = 5;

/** How often the watchdog re-checks every peer connection. */
const WATCHDOG_INTERVAL_MS = 2000;
/** No progress for this long → restart ICE (initiator side drives this). */
const ICE_RESTART_AFTER_MS = 8000;
/** Still no progress for this long → tear the connection down and rebuild it. */
const REBUILD_AFTER_MS = 16000;
/** The waiting side holds off this much longer, so the two sides don't both rebuild. */
const RESPONDER_PATIENCE = 1.6;
/** Local ICE candidates are coalesced for this long before being sent as one message. */
const ICE_BATCH_MS = 120;
/** Signals that arrive before we're in the call are replayed for this long, then dropped. */
const PREJOIN_BUFFER_MS = 20000;
/**
 * A peer who greeted us directly is treated as in-call for this long even if the
 * presence roster hasn't caught up. Without it, a `hello` that beats presence
 * would build a connection that the next presence sync immediately tears down.
 */
const HELLO_GRACE_MS = 15000;

/**
 * Screen share is captured far above the camera cap — a 640×360 spreadsheet is
 * unreadable. Frame rate goes the other way: screen content is mostly static,
 * so spending the bitrate on resolution rather than motion is the right trade.
 */
const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 15, max: 30 },
  },
  audio: false,
};

/** True where the browser can capture a screen at all — no mobile browser can. */
function canCaptureScreen(): boolean {
  if (typeof navigator === 'undefined') return false;
  const devices: MediaDevices | undefined = navigator.mediaDevices;
  return typeof devices?.getDisplayMedia === 'function';
}

export interface LocalCallState {
  inCall: boolean;
  cameraOn: boolean;
  micOn: boolean;
  /** null = not yet requested, false = the user denied camera/mic permission. */
  hasMediaPermission: boolean | null;
  /** Set when we're in the call without local media — see CallMediaError. */
  mediaError: CallMediaError | null;
  screenSharing: boolean;
  canScreenShare: boolean;
}

type RemoteStreamHandler = (userId: string, stream: MediaStream | null) => void;
type PeerStatusHandler = (userId: string, status: PeerConnectionStatus) => void;
type LocalStateHandler = (state: LocalCallState) => void;
type BandwidthSafeguardHandler = () => void;

interface PeerEntry {
  peerId: string;
  pc: RTCPeerConnection;
  /** Connection generation — see WebrtcSignalPayload.gen. */
  gen: number;
  /** Perfect-negotiation role: the polite peer yields on an offer collision. */
  polite: boolean;
  /** True when we make the opening offer for this pair (the lower userId does). */
  initiator: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  /** Remote candidates that arrived before setRemoteDescription — applied on flush. */
  pendingCandidates: RTCIceCandidateInit[];
  /** Local candidates waiting to be sent as one batched message. */
  outboundCandidates: RTCIceCandidateInit[];
  iceFlushTimer: ReturnType<typeof setTimeout> | null;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  /** Last time this connection did something encouraging — drives the watchdog. */
  lastProgressAt: number;
  /** True once we've announced ourselves, so `hello` can't ping-pong forever. */
  greeted: boolean;
}

export interface CallManager {
  join: () => Promise<void>;
  leave: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  /** Switch between front/back camera. No-op on desktop or when the camera is off. */
  switchCamera: () => Promise<void>;
  /** Start or stop sending the screen in place of the camera. */
  toggleScreenShare: () => Promise<void>;
  /** The display capture, for rendering our own tile while sharing. */
  getScreenStream: () => MediaStream | null;
  /** Tell the manager who else is currently in the call (drives peer connection lifecycle). */
  syncPeers: (peerIds: string[]) => void;
  getLocalStream: () => MediaStream | null;
  onRemoteStream: (handler: RemoteStreamHandler) => () => void;
  onPeerStatusChange: (handler: PeerStatusHandler) => () => void;
  onLocalStateChange: (handler: LocalStateHandler) => () => void;
  onBandwidthSafeguard: (handler: BandwidthSafeguardHandler) => () => void;
  /** Tear everything down — call on room disconnect. */
  destroy: () => void;
}

function mapConnectionState(state: RTCPeerConnectionState): PeerConnectionStatus {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'closed';
    default:
      // 'disconnected' is reported as connecting, not closed: it's usually a
      // transient blip that ICE recovers from on its own, and the watchdog is
      // what decides when it has gone on too long.
      return 'connecting';
  }
}

export function createCallManager(channel: RealtimeChannel, localUserId: string): CallManager {
  const iceServers = buildIceServers();
  const peers = new Map<string, PeerEntry>();
  const remoteStreams = new Map<string, MediaStream>();
  /** Serializes signal handling per peer — see handleSignal. */
  const signalQueues = new Map<string, Promise<void>>();
  /** Highest generation we've used for a peer, kept across rebuilds. */
  const generations = new Map<string, number>();
  /** Signals that arrived before we finished joining, replayed once we're in. */
  let prejoinBuffer: { senderId: string; signal: WebrtcSignalPayload; at: number }[] = [];
  /** peerId → when they last announced themselves, for the presence-lag grace period. */
  const helloPeers = new Map<string, number>();
  /** Everyone we believe is in the call: the presence roster plus recent greeters. */
  let currentPeerIds = new Set<string>();
  /** Latest presence-derived roster, kept so the grace period can be re-applied. */
  let presencePeerIds = new Set<string>();
  let watchdog: ReturnType<typeof setInterval> | null = null;

  let localStream: MediaStream | null = null;
  let screenStream: MediaStream | null = null;
  let screenSharing = false;
  let facingMode: 'user' | 'environment' = 'user';
  let inCall = false;
  let cameraOn = false;
  let micOn = false;
  let hasMediaPermission: boolean | null = null;
  let mediaError: CallMediaError | null = null;

  const remoteStreamHandlers = new Set<RemoteStreamHandler>();
  const peerStatusHandlers = new Set<PeerStatusHandler>();
  const localStateHandlers = new Set<LocalStateHandler>();
  const bandwidthSafeguardHandlers = new Set<BandwidthSafeguardHandler>();

  const emitLocalState = () => {
    // Mirrors the same updatePresence() mechanism already used for username/role,
    // so UsersPanel and a video tile grid both read from one presence roster.
    channel.updatePresence({ inCall, cameraOn, micOn, screenSharing });
    const state: LocalCallState = {
      inCall,
      cameraOn,
      micOn,
      hasMediaPermission,
      mediaError,
      screenSharing,
      canScreenShare: canCaptureScreen(),
    };
    localStateHandlers.forEach((h) => h(state));
  };

  const emitStatus = (peerId: string, status: PeerConnectionStatus) => {
    peerStatusHandlers.forEach((h) => h(peerId, status));
  };

  const sendSignal = (
    to: string,
    kind: WebrtcSignalPayload['kind'],
    data: unknown,
    gen?: number
  ) => {
    const payload: WebrtcSignalPayload = { to, kind, data, gen };
    channel.broadcast('WEBRTC_SIGNAL', payload as unknown as Record<string, unknown>);
  };

  // ─── Peer lifecycle ────────────────────────────────────────────────────────

  /** Sends whatever local candidates have accumulated as a single message. */
  const flushOutboundCandidates = (entry: PeerEntry) => {
    if (entry.iceFlushTimer) {
      clearTimeout(entry.iceFlushTimer);
      entry.iceFlushTimer = null;
    }
    if (entry.outboundCandidates.length === 0) return;
    const batch = entry.outboundCandidates;
    entry.outboundCandidates = [];
    sendSignal(entry.peerId, 'ice', batch, entry.gen);
  };

  /** Applies remote candidates that had to wait for setRemoteDescription. */
  const flushPendingCandidates = async (entry: PeerEntry) => {
    if (!entry.pc.remoteDescription) return;
    const queued = entry.pendingCandidates;
    entry.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!entry.ignoreOffer) console.warn('[SyncFlix] Failed to add ICE candidate:', err);
      }
    }
  };

  /** Removes a peer's connection without telling the UI the participant is gone. */
  const teardownPeer = (peerId: string, opts: { keepStream: boolean }) => {
    const entry = peers.get(peerId);
    if (!entry) return;
    if (entry.iceFlushTimer) clearTimeout(entry.iceFlushTimer);
    entry.pc.onnegotiationneeded = null;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;
    try {
      entry.pc.close();
    } catch {
      // already closed — nothing to do
    }
    peers.delete(peerId);
    if (!opts.keepStream) {
      remoteStreams.delete(peerId);
      remoteStreamHandlers.forEach((h) => h(peerId, null));
    }
  };

  /** The participant left the call — drop the connection and their tile state. */
  const closePeer = (peerId: string) => {
    if (!peers.has(peerId) && !remoteStreams.has(peerId)) return;
    teardownPeer(peerId, { keepStream: false });
    signalQueues.delete(peerId);
    generations.delete(peerId);
    emitStatus(peerId, 'closed');
  };

  const attachLocalTracks = (entry: PeerEntry) => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack && entry.audioSender) void entry.audioSender.replaceTrack(audioTrack);
    // Someone joining mid-share must receive the screen, not the camera.
    const videoTrack = screenSharing
      ? screenStream?.getVideoTracks()[0]
      : localStream?.getVideoTracks()[0];
    if (videoTrack && entry.videoSender) void entry.videoSender.replaceTrack(videoTrack);
  };

  const createPeerEntry = (peerId: string, gen: number): PeerEntry => {
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 });
    const entry: PeerEntry = {
      peerId,
      pc,
      gen,
      // Opposite on the two sides, as perfect negotiation requires.
      polite: localUserId > peerId,
      initiator: localUserId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      outboundCandidates: [],
      iceFlushTimer: null,
      audioSender: null,
      videoSender: null,
      lastProgressAt: Date.now(),
      greeted: false,
    };

    // Both sides build the same m-line layout up front — one audio, one video,
    // in that order — regardless of what media either of us actually has. Every
    // later media change is a replaceTrack into these fixed slots, so the call
    // never has to renegotiate and can never end up with mismatched sections.
    const streams = localStream ? [localStream] : [];
    try {
      entry.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv', streams }).sender;
      entry.videoSender = pc.addTransceiver('video', { direction: 'sendrecv', streams }).sender;
    } catch (err) {
      console.warn('[SyncFlix] Failed to set up transceivers:', err);
    }
    attachLocalTracks(entry);

    pc.onnegotiationneeded = () => {
      // The responder stays quiet until the opening offer/answer round has
      // completed; otherwise adding our transceivers above would make both
      // sides offer at once, which is the collision we're avoiding entirely.
      if (!entry.initiator && !pc.currentRemoteDescription) return;
      queueSignalWork(peerId, () => makeOffer(entry));
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) {
        // End of gathering — send whatever is left immediately.
        flushOutboundCandidates(entry);
        return;
      }
      entry.outboundCandidates.push(candidate.toJSON());
      if (!entry.iceFlushTimer) {
        entry.iceFlushTimer = setTimeout(() => {
          entry.iceFlushTimer = null;
          flushOutboundCandidates(entry);
        }, ICE_BATCH_MS);
      }
    };

    pc.ontrack = (event) => {
      // With fixed transceivers a track can arrive before the far side has any
      // media attached, and some browsers hand us no stream in that case — fall
      // back to a per-peer stream so the track is never silently dropped.
      let stream = event.streams[0] ?? remoteStreams.get(peerId);
      if (!stream) stream = new MediaStream();
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      remoteStreams.set(peerId, stream);
      const publish = () => {
        const current = remoteStreams.get(peerId);
        if (current) remoteStreamHandlers.forEach((h) => h(peerId, current));
      };
      publish();
      // A track that starts muted (camera off at connect time) unmutes later
      // without any further signaling — re-publish so the tile picks it up.
      event.track.onunmute = publish;
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        entry.lastProgressAt = Date.now();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') entry.lastProgressAt = Date.now();
      emitStatus(peerId, mapConnectionState(pc.connectionState));
    };

    return entry;
  };

  /**
   * Returns the connection for a peer, creating it if needed. A `remoteGen`
   * newer than ours means the far side rebuilt — we rebuild to match, so both
   * ends are always talking through the same generation of connection.
   */
  const ensurePeer = (peerId: string, remoteGen = 0): PeerEntry => {
    const existing = peers.get(peerId);
    if (existing && remoteGen > existing.gen) {
      teardownPeer(peerId, { keepStream: true });
    } else if (existing) {
      return existing;
    }

    const gen = Math.max(remoteGen, generations.get(peerId) ?? 0);
    generations.set(peerId, gen);
    const entry = createPeerEntry(peerId, gen);
    peers.set(peerId, entry);
    emitStatus(peerId, 'connecting');
    // The lower userId opens the conversation; the higher one waits for it.
    if (entry.initiator) queueSignalWork(peerId, () => makeOffer(entry));
    return entry;
  };

  /** Give up on a wedged connection and build a fresh one on both sides. */
  const rebuildPeer = (peerId: string) => {
    const gen = (generations.get(peerId) ?? 0) + 1;
    generations.set(peerId, gen);
    teardownPeer(peerId, { keepStream: true });
    emitStatus(peerId, 'connecting');
    sendSignal(peerId, 'reset', null, gen);
    ensurePeer(peerId, gen);
  };

  const makeOffer = async (entry: PeerEntry) => {
    const { pc } = entry;
    if (pc.signalingState === 'closed' || peers.get(entry.peerId) !== entry) return;
    try {
      entry.makingOffer = true;
      await pc.setLocalDescription();
      if (peers.get(entry.peerId) !== entry) return; // rebuilt while we awaited
      sendSignal(entry.peerId, 'offer', pc.localDescription, entry.gen);
    } catch (err) {
      console.warn('[SyncFlix] WebRTC negotiation failed:', err);
    } finally {
      entry.makingOffer = false;
    }
  };

  // ─── Signal handling ───────────────────────────────────────────────────────

  /**
   * Runs peer work one item at a time. setLocalDescription/setRemoteDescription
   * are async, and letting two signals interleave leaves the connection in a
   * signaling state the next call rejects — which used to wedge a peer for good.
   */
  const queueSignalWork = (peerId: string, work: () => Promise<void>) => {
    const previous = signalQueues.get(peerId) ?? Promise.resolve();
    const next = previous.then(work).catch((err) => {
      console.warn('[SyncFlix] WebRTC signal handling failed:', err);
    });
    signalQueues.set(peerId, next);
    return next;
  };

  const applyDescription = async (entry: PeerEntry, description: RTCSessionDescriptionInit) => {
    const { pc } = entry;

    if (description.type === 'answer') {
      // An answer is only meaningful against an offer we still have outstanding.
      // Applying one in any other state throws and breaks the connection.
      if (pc.signalingState !== 'have-local-offer') return;
      entry.isSettingRemoteAnswerPending = true;
      try {
        await pc.setRemoteDescription(description);
      } finally {
        entry.isSettingRemoteAnswerPending = false;
      }
      await flushPendingCandidates(entry);
      return;
    }

    // Perfect negotiation — only reachable via renegotiation, since the opening
    // exchange has a single designated offerer.
    // https://developer.mozilla.org/docs/Web/API/WebRTC_API/Perfect_negotiation
    const readyForOffer =
      !entry.makingOffer && (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending);
    entry.ignoreOffer = !entry.polite && !readyForOffer;
    if (entry.ignoreOffer) return;

    await pc.setRemoteDescription(description); // implicit rollback when polite
    if (peers.get(entry.peerId) !== entry) return;
    await flushPendingCandidates(entry);
    await pc.setLocalDescription();
    if (peers.get(entry.peerId) !== entry) return;
    sendSignal(entry.peerId, 'answer', pc.localDescription, entry.gen);
  };

  const processSignal = async (peerId: string, signal: WebrtcSignalPayload) => {
    const remoteGen = typeof signal.gen === 'number' ? signal.gen : 0;

    if (signal.kind === 'bye') {
      helloPeers.delete(peerId);
      presencePeerIds.delete(peerId);
      currentPeerIds.delete(peerId);
      closePeer(peerId);
      return;
    }

    if (signal.kind === 'hello') {
      const known = peers.has(peerId);
      helloPeers.set(peerId, Date.now());
      currentPeerIds.add(peerId);
      const entry = ensurePeer(peerId);
      // Answer a greeting from someone we hadn't heard of, so they learn about
      // us too even if presence hasn't propagated. Once is enough — replying to
      // replies would loop forever.
      if (!known && !entry.greeted) {
        entry.greeted = true;
        sendSignal(peerId, 'hello', null);
      }
      return;
    }

    if (signal.kind === 'reset') {
      generations.set(peerId, Math.max(remoteGen, generations.get(peerId) ?? 0));
      const existing = peers.get(peerId);
      if (existing && remoteGen > existing.gen) teardownPeer(peerId, { keepStream: true });
      ensurePeer(peerId, remoteGen);
      return;
    }

    const entry = ensurePeer(peerId, remoteGen);
    // A straggler from a connection we've already replaced — applying it would
    // corrupt the live one.
    if (remoteGen < entry.gen) return;

    if (signal.kind === 'offer' || signal.kind === 'answer') {
      await applyDescription(entry, signal.data as RTCSessionDescriptionInit);
      return;
    }

    if (signal.kind === 'ice') {
      // Batched by the sender; tolerate a bare candidate too.
      const raw = signal.data;
      const candidates = (Array.isArray(raw) ? raw : [raw]) as RTCIceCandidateInit[];
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (!entry.pc.remoteDescription) {
          // Candidates routinely beat the description they belong to. Holding
          // them until it lands is the difference between a connection and a
          // silent failure — addIceCandidate would just throw them away.
          entry.pendingCandidates.push(candidate);
          continue;
        }
        try {
          await entry.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!entry.ignoreOffer) console.warn('[SyncFlix] Failed to add ICE candidate:', err);
        }
      }
    }
  };

  channel.subscribe('WEBRTC_SIGNAL', (payload, senderId) => {
    if (!senderId || senderId === localUserId) return;
    const signal = payload as unknown as WebrtcSignalPayload;
    if (!signal || (signal.to !== localUserId && signal.to !== '*')) return;
    if (!inCall) {
      // We may still be inside getUserMedia while a peer is already offering.
      // Hold the signal briefly and replay it rather than losing the whole
      // negotiation to a few hundred milliseconds of timing.
      const now = Date.now();
      prejoinBuffer = prejoinBuffer.filter((item) => now - item.at < PREJOIN_BUFFER_MS).slice(-100);
      prejoinBuffer.push({ senderId, signal, at: now });
      return;
    }
    queueSignalWork(senderId, () => processSignal(senderId, signal));
  });

  // ─── Watchdog ──────────────────────────────────────────────────────────────

  /**
   * Re-checks every expected peer on a timer and escalates: create what's
   * missing → restart ICE on what's stalled → rebuild what's dead. It never
   * stops trying while both people are in the call, so a connection that fails
   * for any reason gets another chance a few seconds later.
   */
  const runWatchdog = () => {
    if (!inCall) return;
    const now = Date.now();

    // Re-derives the peer set and opens/closes connections to match, so a
    // dropped presence event self-corrects within a tick.
    reconcilePeers();

    // Snapshot: rebuildPeer() replaces entries in `peers`, and a Map visits
    // anything added mid-iteration — which would rebuild the same peer twice.
    Array.from(peers.keys()).forEach((peerId) => {
      const entry = peers.get(peerId);
      if (!entry || !currentPeerIds.has(peerId)) return;
      const state = entry.pc.connectionState;
      if (state === 'connected') {
        entry.lastProgressAt = now;
        return;
      }

      const stalledFor = now - entry.lastProgressAt;
      // The responder waits longer before acting so the two sides don't both
      // tear the connection down and chase each other's rebuilds.
      const patience = entry.initiator ? 1 : RESPONDER_PATIENCE;

      if (state === 'failed' || stalledFor > REBUILD_AFTER_MS * patience) {
        rebuildPeer(peerId);
        return;
      }

      if (stalledFor > ICE_RESTART_AFTER_MS * patience && entry.initiator) {
        try {
          entry.pc.restartIce(); // fires onnegotiationneeded → fresh offer
          entry.lastProgressAt = now;
        } catch (err) {
          console.warn('[SyncFlix] ICE restart failed:', err);
        }
      }
    });
  };

  const startWatchdog = () => {
    if (watchdog) return;
    watchdog = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
  };

  const stopWatchdog = () => {
    if (!watchdog) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Reconciles the peer set against the presence roster plus anyone who greeted
   * us inside the grace window, then opens what's missing and closes what's
   * gone. Called on every presence change and on every watchdog tick, so a
   * missed presence event can't leave a participant permanently unconnected.
   */
  const reconcilePeers = () => {
    const next = new Set(presencePeerIds);
    const cutoff = Date.now() - HELLO_GRACE_MS;
    helloPeers.forEach((at, id) => {
      if (at > cutoff) next.add(id);
      else helloPeers.delete(id);
    });
    currentPeerIds = next;
    if (!inCall) return;

    next.forEach((peerId) => {
      const isNew = !peers.has(peerId);
      const entry = ensurePeer(peerId);
      if (isNew && !entry.greeted) {
        entry.greeted = true;
        sendSignal(peerId, 'hello', null);
      }
    });

    Array.from(peers.keys())
      .filter((id) => !next.has(id))
      .forEach((id) => closePeer(id));
  };

  const syncPeers = (peerIds: string[]) => {
    presencePeerIds = new Set(peerIds.filter((id) => id !== localUserId));
    reconcilePeers();
  };

  const join = async () => {
    if (inCall) return;
    // +1 for the joiner themself: joining as e.g. the 6th participant defaults
    // to audio-only so a rare big group call doesn't choke everyone's upload.
    const wantVideo = currentPeerIds.size + 1 <= VIDEO_PARTICIPANT_THRESHOLD;

    const blocked = mediaUnavailableReason();
    if (blocked) {
      // Nothing to ask for — getUserMedia doesn't exist here. Join receive-only
      // so the room is still usable, and let the UI explain the real reason.
      localStream = new MediaStream();
      hasMediaPermission = false;
      mediaError = blocked;
    } else {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? videoConstraints(facingMode) : false,
          audio: AUDIO_CONSTRAINTS,
        });
        hasMediaPermission = true;
        mediaError = null;
      } catch {
        try {
          // Camera may be unavailable/denied while mic still works — degrade rather than fail outright.
          localStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: AUDIO_CONSTRAINTS,
          });
          hasMediaPermission = true;
          mediaError = null;
        } catch (err) {
          // No devices at all. Join anyway, receive-only: being able to see and
          // hear everyone else is far better than being locked out of the call.
          console.warn('[SyncFlix] Camera/mic unavailable, joining receive-only:', err);
          localStream = new MediaStream();
          hasMediaPermission = false;
          mediaError =
            err instanceof DOMException && err.name === 'NotFoundError' ? 'unavailable' : 'denied';
        }
      }
    }

    inCall = true;
    cameraOn = localStream.getVideoTracks().length > 0;
    micOn = localStream.getAudioTracks().length > 0;
    if (!wantVideo && currentPeerIds.size > 0) {
      bandwidthSafeguardHandlers.forEach((h) => h());
    }
    emitLocalState();

    // Announce once to the whole room rather than per peer — presence may not
    // have told us about everyone yet, and this is one message either way.
    sendSignal('*', 'hello', null);
    currentPeerIds.forEach((peerId) => {
      const entry = ensurePeer(peerId);
      entry.greeted = true;
    });

    // Replay anything that arrived while getUserMedia was still resolving.
    const buffered = prejoinBuffer;
    prejoinBuffer = [];
    const now = Date.now();
    buffered
      .filter((item) => now - item.at < PREJOIN_BUFFER_MS)
      .forEach(({ senderId, signal }) => {
        queueSignalWork(senderId, () => processSignal(senderId, signal));
      });

    startWatchdog();
  };

  /**
   * Re-acquire capture tracks the OS took away from us.
   *
   * Locking a phone or switching apps ends the camera and mic tracks outright —
   * they don't resume when you come back, so without this you'd return to the
   * call still "on" but publishing nothing, and everyone would be staring at a
   * frozen frame. Recovered tracks go into the existing transceivers via
   * replaceTrack, so nothing has to renegotiate.
   */
  const recoverLocalMedia = async () => {
    if (!inCall || !localStream || mediaUnavailableReason()) return;

    const videoDead =
      cameraOn && (localStream.getVideoTracks()[0]?.readyState ?? 'ended') === 'ended';
    const audioDead = micOn && (localStream.getAudioTracks()[0]?.readyState ?? 'ended') === 'ended';
    if (!videoDead && !audioDead) return;

    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: videoDead ? videoConstraints(facingMode) : false,
        audio: audioDead ? AUDIO_CONSTRAINTS : false,
      });
      if (!inCall || !localStream) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }
      fresh.getTracks().forEach((track) => {
        const stale = localStream!.getTracks().find((t) => t.kind === track.kind);
        if (stale) localStream!.removeTrack(stale);
        localStream!.addTrack(track);
        if (track.kind === 'audio') {
          peers.forEach((entry) => void entry.audioSender?.replaceTrack(track));
        }
      });
      // Video goes through publishVideoTrack so a recovery mid-share doesn't
      // replace the screen with the camera.
      publishVideoTrack();
      emitLocalState();
    } catch (err) {
      console.warn('[SyncFlix] Failed to recover camera/mic after backgrounding:', err);
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void recoverLocalMedia();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  const leave = () => {
    if (!inCall) return;
    stopScreenShare();
    stopWatchdog();
    sendSignal('*', 'bye', null);
    Array.from(peers.keys()).forEach((id) => closePeer(id));
    signalQueues.clear();
    generations.clear();
    helloPeers.clear();
    prejoinBuffer = [];
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    inCall = false;
    cameraOn = false;
    micOn = false;
    mediaError = null;
    emitLocalState();
  };

  const toggleMic = () => {
    if (!inCall || !localStream) return;
    const audioTracks = localStream.getAudioTracks();
    // Joined receive-only (no mic granted) — don't advertise an unmuted mic that
    // isn't sending anything.
    if (audioTracks.length === 0) return;
    micOn = !micOn;
    audioTracks.forEach((track) => (track.enabled = micOn));
    emitLocalState();
  };

  const toggleCamera = async () => {
    if (!inCall || !localStream) return;
    if (cameraOn) {
      localStream.getVideoTracks().forEach((track) => (track.enabled = false));
      cameraOn = false;
      emitLocalState();
      return;
    }
    const existingTrack = localStream.getVideoTracks()[0];
    if (existingTrack) {
      existingTrack.enabled = true;
      cameraOn = true;
      emitLocalState();
      return;
    }
    // First time turning the camera on this call (e.g. joined audio-only under
    // the bandwidth safeguard, or permission was granted after joining).
    // The video transceiver already exists on every connection, so dropping the
    // track into it needs no renegotiation — and nothing can collide.
    if (mediaUnavailableReason()) return;
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(facingMode),
      });
      const [track] = videoStream.getVideoTracks();
      if (!track) return;
      localStream.addTrack(track);
      // Goes through publishVideoTrack so enabling the camera mid-share stages
      // it behind the screen rather than yanking the screen off the wire.
      publishVideoTrack();
      cameraOn = true;
      if (hasMediaPermission === false) hasMediaPermission = true;
      mediaError = null;
      emitLocalState();
    } catch (err) {
      console.warn('[SyncFlix] Failed to enable camera:', err);
    }
  };

  /**
   * Puts whatever the video transceivers should currently be sending into them.
   * Screen capture wins over the camera while it's running; when it stops the
   * camera slides back into the same senders. The transceivers are fixed, so
   * every one of these swaps is a replaceTrack and none of them renegotiate.
   */
  const publishVideoTrack = () => {
    const track = screenSharing
      ? (screenStream?.getVideoTracks()[0] ?? null)
      : (localStream?.getVideoTracks()[0] ?? null);
    peers.forEach((entry) => {
      void entry.videoSender?.replaceTrack(track);
    });
  };

  const stopScreenShare = () => {
    if (!screenSharing) return;
    screenStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    screenStream = null;
    screenSharing = false;
    publishVideoTrack();
    emitLocalState();
  };

  const startScreenShare = async () => {
    if (!inCall || screenSharing || !canCaptureScreen()) return;
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
      const [track] = captured.getVideoTracks();
      if (!track) {
        captured.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!inCall) {
        // Hung up while the picker was open.
        captured.getTracks().forEach((t) => t.stop());
        return;
      }
      // The browser's own "Stop sharing" bar bypasses our button entirely, so
      // the track ending is the authoritative signal to put the camera back.
      track.onended = () => stopScreenShare();
      screenStream = captured;
      screenSharing = true;
      publishVideoTrack();
      emitLocalState();
    } catch (err) {
      // Cancelling the picker rejects — that's a normal outcome, not a failure.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        console.warn('[SyncFlix] Screen share failed:', err);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (screenSharing) stopScreenShare();
    else await startScreenShare();
  };

  const switchCamera = async () => {
    if (!inCall || !cameraOn || !localStream || mediaUnavailableReason()) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(nextFacing),
      });
      const [newTrack] = newStream.getVideoTracks();
      if (!newTrack) return;
      const [oldTrack] = localStream.getVideoTracks();
      if (oldTrack) {
        localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStream.addTrack(newTrack);
      // replaceTrack keeps the existing transceiver — no renegotiation needed.
      publishVideoTrack();
      facingMode = nextFacing;
    } catch (err) {
      console.warn('[SyncFlix] Failed to switch camera:', err);
    }
  };

  return {
    join,
    leave,
    toggleCamera,
    toggleMic,
    switchCamera,
    toggleScreenShare,
    getScreenStream: () => screenStream,
    syncPeers,
    getLocalStream: () => localStream,
    onRemoteStream: (handler) => {
      remoteStreamHandlers.add(handler);
      return () => remoteStreamHandlers.delete(handler);
    },
    onPeerStatusChange: (handler) => {
      peerStatusHandlers.add(handler);
      return () => peerStatusHandlers.delete(handler);
    },
    onLocalStateChange: (handler) => {
      localStateHandlers.add(handler);
      return () => localStateHandlers.delete(handler);
    },
    onBandwidthSafeguard: (handler) => {
      bandwidthSafeguardHandlers.add(handler);
      return () => bandwidthSafeguardHandlers.delete(handler);
    },
    destroy: () => {
      leave();
      stopWatchdog();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      remoteStreamHandlers.clear();
      peerStatusHandlers.clear();
      localStateHandlers.clear();
      bandwidthSafeguardHandlers.clear();
    },
  };
}
