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
  ChatReplyRef,
  SyncEventType,
  UserRole,
  VideoCallState,
  CallMediaError,
  CallReaction,
} from '@/types/room';
import { extractMentionIds } from '@/utils/mentions';
import { createRealtimeChannel, type RealtimeChannel } from '@/services/realtimeService';
import { createCallManager, type CallManager } from '@/services/webrtc';
import {
  connectExtensionBridge,
  sendSyncEventToExtension,
  sendHostVideoToExtension,
} from '@/services/extensionBridge';
import {
  getSessionIdentity,
  clearRoomSession,
  setRoomHostSeq,
  setRoomHostOnly,
} from '@/utils/session';
import { youTubeWatchUrl } from '@/services/youtube';
import { toast } from 'sonner';
import { Crown } from 'lucide-react';

/**
 * The message shown to whoever was just handed the host role. Worth more than
 * one line: it is the moment where what the buttons in front of you do changes.
 *
 * Rendered as sonner's title so sonner keeps ownership of the toast box, its
 * width and its alignment. Supplying our own card instead left it floating,
 * narrower than the slot it sat in and short of the right edge.
 */
function hostPromotionMessage() {
  return (
    <span className="block">
      <span className="block text-sm font-semibold text-foreground">You&apos;re the host now</span>
      <span className="block mt-0.5 text-[11px] leading-snug text-muted-foreground">
        Your play, pause and seek drive the room.
      </span>
    </span>
  );
}

/**
 * Crown accent for host-change toasts. Sized to sonner's icon slot, which is
 * 16px square: anything larger overflows it and pushes the text off centre.
 */
function crownIcon() {
  return <Crown size={16} className="text-[var(--status-host)]" />;
}

/** A remote sync event, delivered to the in-page player so it can apply it. */
export type RemoteSyncHandler = (event: SyncEventType, payload: Record<string, unknown>) => void;

interface RoomContextValue extends RoomContextState {
  /** Send a chat message, optionally as a reply to another one. */
  sendChatMessage: (message: string, replyTo?: ChatReplyRef | null) => void;
  /** Add our reaction to a message, or take it back if it's already there. */
  toggleReaction: (messageId: string, emoji: string) => void;
  /** Drop a message from our own list only. Never leaves this client. */
  deleteMessageForMe: (messageId: string) => void;
  /** Withdraw one of our own messages room-wide. No-op on anyone else's. */
  deleteMessageForEveryone: (messageId: string) => void;
  copyRoomCode: () => void;
  leaveRoom: () => void;
  broadcastEvent: (type: SyncEventType, payload: Record<string, unknown>) => void;

  // ─── Host controls ──────────────────────────────────────────────────────────
  /** Hand the host role to another participant. Host-only; no-op otherwise. */
  transferHost: (userId: string) => void;
  /** Turn the host-only playback lock on or off. Host-only; no-op otherwise. */
  setHostOnlyControl: (hostOnly: boolean) => void;

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
  /** Start/stop sharing this screen in place of the camera. Desktop only. */
  toggleScreenShare: () => void;

