'use client';

/**
 * RoomContext — live room state, backed by a Supabase Realtime channel.
 *
 * Everything the room UI reads (users, playback, sync, chat, event log) is
 * derived from two realtime primitives:
 *   - Presence  → the connected-user roster
 *   - Broadcast → sync events (PLAY/PAUSE/SEEK/POSITION_UPDATE/PLAYBACK_SPEED),
 *                 chat messages, and platform changes
 *
 * There is no database and no auth. Identity is an anonymous userId + username
 * held in sessionStorage. The room exists only while someone is connected.
 *
 * Playback is host-authoritative: the host broadcasts position heartbeats and
 * discrete events; viewers apply them and measure their drift against the host.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type {
  RoomContextState,
  Room,
  PresenceUser,
  PlaybackState,
  SyncState,
  ExtensionState,
  HostVideo,
  InPagePlayerState,
  SyncEvent,
  ChatMessage,
  SyncEventType,
  UserRole,
  VideoCallState,
} from '@/types/room';
import { createRealtimeChannel, type RealtimeChannel } from '@/services/realtimeService';
import { createCallManager, type CallManager } from '@/services/webrtc';
import {
  connectExtensionBridge,
  sendSyncEventToExtension,
  sendHostVideoToExtension,
} from '@/services/extensionBridge';
import { getSessionIdentity } from '@/utils/session';
import { youTubeWatchUrl } from '@/services/youtube';
import { toast } from 'sonner';

/** A remote sync event, delivered to the in-page player so it can apply it. */
export type RemoteSyncHandler = (event: SyncEventType, payload: Record<string, unknown>) => void;

interface RoomContextValue extends RoomContextState {
  sendChatMessage: (message: string) => void;
  copyRoomCode: () => void;
  leaveRoom: () => void;
  broadcastEvent: (type: SyncEventType, payload: Record<string, unknown>) => void;

  // ─── Video call ─────────────────────────────────────────────────────────────
  videoCallState: VideoCallState;
  /** Live remote streams keyed by userId, for rendering video tiles. */
  remoteStreams: Record<string, MediaStream>;
  joinCall: () => void;
  leaveCall: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  /** Switch front/back camera. No-op on desktop or when the camera is off. */
  switchCamera: () => void;
  /** Not reactive state — read imperatively (e.g. to set a <video> srcObject). */
  getLocalCallStream: () => MediaStream | null;

  // ─── In-page player plumbing ───────────────────────────────────────────────
  /** Declare the video the in-page player holds (null tears the player down). */
  setInPageVideo: (videoId: string | null) => void;
  /**
   * Report the in-page player's real position. Updates local state only — the
   * host's heartbeat interval is what puts it on the wire, exactly as with the
   * extension's POSITION_UPDATE.
   */
  reportInPagePosition: (currentTime: number, playing: boolean, duration?: number) => void;
  /** Subscribe to remote sync events. Returns an unsubscribe function. */
  subscribeRemoteSync: (handler: RemoteSyncHandler) => () => void;
  /**
   * Register a function the host heartbeat can call to read the player's real
   * position at send time. Returns an unregister function.
   */
  registerPositionSampler: (sampler: PositionSampler) => () => void;
}

/** Reads live playback position straight from the player. Null if unavailable. */
export type PositionSampler = () => { currentTime: number; playing: boolean } | null;

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}

interface RoomProviderProps {
  children: React.ReactNode;
  roomCode?: string;
  isHost?: boolean;
}

/** How often the host broadcasts its position, in ms. */
const HEARTBEAT_INTERVAL_MS = 2000;
/** Drift (seconds) beyond which a viewer is considered out of sync. */
const DRIFT_DESYNC_THRESHOLD = 1.5;
/** A player report older than this is assumed dead rather than aged forward. */
const REPORT_STALE_MS = 5000;

/**
 * Age a timestamped player report forward to now, so the host broadcasts where
 * its video *is* rather than where it was when the report arrived. Both clocks
 * involved are this machine's, so no cross-device clock skew enters here.
 * Returns null when there's no usable report.
 */