  // ─── Call view (local to this client) ──────────────────────────────────────
  /** Whose tile is enlarged into the speaker view, if anyone. */
  pinnedUserId: string | null;
  togglePinnedUser: (userId: string) => void;
  /** Participants silenced *for us only* — they are not told, and can still talk to everyone else. */
  mutedUserIds: string[];
  toggleUserMuted: (userId: string) => void;
  /** Emoji currently floating over the tiles. */
  callReactions: CallReaction[];
  sendCallReaction: (emoji: string) => void;
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
/**
 * How long the host role is held open after the host drops out of presence.
 * Long enough to cover a page reload, short enough that a host who actually
 * closed the tab doesn't leave the room leaderless for long.
 */
const HOST_REJOIN_GRACE_MS = 10000;
/**
 * The events the host-only lock gates. Play/pause is what the lock is for, but
 * seeking and rate changes move the room just as hard — leaving them open would
 * make the lock trivially bypassable by scrubbing instead of pausing.
 */
const CONTROL_EVENTS: ReadonlySet<SyncEventType> = new Set([
  'PLAY',
  'PAUSE',
  'SEEK',
  'PLAYBACK_SPEED',
]);

/** A host handover: who was given the role, how recently, and with what lock. */
export interface HostGrant {
  userId: string;
  seq: number;
  hostOnly: boolean;
}

/**
 * Who is host, as a pure function of its inputs, so every client (the ones that
 * watched the transfer and the ones that joined afterwards) reaches the same
 * answer.
 *
 * A transfer beats join order: whoever carries the highest seq holds the role.
 * With no transfers in play, the common case, every seq is 0 and this is just
 * "earliest joinedAt", the roster being sorted that way already.
 *
 * Grants arrive by two routes and both are consulted. The roster carries them
 * durably, which is what a late joiner and a reloaded tab read, but presence
 * takes a moment to come back around. `heard` is the same grant taken straight
 * off the wire, so the room flips the instant the transfer is announced instead
 * of on the next presence sync.
 */
function electHost(roster: PresenceUser[], heard: HostGrant | null): string | null {
  if (roster.length === 0) return null;
  let bestId: string | null = null;
  let bestSeq = 0;
  for (const user of roster) {
    const seq = user.hostSeq ?? 0;
    if (seq <= 0) continue;
    // userId tiebreak keeps the outcome deterministic if two grants ever collide.
    if (seq > bestSeq || (seq === bestSeq && bestId !== null && user.userId < bestId)) {
      bestId = user.userId;
      bestSeq = seq;
    }
  }
  // Only honour a heard grant while its recipient is actually in the room, or a
  // handover to someone who then left would leave the room without a host.
  if (heard && heard.seq > bestSeq && roster.some((u) => u.userId === heard.userId)) {
    bestId = heard.userId;
  }
  return bestId ?? roster[0].userId;
}
/**
 * Why the call has no local media, in words. A denied prompt and an insecure
 * origin look identical from the call's side but need opposite advice — only
 * one of them can be fixed from browser settings.
 */
const CALL_MEDIA_TOAST: Record<CallMediaError, string> = {
  denied:
    "Camera/mic access was denied — you can see and hear everyone, but they can't see or hear you. " +
    'Allow access in your browser, then turn your camera on.',
  insecure:
    'Camera and mic need a secure connection — this page is on plain http, so the browser will never ' +
    'offer a permission prompt. Open the room over https (or on localhost) to be seen and heard.',
  unavailable:
    "No camera or mic was found — you can see and hear everyone, but they can't see or hear you.",
};

/** How long a reaction stays on screen — must match the float-up animation. */
const REACTION_LIFETIME_MS = 4000;
/** Ceiling on simultaneous floating emoji, so a spam burst can't bury the tiles. */
const MAX_LIVE_REACTIONS = 30;

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

/**
 * A chat id every client in the room agrees on.
 *
 * Reactions and replies address a message by id across the wire, so a purely
 * local counter won't do: the same message would be "msg-4" here and "msg-9"
 * there. Namespacing the counter by the sender's userId makes it unique room-wide
 * without a server to hand out ids.
 */
const nextMessageId = (userId: string) => `${userId}:${++seq}`;

/** How much of the original a reply quotes. Enough to recognise, not to re-read. */
const REPLY_PREVIEW_LENGTH = 120;

/** Validates the reply quote off the wire. It's untrusted, like every payload. */
function readReplyRef(raw: unknown): ChatReplyRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const ref = raw as Record<string, unknown>;
  if (typeof ref.id !== 'string' || typeof ref.message !== 'string') return null;
  return {
    id: ref.id,
    userId: typeof ref.userId === 'string' ? ref.userId : '',
    username: typeof ref.username === 'string' ? ref.username : '',
    message: ref.message.slice(0, REPLY_PREVIEW_LENGTH),
  };
}

/**
 * Applies one person's reaction to one message.
 *
 * `active` is the resulting state rather than a toggle, so re-applying an event
 * is a no-op, which matters because our own reaction is rendered optimistically
 * and then arrives again on the channel's self-echo.
 */
function withReaction(
  messages: ChatMessage[],
  messageId: string,
  emoji: string,
  userId: string,
  active: boolean
): ChatMessage[] {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg.id !== messageId) return msg;
    const users = msg.reactions?.[emoji] ?? [];
    if (users.includes(userId) === active) return msg;
    changed = true;
    const reactions = { ...(msg.reactions ?? {}) };
    if (active) {
      reactions[emoji] = [...users, userId];
    } else {
      const remaining = users.filter((id) => id !== userId);
      if (remaining.length) reactions[emoji] = remaining;
      else delete reactions[emoji];
    }
    return { ...msg, reactions };
  });
  // Reactions land on messages that may have scrolled out of a late joiner's
  // (nonexistent) history, so return the same array and nothing re-renders.
  return changed ? next : messages;
}

/**
 * Turns a message into a tombstone, on behalf of `byUserId`.
 *
 * Only the author may do this. Reactions and the mention list go with the text:
 * leaving them would keep a withdrawn message pinging someone and carrying a
 * tally of responses to words nobody can read any more.
 */
function withDeletion(messages: ChatMessage[], messageId: string, byUserId: string): ChatMessage[] {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg.id !== messageId || msg.userId !== byUserId || msg.deleted) return msg;
    changed = true;
    return { ...msg, deleted: true, message: '', reactions: {}, mentions: [] };
  });
  return changed ? next : messages;
}

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

  // Raw presence roster, joinedAt-sorted. Roles are applied by the election
  // below (`roster`) rather than trusted from what each client tracks.
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
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
    mediaError: null,
    screenSharing: false,
    canScreenShare: false,
    peers: {},
  });
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const callManagerRef = useRef<CallManager | null>(null);

  // ─── Call view state ───────────────────────────────────────────────────────
  // All three are this client's own view of the call and deliberately never
  // leave it: pinning someone, or silencing them, is a decision about your own
  // screen and speakers, not something to impose on the room.
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [mutedUserIds, setMutedUserIds] = useState<string[]>([]);
  const [callReactions, setCallReactions] = useState<CallReaction[]>([]);

  // ─── Host election ─────────────────────────────────────────────────────────
  // The host is derived from presence, not from the URL: see electHost() above
  // for the rule (a hostSeq grant, else earliest joinedAt).
  // joinedAt is pinned per room in sessionStorage, so reloading the page keeps
  // the host at the front of the roster instead of sending them to the back.
  // (The url/session role is only a display hint until presence first syncs —
  // trusting it allowed anyone pasting the host's URL to become a second host,
  // and two heartbeating hosts yank each other's playback around.)
  //
  // A reload still drops the host out of presence for a second or two. Rather
  // than promote a viewer for that blink and demote them again, the role is
  // held open for HOST_REJOIN_GRACE_MS. Election stays a pure function of the
  // roster — the grace only delays it — so every client agrees on the outcome.
  const [hostId, setHostId] = useState<string | null>(null);
  const hostGoneAt = useRef<number | null>(null);
  // The latest handover heard on the wire. Every client applies it on arrival,
  // so nobody waits for a presence round trip to see the role move.
  const [heardGrant, setHeardGrant] = useState<HostGrant | null>(null);

  useEffect(() => {
    const elected = electHost(presenceUsers, heardGrant);
    if (elected === null) return; // presence hasn't synced yet

    // Either nobody held the role, or the current holder is still connected —
    // in which case the roster order (not the grace timer) decides.
    if (hostId === null || presenceUsers.some((u) => u.userId === hostId)) {
      hostGoneAt.current = null;
      setHostId(elected);
      return;
    }

    // The host vanished. Hold their seat until the grace window runs out.
    const goneAt = hostGoneAt.current ?? Date.now();
    hostGoneAt.current = goneAt;
    const remaining = HOST_REJOIN_GRACE_MS - (Date.now() - goneAt);
    if (remaining <= 0) {
      hostGoneAt.current = null;
      setHostId(elected);
      return;
    }
    const timer = setTimeout(() => {
      hostGoneAt.current = null;
      setHostId(elected);
    }, remaining);
    return () => clearTimeout(timer);
  }, [presenceUsers, hostId, heardGrant]);

  const amHost = hostId !== null ? hostId === identity.userId : role === 'host';

  // ─── Host-only playback lock ───────────────────────────────────────────────
  // Replicated through the host's own presence entry, so a viewer who joins
  // halfway through learns the room is locked without anyone re-announcing it.
  const [hostOnlyControl, setHostOnlyState] = useState(false);
  useEffect(() => {
    if (hostId === null) return;
    const host = presenceUsers.find((u) => u.userId === hostId);
    // Host mid-reload: hold the last known value rather than briefly unlocking.
    if (!host) return;
    // Until a fresh host's presence carries their grant, the announcement is the
    // better source: their entry still holds whatever they ran as a viewer, and
    // reading it would blink the lock off mid-handover.
    const stale =
      heardGrant !== null && heardGrant.userId === hostId && (host.hostSeq ?? 0) < heardGrant.seq;
    setHostOnlyState(stale ? heardGrant.hostOnly : host.hostOnly === true);
  }, [presenceUsers, hostId, heardGrant]);

  // Displayed roles follow the election, not what each client claims. During
  // the grace window the absent host isn't in the roster, so nobody is badged.
  const roster = useMemo<PresenceUser[]>(
    () =>
      presenceUsers.map((u) => ({
        ...u,
        role: u.userId === hostId ? 'host' : ('viewer' as UserRole),
      })),
    [presenceUsers, hostId]
  );

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest local playback time, so the host can heartbeat without stale closures.
  const playbackRef = useRef<PlaybackState>(INITIAL_PLAYBACK);
  playbackRef.current = playbackState;
  // Refs mirroring state the channel handlers need (they're bound once per
  // channel and would otherwise close over stale values).
  const hostIdRef = useRef<string | null>(null);
  hostIdRef.current = hostId;
  const amHostRef = useRef(false);
  amHostRef.current = amHost;
  const hostOnlyRef = useRef(false);
  hostOnlyRef.current = hostOnlyControl;
  const presenceRef = useRef<PresenceUser[]>([]);
  presenceRef.current = presenceUsers;
  const extensionRef = useRef<ExtensionState>(INITIAL_EXTENSION);
  extensionRef.current = extensionState;
  const inPageRef = useRef<InPagePlayerState>(INITIAL_IN_PAGE);
  inPageRef.current = inPagePlayer;
  // Read by toggleReaction to work out whether we're adding or removing, without
  // deciding that inside a state updater (which React may run more than once).
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;

  /**
   * Whether a playback control event from `senderId` may move this room.
   * Locked rooms honour the host only; before presence syncs (hostId null) we
   * can't tell who the host is, so nothing is gated.
   */
  const controlAllowed = useCallback(
    (senderId: string) =>
      !hostOnlyRef.current || hostIdRef.current === null || senderId === hostIdRef.current,
    []
  );

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

  const currentUser: PresenceUser | null = roster.find((u) => u.userId === identity.userId) ?? {
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

    // A denied camera/mic no longer keeps you out of the call — you join
    // receive-only and can still see and hear everyone — so warn once on the
    // transition into the call rather than reporting it as a failure to join.
    let warnedAboutMedia = false;
    const unsubLocalCallState = callManager.onLocalStateChange((state) => {
      if (state.inCall && state.mediaError && !warnedAboutMedia) {
        warnedAboutMedia = true;
        toast.error(CALL_MEDIA_TOAST[state.mediaError]);
      }
      if (!state.inCall) warnedAboutMedia = false;
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

    channel.onPresenceChange((incoming) => {
      // Stored raw — the election effect above decides who wears the crown.
      setPresenceUsers(incoming);
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
      if (!controlAllowed(userId)) return;
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
      if (!controlAllowed(userId)) return;
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
      if (!controlAllowed(userId)) return;
      applyPlayback(
        { currentTime: typeof payload.to === 'number' ? payload.to : undefined },
        userId
      );
      noteHostVideo(userId, payload);
      if (userId !== identity.userId) deliverRemote('SEEK', payload);
      logEvent('SEEK', userId, username, payload);
    });

    channel.subscribe('PLAYBACK_SPEED', (payload, userId, username) => {
      if (!controlAllowed(userId)) return;
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

    // The host handing the role to someone else. Only the recipient acts on it:
    // they publish the grant into their own presence and every client — this one
    // included — re-elects from the roster it produces.
    channel.subscribe('HOST_TRANSFER', (payload, userId, username) => {
      // Only the sitting host may give the role away.
      if (hostIdRef.current !== null && userId !== hostIdRef.current) return;
      const to = typeof payload.to === 'string' ? payload.to : null;
      const seq = typeof payload.seq === 'number' ? payload.seq : 0;
      if (!to || seq <= 0) return;

      const lock = payload.hostOnly === true;
      // Applied by everyone the moment it lands, so the role visibly moves on
      // both screens without waiting for presence to make its round trip.
      setHeardGrant((prev) =>
        prev && prev.seq >= seq ? prev : { userId: to, seq, hostOnly: lock }
      );

      if (to === identity.userId) {
        setRoomHostSeq(code, seq);
        // Carry the outgoing host's lock over, so the handover doesn't silently
        // unlock a room that was locked a second ago.
        setRoomHostOnly(code, lock);
        channelRef.current?.updatePresence({ hostSeq: seq, hostOnly: lock });
        toast(hostPromotionMessage(), {
          icon: crownIcon(),
          duration: 6000,
          // Same card as every other toast, picked out in the host colour.
          style: { border: '1px solid var(--status-host)' },
        });
      } else {
        const name = typeof payload.toUsername === 'string' ? payload.toUsername : 'Someone else';
        toast(`${name} is the host now`, { icon: crownIcon() });
      }
      logEvent('HOST_TRANSFER', userId, username, payload);
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
      // Fall back to a local id for anything sent by an older client that
      // predates shared ids. Reactions won't find it, but it still renders.
      const id = typeof payload.id === 'string' && payload.id ? payload.id : nextId('msg');
      const replyTo = readReplyRef(payload.replyTo);
      const mentions = Array.isArray(payload.mentions)
        ? payload.mentions.filter((m): m is string => typeof m === 'string')
        : [];
      setChatMessages((prev) => [
        ...prev,
        {
          id,
          userId,
          username,
          message: text,
          timestamp: new Date().toISOString(),
          replyTo,
          mentions,
          reactions: {},
        },
      ]);
    });

    channel.subscribe('CHAT_REACTION', (payload, userId) => {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
      const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
      if (!messageId || !emoji) return;
      // Our own reaction is applied optimistically and this echo re-applies it;
      // withReaction is written so that lands on exactly the same state.
      setChatMessages((prev) =>
        withReaction(prev, messageId, emoji, userId, payload.active === true)
      );
    });

    // Reactions are fire-and-forget: they exist for the few seconds they spend
    // floating up the tiles and are never stored, so there is nothing to
    // reconcile and a missed one simply didn't happen.
    channel.subscribe('CALL_REACTION', (payload, userId, username) => {
      const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
      if (!emoji) return;
      const reaction: CallReaction = {
        id: nextId('rx'),
        userId,
        username,
        emoji,
        // Spread horizontally so a burst of reactions fans out instead of
        // stacking into one column.
        offset: 8 + Math.random() * 84,
      };
      setCallReactions((prev) => [...prev, reaction].slice(-MAX_LIVE_REACTIONS));
      window.setTimeout(
        () => setCallReactions((prev) => prev.filter((r) => r.id !== reaction.id)),
        REACTION_LIFETIME_MS
      );
    });

    channel.subscribe('CHAT_DELETE', (payload, userId) => {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
      if (!messageId) return;
      // withDeletion checks authorship against `userId`, so a forged event
      // naming someone else's message does nothing.
      setChatMessages((prev) => withDeletion(prev, messageId, userId));
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
    const inCallIds = presenceUsers.filter((u) => u.inCall).map((u) => u.userId);
    callManagerRef.current?.syncPeers(inCallIds);
  }, [presenceUsers]);

  // A pin on someone who has left the call would otherwise hold the whole
  // speaker view open around an empty tile.
  useEffect(() => {
    if (!pinnedUserId) return;
    const stillOnCall = presenceUsers.some((u) => u.userId === pinnedUserId && u.inCall);
    if (!stillOnCall) setPinnedUserId(null);
  }, [presenceUsers, pinnedUserId]);

  // Leaving the call ourselves drops the view state with it, so rejoining
  // doesn't restore a pin or a mute list from a different conversation.
  useEffect(() => {
    if (videoCallState.inCall) return;
    setPinnedUserId(null);
    setMutedUserIds([]);
    setCallReactions([]);
  }, [videoCallState.inCall]);

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
        // the subscription handlers update local state from the echo. Goes
        // through broadcastEvent so a locked room drops a viewer's actions here
        // — their own tab still plays, it just stops moving everyone else.
        broadcastEvent(event, payload);
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

  // The single exit onto the wire for player events, from both the in-page
  // player and the extension bridge — so the host-only lock is enforced in one
  // place rather than once per playback path.
  const broadcastEvent = useCallback((type: SyncEventType, payload: Record<string, unknown>) => {
    if (CONTROL_EVENTS.has(type) && hostOnlyRef.current && !amHostRef.current) return;
    channelRef.current?.broadcast(type, payload);
  }, []);

  // ─── Host controls ──────────────────────────────────────────────────────────

  const transferHost = useCallback(
    (userId: string) => {
      if (!amHostRef.current || userId === identity.userId) return;
      const target = presenceRef.current.find((u) => u.userId === userId);
      if (!target) return;
      // One past the highest grant in the room, so the new host outranks every
      // previous holder no matter whose clock is off by how much.
      const seq = presenceRef.current.reduce((max, u) => Math.max(max, u.hostSeq ?? 0), 0) + 1;
      channelRef.current?.broadcast('HOST_TRANSFER', {
        to: userId,
        toUsername: target.username,
        seq,
        hostOnly: hostOnlyRef.current,
      });
    },
    [identity.userId]
  );

  const setHostOnlyControl = useCallback(
    (hostOnly: boolean) => {
      if (!amHostRef.current) return;
      setRoomHostOnly(code, hostOnly);
      setHostOnlyState(hostOnly);
      // Everyone else reads the lock off our presence entry.
      channelRef.current?.updatePresence({ hostOnly });
    },
    [code]
  );

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

  const toggleScreenShare = useCallback(() => {
    void callManagerRef.current?.toggleScreenShare();
  }, []);

  // While sharing, our own tile should show what everyone else is receiving —
  // the screen — rather than the camera still running behind it.
  const getLocalCallStream = useCallback(
    () =>
      callManagerRef.current?.getScreenStream() ?? callManagerRef.current?.getLocalStream() ?? null,
    []
  );

  const sendCallReaction = useCallback((emoji: string) => {
    // No local echo: the channel is configured with `self: true`, so our own
    // reaction comes back through the subscription like everyone else's.
    channelRef.current?.broadcast('CALL_REACTION', { emoji });
  }, []);

  const togglePinnedUser = useCallback((userId: string) => {
    setPinnedUserId((prev) => (prev === userId ? null : userId));
  }, []);

  const toggleUserMuted = useCallback((userId: string) => {
    setMutedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }, []);

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
    (message: string, replyTo: ChatReplyRef | null = null) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const id = nextMessageId(identity.userId);
      // Mentions are resolved here, once, against the roster the sender can see,
      // and travel with the message. Re-deriving them on each client would let
      // two people disagree about who was pinged whenever presence lags.
      const mentions = extractMentionIds(trimmed, presenceRef.current);
      const quote: ChatReplyRef | null = replyTo
        ? { ...replyTo, message: replyTo.message.slice(0, REPLY_PREVIEW_LENGTH) }
        : null;

      // Optimistically render our own message, then broadcast.
      setChatMessages((prev) => [
        ...prev,
        {
          id,
          userId: identity.userId,
          username: identity.username,
          message: trimmed,
          timestamp: new Date().toISOString(),
          replyTo: quote,
          mentions,
          reactions: {},
        },
      ]);
      channelRef.current?.broadcast('CHAT_MESSAGE', {
        id,
        message: trimmed,
        replyTo: quote,
        mentions,
      });
    },
    [identity.userId, identity.username]
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const target = chatMessagesRef.current.find((msg) => msg.id === messageId);
      if (!target) return;
      const active = !(target.reactions?.[emoji] ?? []).includes(identity.userId);
      setChatMessages((prev) => withReaction(prev, messageId, emoji, identity.userId, active));
      channelRef.current?.broadcast('CHAT_REACTION', { messageId, emoji, active });
    },
    [identity.userId]
  );

  const deleteMessageForMe = useCallback((messageId: string) => {
    setChatMessages((prev) => prev.filter((msg) => msg.id !== messageId));
  }, []);

  const deleteMessageForEveryone = useCallback(
    (messageId: string) => {
      const target = chatMessagesRef.current.find((msg) => msg.id === messageId);
      // Guarded here as well as on receipt, so the button can never put an event
      // on the wire that every recipient would just throw away.
      if (!target || target.userId !== identity.userId || target.deleted) return;
      setChatMessages((prev) => withDeletion(prev, messageId, identity.userId));
      channelRef.current?.broadcast('CHAT_DELETE', { messageId });
    },
    [identity.userId]
  );

  const copyRoomCode = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(room.code);
    }
  }, [room.code]);

  const leaveRoom = useCallback(() => {
    channelRef.current?.disconnect();
    channelRef.current = null;
    // Deliberate exit, not a reload — drop everything pinned to this room so
    // walking back in later doesn't reclaim host from whoever inherited it.
    clearRoomSession(code);
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, [code]);

  const value: RoomContextValue = {
    room,
    currentUser,
    users: roster,
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
    hostId,
    hostOnlyControl,
    sendChatMessage,
    toggleReaction,
    deleteMessageForMe,
    deleteMessageForEveryone,
    copyRoomCode,
    leaveRoom,
    broadcastEvent,
    transferHost,
    setHostOnlyControl,
    videoCallState,
    remoteStreams,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
    toggleScreenShare,
    pinnedUserId,
    togglePinnedUser,
    mutedUserIds,
    toggleUserMuted,
    callReactions,
    sendCallReaction,
    getLocalCallStream,
    setInPageVideo,
    reportInPagePosition,
    subscribeRemoteSync,
    registerPositionSampler,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