function agedPlayerReport(
  report: { currentTime: number; playing: boolean; at: number } | null,
  rate: number
): { currentTime: number; playing: boolean } | null {
  if (!report) return null;
  const age = Date.now() - report.at;
  if (age > REPORT_STALE_MS) return null;
  if (!report.playing) return { currentTime: report.currentTime, playing: false };
  return { currentTime: report.currentTime + (age / 1000) * (rate || 1), playing: true };
}

const INITIAL_PLAYBACK: PlaybackState = {
  playing: false,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  playbackRate: 1.0,
  platform: null,
  lastUpdated: new Date().toISOString(),
  updatedBy: '',
};

const INITIAL_SYNC: SyncState = {
  status: 'unknown',
  latencyMs: 0,
  drift: 0,
  lastChecked: new Date().toISOString(),
};

// Starts 'disconnected' (= not installed). The bridge flips this to 'waiting'
// on EXTENSION_HELLO, then to 'connected' once a video tab attaches. Keeping the
// initial state as 'waiting' made a missing extension indistinguishable from an
// installed one with no video open.
const INITIAL_EXTENSION: ExtensionState = {
  status: 'disconnected',
  platform: null,
  version: null,
  videoId: null,
  videoUrl: null,
};

const INITIAL_HOST_VIDEO: HostVideo = { videoId: null, videoUrl: null };

const INITIAL_IN_PAGE: InPagePlayerState = { active: false, videoId: null, videoUrl: null };

// Monotonic id source for event-log entries and chat messages. The previous
// ids were derived from list length, which repeats once the log is capped —
// duplicate React keys made entries render unreliably.
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function RoomProvider({ children, roomCode, isHost = false }: RoomProviderProps) {
  const code = roomCode ?? '------';

  // Anonymous identity for this tab. Role prefers what Create/Join stored;
  // falls back to the URL-derived isHost hint.
  const identity = useMemo(() => getSessionIdentity(isHost ? 'host' : 'viewer'), [isHost]);
  const role: UserRole = identity.role;

  const [room] = useState<Room>({
    id: `room:${code}`,
    code,
    createdAt: new Date().toISOString(),
    hostId: role === 'host' ? identity.userId : '',
    status: 'active',
  });

  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [syncState, setSyncState] = useState<SyncState>(INITIAL_SYNC);
  const [extensionState, setExtensionState] = useState<ExtensionState>(INITIAL_EXTENSION);
  const [hostVideo, setHostVideo] = useState<HostVideo>(INITIAL_HOST_VIDEO);
  const [inPagePlayer, setInPagePlayer] = useState<InPagePlayerState>(INITIAL_IN_PAGE);
  const [connectionStatus, setConnectionStatus] =
    useState<RoomContextState['connectionStatus']>('connecting');
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [videoCallState, setVideoCallState] = useState<VideoCallState>({
    inCall: false,
    cameraOn: false,
    micOn: false,
    hasMediaPermission: null,
    peers: {},
  });
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const callManagerRef = useRef<CallManager | null>(null);

  // ─── Host election ─────────────────────────────────────────────────────────
  // The host is derived from presence, not from the URL: the roster is sorted
  // by joinedAt, so the earliest member is host. The creator joined first and
  // is therefore host; when they leave, the first joiner inherits the role.
  // (The url/session role is only a display hint until presence first syncs —
  // trusting it allowed anyone pasting the host's URL to become a second host,
  // and two heartbeating hosts yank each other's playback around.)
  const hostId = users[0]?.userId ?? null;
  const amHost = hostId !== null ? hostId === identity.userId : role === 'host';

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest local playback time, so the host can heartbeat without stale closures.
  const playbackRef = useRef<PlaybackState>(INITIAL_PLAYBACK);
  playbackRef.current = playbackState;
  // Refs mirroring state the channel handlers need (they're bound once per
  // channel and would otherwise close over stale values).
  const hostIdRef = useRef<string | null>(null);
  hostIdRef.current = hostId;
  const extensionRef = useRef<ExtensionState>(INITIAL_EXTENSION);
  extensionRef.current = extensionState;
  const inPageRef = useRef<InPagePlayerState>(INITIAL_IN_PAGE);
  inPageRef.current = inPagePlayer;

  // Subscribers to remote sync events — currently just the in-page player.
  // A ref-held Set rather than state: handlers register during the player's
  // effect and must not re-run the channel subscription that feeds them.
  const remoteSyncHandlers = useRef<Set<RemoteSyncHandler>>(new Set());
  const subscribeRemoteSync = useCallback((handler: RemoteSyncHandler) => {
    remoteSyncHandlers.current.add(handler);
    return () => {
      remoteSyncHandlers.current.delete(handler);
    };
  }, []);

  // Lets the heartbeat read the in-page player's position at send time rather
  // than reusing the once-a-second React state, which is up to a full tick old
  // by the time it goes out — a systematic bias big enough that viewers were
  // getting corrected backwards on a loop.
  const positionSampler = useRef<PositionSampler | null>(null);
  const registerPositionSampler = useCallback((sampler: PositionSampler) => {
    positionSampler.current = sampler;
    return () => {
      if (positionSampler.current === sampler) positionSampler.current = null;
    };
  }, []);

  // The extension can't be sampled synchronously — it pushes a position once a
  // second from another tab. Timestamping each report lets the heartbeat age it
  // forward instead of broadcasting a position up to a full second old, which
  // had every viewer being corrected backwards on every tick.
  const lastPlayerReport = useRef<{ currentTime: number; playing: boolean; at: number } | null>(
    null
  );

  // True when our player tab is on a different video than the host's.
  const videoMismatch =
    !amHost &&
    hostVideo.videoId !== null &&
    extensionState.videoId !== null &&
    hostVideo.videoId !== extensionState.videoId;
  const mismatchRef = useRef(false);
  mismatchRef.current = videoMismatch;

  const currentUser: PresenceUser | null = users.find((u) => u.userId === identity.userId) ?? {
    userId: identity.userId,
    username: identity.username,
    role: amHost ? 'host' : 'viewer',
    connected: connectionStatus === 'connected',
    joinedAt: room.createdAt,
    lastSeen: new Date().toISOString(),
  };

  // Append to the event log (newest first, capped).
  const logEvent = useCallback(
    (type: SyncEventType, userId: string, username: string, payload: Record<string, unknown>) => {
      setEvents((prev) =>
        [
          {
            id: nextId('evt'),
            type,
            userId,
            username,
            payload,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 50)
      );
    },
    []
  );

  // ─── Establish the live channel ────────────────────────────────────────────
  useEffect(() => {
    if (code === '------') return; // no valid room code

    let channel: RealtimeChannel;
    try {
      channel = createRealtimeChannel(code, {
        userId: identity.userId,
        username: identity.username,
        role,
      });
    } catch (err) {
      // Most likely: placeholder/missing Supabase credentials. Surface one
      // actionable message instead of letting the client retry a dead host.
      // warn (not error) so the Next.js dev overlay doesn't flag it as an issue.
      console.warn('[SyncFlix] Realtime unavailable:', err instanceof Error ? err.message : err);
      setConnectionStatus('error');
      return;
    }
    channelRef.current = channel;

    const callManager = createCallManager(channel, identity.userId);
    callManagerRef.current = callManager;

    const unsubLocalCallState = callManager.onLocalStateChange((state) => {
      if (!state.inCall && state.hasMediaPermission === false) {
        toast.error(
          'Camera/mic access was denied — check your browser permissions to join the call.'
        );
      }
      setVideoCallState((prev) => ({ ...prev, ...state }));
    });
    const unsubRemoteStream = callManager.onRemoteStream((userId, stream) => {
      setRemoteStreams((prev) => {
        if (!stream) {
          if (!(userId in prev)) return prev;
          const next = { ...prev };
          delete next[userId];
          return next;
        }
        return { ...prev, [userId]: stream };
      });
    });
    const unsubPeerStatus = callManager.onPeerStatusChange((userId, status) => {
      setVideoCallState((prev) => {
        const peers = { ...prev.peers };
        if (status === 'closed') delete peers[userId];
        else peers[userId] = status;
        return { ...prev, peers };
      });
    });
    const unsubBandwidthSafeguard = callManager.onBandwidthSafeguard(() => {
      toast.info(
        "Camera's off to save bandwidth in this larger call — turn it on manually if you'd like."
      );
    });

    channel.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    channel.onPresenceChange((roster) => {
      // Election: first in the (joinedAt-sorted) roster is host. Displayed
      // roles are derived from that, not from what each client claims.
      const electedHost = roster[0]?.userId ?? null;
      setUsers(roster.map((u) => ({ ...u, role: u.userId === electedHost ? 'host' : 'viewer' })));
    });

    // Apply an incoming playback state from a peer (host-authoritative).
    const applyPlayback = (patch: Partial<PlaybackState>, updatedBy: string) => {
      setPlaybackState((prev) => ({
        ...prev,
        ...patch,
        lastUpdated: new Date().toISOString(),
        updatedBy,
      }));
    };

    // Forward a remote event to the extension only when it was recorded on the
    // same video our player tab is showing. Applying another video's timeline
    // is what caused e.g. "their video ended → ours seeked to 0:00".
    const forwardToExtension = (event: SyncEventType, payload: Record<string, unknown>) => {
      const remoteVid = typeof payload.videoId === 'string' ? payload.videoId : null;
      const localVid = extensionRef.current.videoId;
      if (remoteVid && localVid && remoteVid !== localVid) return;
      sendSyncEventToExtension(event, payload);
    };

    // Hand a remote event to whichever player owns playback here. Both paths are
    // offered every event: at most one of them is ever mounted, and each applies
    // its own video-identity check before acting.
    const deliverRemote = (event: SyncEventType, payload: Record<string, unknown>) => {
      forwardToExtension(event, payload);
      remoteSyncHandlers.current.forEach((handler) => handler(event, payload));
    };

    // Track which video the host is on, learned from their stamped events.
    const noteHostVideo = (userId: string, payload: Record<string, unknown>) => {
      if (userId !== hostIdRef.current || userId === identity.userId) return;
      const videoId = typeof payload.videoId === 'string' ? payload.videoId : null;
      const videoUrl = typeof payload.videoUrl === 'string' ? payload.videoUrl : null;
      if (!videoId && !videoUrl) return;
      setHostVideo((prev) =>
        prev.videoId === videoId && prev.videoUrl === videoUrl ? prev : { videoId, videoUrl }
      );
    };

    channel.subscribe('PLAY', (payload, userId, username) => {
      applyPlayback(
        {
          playing: true,
          status: 'playing',
          currentTime: typeof payload.currentTime === 'number' ? payload.currentTime : undefined,
          platform: (payload.platform as string | null) ?? undefined,
        },
        userId
      );
      noteHostVideo(userId, payload);
      if (userId !== identity.userId) deliverRemote('PLAY', payload);
      logEvent('PLAY', userId, username, payload);
    });

    channel.subscribe('PAUSE', (payload, userId, username) => {
      applyPlayback(
        {
          playing: false,
          status: 'paused',
          currentTime: typeof payload.currentTime === 'number' ? payload.currentTime : undefined,
        },
        userId
      );
      noteHostVideo(userId, payload);
      if (userId !== identity.userId) deliverRemote('PAUSE', payload);
      logEvent('PAUSE', userId, username, payload);
    });

    channel.subscribe('SEEK', (payload, userId, username) => {
      applyPlayback(
        { currentTime: typeof payload.to === 'number' ? payload.to : undefined },
        userId
      );
      noteHostVideo(userId, payload);
      if (userId !== identity.userId) deliverRemote('SEEK', payload);
      logEvent('SEEK', userId, username, payload);
    });

    channel.subscribe('PLAYBACK_SPEED', (payload, userId, username) => {
      applyPlayback(
        { playbackRate: typeof payload.rate === 'number' ? payload.rate : undefined },
        userId
      );
      noteHostVideo(userId, payload);
      if (userId !== identity.userId) deliverRemote('PLAYBACK_SPEED', payload);
      logEvent('PLAYBACK_SPEED', userId, username, payload);
    });

    channel.subscribe('PLATFORM_CHANGED', (payload, userId, username) => {
      applyPlayback({ platform: (payload.platform as string | null) ?? null }, userId);
      logEvent('PLATFORM_CHANGED', userId, username, payload);
    });

    // Position heartbeat from the host: viewers snap to it and measure drift.
    channel.subscribe('POSITION_UPDATE', (payload, userId) => {
      if (userId === identity.userId) return; // ignore our own heartbeat echo
      // Only the elected host's heartbeat is authoritative — a stale tab that
      // still believes it's host must not fight over our playback.
      if (hostIdRef.current !== null && userId !== hostIdRef.current) return;
      noteHostVideo(userId, payload);
      const hostTime = typeof payload.currentTime === 'number' ? payload.currentTime : null;
      const hostPlaying = Boolean(payload.playing);
      if (hostTime === null) return;

      // Let the extension's sync engine correct the real video against the host.
      deliverRemote('POSITION_UPDATE', payload);

      setPlaybackState((prev) => {
        const drift = prev.currentTime - hostTime;
        // Only hard-correct when drift is meaningful; small drift is tolerated.
        const shouldCorrect = Math.abs(drift) > DRIFT_DESYNC_THRESHOLD;
        return {
          ...prev,
          playing: hostPlaying,
          status: hostPlaying ? 'playing' : 'paused',
          currentTime: shouldCorrect ? hostTime : prev.currentTime,
          lastUpdated: new Date().toISOString(),
          updatedBy: userId,
        };
      });

      setSyncState((prev) => {
        const drift = parseFloat((playbackRef.current.currentTime - hostTime).toFixed(2));
        const status =
          Math.abs(drift) > DRIFT_DESYNC_THRESHOLD
            ? 'desynced'
            : Math.abs(drift) > 0.4
              ? 'syncing'
              : 'synced';
        return { ...prev, status, drift, lastChecked: new Date().toISOString() };
      });
    });

    // Chat.
    channel.subscribe('JOIN_ROOM', (payload, userId, username) => {
      logEvent('JOIN_ROOM', userId, username, payload);
    });

    channel.subscribe('CHAT_MESSAGE', (payload, userId, username) => {
      // Our own message was already rendered optimistically in sendChatMessage;
      // the channel echoes it back (self:true), so skip it here to avoid a dupe.
      if (userId === identity.userId) return;
      const text = typeof payload.message === 'string' ? payload.message : '';
      if (!text) return;
      setChatMessages((prev) => [
        ...prev,
        {
          id: nextId('msg'),
          userId,
          username,
          message: text,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    channel.connect();

    return () => {
      unsubLocalCallState();
      unsubRemoteStream();
      unsubPeerStatus();
      unsubBandwidthSafeguard();
      callManager.destroy();
      callManagerRef.current = null;
      channel.disconnect();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Keep the call manager's peer list in step with who's actually in the call,
  // as learned from presence (inCall flag) — same roster UsersPanel reads.
  useEffect(() => {
    const inCallIds = users.filter((u) => u.inCall).map((u) => u.userId);
    callManagerRef.current?.syncPeers(inCallIds);
  }, [users]);

  // ─── Extension bridge ────────────────────────────────────────────────────────
  // Detects the browser extension and exchanges playback events with it.
  // Harmless no-op when the extension isn't installed (pings go unanswered).
  useEffect(() => {
    const disconnect = connectExtensionBridge({
      onStateChange: (state) => {
        setExtensionState(state);
        if (state.platform) {
          setPlaybackState((prev) =>
            prev.platform === state.platform ? prev : { ...prev, platform: state.platform }
          );
        }
      },
      onPlayerEvent: (event, payload) => {
        // While our player tab is on a different video than the host, its
        // events describe content the room isn't watching — neither our local
        // room display nor the other participants should receive them.
        if (mismatchRef.current) return;
        if (event === 'POSITION_UPDATE') {
          // Real player position from our own video tab — update local state
          // only; the host's heartbeat interval broadcasts it to the room.
          const t = payload.currentTime;
          const playing = Boolean(payload.playing);
          if (typeof t === 'number') {
            lastPlayerReport.current = { currentTime: t, playing, at: Date.now() };
          }
          setPlaybackState((prev) => ({
            ...prev,
            currentTime: typeof t === 'number' ? t : prev.currentTime,
            playing,
            status: playing ? 'playing' : 'paused',
            lastUpdated: new Date().toISOString(),
            updatedBy: identity.userId,
          }));
          return;
        }
        // Local user action on the video (PLAY/PAUSE/SEEK/PLAYBACK_SPEED):
        // broadcast to the room. The channel echoes it back (self: true) and
        // the subscription handlers update local state from the echo.
        channelRef.current?.broadcast(event, payload);
      },
    });
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Host video bookkeeping ─────────────────────────────────────────────────
  // When we are the host, our own player tab defines the room's video.
  // (Viewers learn it from the stamped heartbeat instead.)
  useEffect(() => {
    if (!amHost) return;
    // Same precedence as the heartbeat: the in-page player, when active, is the
    // authority on what the host is watching.
    const source = inPagePlayer.active ? inPagePlayer : extensionState;
    setHostVideo((prev) =>
      prev.videoId === source.videoId && prev.videoUrl === source.videoUrl
        ? prev
        : { videoId: source.videoId, videoUrl: source.videoUrl }
    );
    // Re-running on the whole objects is fine: setHostVideo returns `prev`
    // unchanged when the identity hasn't actually moved, so no extra render.
  }, [amHost, extensionState, inPagePlayer]);

  // Report the host's video URL down to the extension so its popup can offer
  // an "Open video" link. Re-sent on every extension state message — the MV3
  // worker forgets it when suspended, and this keeps it re-taught for free.
  useEffect(() => {
    if (extensionState.status === 'disconnected') return; // no bridge to talk to
    sendHostVideoToExtension(hostVideo.videoUrl);
  }, [hostVideo.videoUrl, extensionState]);

  // ─── Host position heartbeat ────────────────────────────────────────────────
  // Runs on the *elected* host (derived from presence), not the URL role. The
  // heartbeat is stamped with the host's video identity so viewers on another
  // video can refuse it and show a "watch the same video" link instead.
  useEffect(() => {
    // hostId === null means presence hasn't synced yet — during that window
    // amHost falls back to the URL role hint, which must never be enough to
    // start heartbeating (anyone can paste a &role=host URL).
    if (hostId === null || !amHost || connectionStatus !== 'connected') return;
    const interval = setInterval(() => {
      const pb = playbackRef.current;
      // Whichever player owns playback here stamps its video identity onto the
      // heartbeat. The in-page player wins when active: on a phone the extension
      // can never attach, so reading extensionRef alone would broadcast a null
      // videoId and viewers would never learn what the host is watching.
      const inPage = inPageRef.current;
      const source = inPage.active ? inPage : extensionRef.current;
      // Prefer a position sampled right now over the throttled state mirror.
      const live = positionSampler.current?.() ?? null;
      const now = live ?? agedPlayerReport(lastPlayerReport.current, pb.playbackRate);
      channelRef.current?.broadcast('POSITION_UPDATE', {
        currentTime: now ? now.currentTime : pb.currentTime,
        playing: now ? now.playing : pb.playing,
        videoId: source.videoId,
        videoUrl: source.videoUrl,
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hostId, amHost, connectionStatus]);

  // ─── Local playback ticker ──────────────────────────────────────────────────
  // Advances the local clock while playing so the position display moves between
  // discrete events / heartbeats. When the extension is connected, the real
  // player position drives the clock instead (via POSITION_UPDATE reports).
  useEffect(() => {
    if (!playbackState.playing || connectionStatus !== 'connected') return;
    if (extensionState.status === 'connected') return;
    // The in-page player reports its true position every second. Letting this
    // dead-reckoning clock run alongside it would advance currentTime twice per
    // second and corrupt the host's heartbeat at its source.
    if (inPagePlayer.active) return;
    const interval = setInterval(() => {
      setPlaybackState((prev) =>
        prev.playing
          ? {
              ...prev,
              currentTime: prev.currentTime + prev.playbackRate,
              lastUpdated: new Date().toISOString(),
            }
          : prev
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [
    playbackState.playing,
    playbackState.playbackRate,
    connectionStatus,
    extensionState.status,
    inPagePlayer.active,
  ]);

  const broadcastEvent = useCallback((type: SyncEventType, payload: Record<string, unknown>) => {
    channelRef.current?.broadcast(type, payload);
  }, []);

  // ─── Video call plumbing ─────────────────────────────────────────────────────

  const joinCall = useCallback(() => {
    void callManagerRef.current?.join();
  }, []);

  const leaveCall = useCallback(() => {
    callManagerRef.current?.leave();
  }, []);

  const toggleCamera = useCallback(() => {
    void callManagerRef.current?.toggleCamera();
  }, []);

  const toggleMic = useCallback(() => {
    callManagerRef.current?.toggleMic();
  }, []);

  const switchCamera = useCallback(() => {
    void callManagerRef.current?.switchCamera();
  }, []);

  const getLocalCallStream = useCallback(
    () => callManagerRef.current?.getLocalStream() ?? null,
    []
  );

  // ─── In-page player plumbing ────────────────────────────────────────────────

  const setInPageVideo = useCallback((videoId: string | null) => {
    setInPagePlayer((prev) => {
      if (prev.videoId === videoId) return prev;
      return videoId
        ? { active: true, videoId, videoUrl: youTubeWatchUrl(videoId) }
        : INITIAL_IN_PAGE;
    });
    if (!videoId) {
      // Tearing the player down hands the clock back to the dead-reckoning
      // ticker, which only stops while `playing` is false. Without this reset it
      // would keep advancing a position for a host that no longer has a player,
      // and heartbeat that invented time out to every viewer.
      setPlaybackState((prev) =>
        prev.playing || prev.status !== 'idle'
          ? { ...prev, playing: false, status: 'idle', lastUpdated: new Date().toISOString() }
          : prev
      );
      return;
    }
    setPlaybackState((prev) =>
      prev.platform === 'YouTube' ? prev : { ...prev, platform: 'YouTube' }
    );
  }, []);

  // Mirrors the extension's POSITION_UPDATE contract exactly: local state only.
  // Broadcasting from here would put every viewer's clock on the wire, and only
  // the host's position is authoritative.
  const reportInPagePosition = useCallback(
    (currentTime: number, playing: boolean, duration?: number) => {
      setPlaybackState((prev) => ({
        ...prev,
        currentTime,
        playing,
        // The extension never reports a duration, so keep whatever we had
        // rather than clobbering it with 0.
        duration: duration && duration > 0 ? duration : prev.duration,
        status: playing ? 'playing' : 'paused',
        lastUpdated: new Date().toISOString(),
        updatedBy: identity.userId,
      }));
    },
    [identity.userId]
  );

  const sendChatMessage = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      // Optimistically render our own message, then broadcast.
      setChatMessages((prev) => [
        ...prev,
        {
          id: nextId('msg'),
          userId: identity.userId,
          username: identity.username,
          message: trimmed,
          timestamp: new Date().toISOString(),
        },
      ]);
      channelRef.current?.broadcast('CHAT_MESSAGE', { message: trimmed });
    },
    [identity.userId, identity.username]
  );

  const copyRoomCode = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(room.code);
    }
  }, [room.code]);

  const leaveRoom = useCallback(() => {
    channelRef.current?.disconnect();
    channelRef.current = null;
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, []);

  const value: RoomContextValue = {
    room,
    currentUser,
    users,
    playbackState,
    syncState,
    extensionState,
    connectionStatus,
    events,
    chatMessages,
    hostVideo,
    videoMismatch,
    inPagePlayer,
    amHost,
    sendChatMessage,
    copyRoomCode,
    leaveRoom,
    broadcastEvent,
    videoCallState,
    remoteStreams,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
    getLocalCallStream,
    setInPageVideo,
    reportInPagePosition,
    subscribeRemoteSync,
    registerPositionSampler,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
