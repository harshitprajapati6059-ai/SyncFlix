/**
 * Core domain types for SyncFlix.
 * All Supabase integration points are marked with // BACKEND: comments.
 */

// ─── User & Presence ────────────────────────────────────────────────────────

export type UserRole = 'host' | 'viewer';

export interface PresenceUser {
  userId: string;
  username: string;
  role: UserRole;
  connected: boolean;
  joinedAt: string; // ISO timestamp
  lastSeen: string; // ISO timestamp
  /**
   * Host-transfer counter. The highest value in the room wins the host role,
   * overriding the joinedAt order. 0/undefined = never handed the role.
   */
  hostSeq?: number;
  /** Host-only playback lock, as published by whoever currently holds the role. */
  hostOnly?: boolean;
  /** True while this user has joined the video call (not just the room). */
  inCall?: boolean;
  cameraOn?: boolean;
  micOn?: boolean;
  /** True while this user is sending their screen instead of their camera. */
  screenSharing?: boolean;
}

// ─── Room ────────────────────────────────────────────────────────────────────

export type RoomStatus = 'active' | 'empty' | 'expired';

export interface Room {
  id: string;
  code: string;
  createdAt: string;
  hostId: string;
  status: RoomStatus;
}

// ─── Playback State ──────────────────────────────────────────────────────────

export type PlaybackStatus = 'playing' | 'paused' | 'buffering' | 'idle';

export interface PlaybackState {
  playing: boolean;
  status: PlaybackStatus;
  currentTime: number; // seconds
  /** Total length in seconds. 0 when unknown — the extension doesn't report it. */
  duration: number;
  playbackRate: number; // 1.0 = normal
  platform: string | null; // "YouTube" | "Netflix" | "Prime Video" | null — provided by extension
  lastUpdated: string; // ISO timestamp
  updatedBy: string; // userId
}

// ─── Sync State ──────────────────────────────────────────────────────────────

export type SyncStatus = 'synced' | 'syncing' | 'desynced' | 'unknown';

export interface SyncState {
  status: SyncStatus;
  latencyMs: number;
  drift: number; // seconds behind/ahead of host
  lastChecked: string;
}

// ─── Extension ───────────────────────────────────────────────────────────────

export type ExtensionStatus = 'connected' | 'disconnected' | 'waiting';

export interface ExtensionState {
  status: ExtensionStatus;
  platform: string | null;
  version: string | null;
  /** Identity of the video open in this machine's player tab (from the extension). */
  videoId: string | null;
  videoUrl: string | null;
}

/** The video the room host is currently watching, as learned from their events. */
export interface HostVideo {
  videoId: string | null;
  videoUrl: string | null;
}

// ─── In-page player ──────────────────────────────────────────────────────────

/**
 * The extension-free playback path: a YouTube IFrame embedded in the room page.
 * Used on phones and tablets, which cannot install the extension at all, and as
 * a fallback on desktop when it isn't installed.
 *
 * When `active`, this player — not the extension and not the dead-reckoning
 * ticker — owns the local playback clock.
 */
export interface InPagePlayerState {
  /** True once a real YouTube player is mounted and holding a video. */
  active: boolean;
  videoId: string | null;
  videoUrl: string | null;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

/** Reactions on one message: emoji → the userIds that picked it. */
export type ChatReactions = Record<string, string[]>;

/**
 * The message a reply points at.
 *
 * Snapshotted rather than looked up by id: there is no chat history server, so
 * someone who joined after the original was sent has no way to resolve it, and
 * the quote would render blank for them.
 */
export interface ChatReplyRef {
  id: string;
  userId: string;
  username: string;
  /** Preview of the original text, truncated at send time. */
  message: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: string;
  /** Set when this message was sent as a reply to another one. */
  replyTo?: ChatReplyRef | null;
  /**
   * userIds this message pings, resolved by the sender against the roster they
   * could see. MENTION_EVERYONE ('*') stands in for the whole room.
   */
  mentions?: string[];
  reactions?: ChatReactions;
  /**
   * Set when the sender withdrew this message for everyone. The row stays in
   * place as a tombstone rather than vanishing, so a conversation that was
   * replying to it doesn't silently lose its subject.
   *
   * "Delete for me" is not this: it drops the message from one person's list
   * outright and never leaves the client.
   */
  deleted?: boolean;
}

// ─── Event Log ───────────────────────────────────────────────────────────────

export type SyncEventType =
  | 'JOIN_ROOM'
  | 'LEAVE_ROOM'
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'POSITION_UPDATE'
  | 'PLAYBACK_SPEED'
  | 'HEARTBEAT'
  | 'PLATFORM_CHANGED'
  | 'USER_CONNECTED'
  | 'USER_DISCONNECTED'
  | 'CHAT_MESSAGE'
  | 'CHAT_REACTION'
  | 'CHAT_DELETE'
  | 'CALL_REACTION'
  | 'HOST_TRANSFER'
  | 'WEBRTC_SIGNAL';

export interface SyncEvent {
  id: string;
  type: SyncEventType;
  userId: string;
  username: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ─── Realtime Event Payloads ─────────────────────────────────────────────────

export interface JoinRoomPayload {
  userId: string;
  username: string;
  role: UserRole;
}

export interface LeaveRoomPayload {
  userId: string;
  username: string;
}

export interface PlayPayload {
  currentTime: number;
  platform: string | null;
}

export interface PausePayload {
  currentTime: number;
}

export interface SeekPayload {
  from: number;
  to: number;
}

export interface PositionUpdatePayload {
  currentTime: number;
  playing: boolean;
}

export interface PlaybackSpeedPayload {
  rate: number;
}

export interface HeartbeatPayload {
  currentTime: number;
  timestamp: string;
}

export interface PlatformChangedPayload {
  platform: string;
}

export interface UserConnectedPayload {
  userId: string;
  username: string;
}

export interface UserDisconnectedPayload {
  userId: string;
  username: string;
}

/**
 * A chat message on the wire.
 *
 * The id is minted by the sender and shared by every client, so reactions and
 * replies can address a message across the room. (The pre-reaction chat used a
 * local counter, which named the same message differently on every screen.)
 */
export interface ChatMessagePayload {
  id: string;
  message: string;
  replyTo?: ChatReplyRef | null;
  mentions?: string[];
}

/**
 * One person adding or removing one emoji on one message.
 *
 * `active` carries the resulting state rather than "toggle", so applying the
 * same event twice, which happens because the channel echoes our own sends back
 * on top of the optimistic update, lands on the same result.
 */
export interface ChatReactionPayload {
  messageId: string;
  emoji: string;
  active: boolean;
}

/**
 * The sender withdrawing one of their own messages from the whole room.
 *
 * Recipients honour it only when the sender owns the message, so nobody can
 * delete anyone else's words. "Delete for me" has no payload because it never
 * reaches the wire.
 */
export interface ChatDeletePayload {
  messageId: string;
}

/**
 * The host handing the role to someone else.
 *
 * Only the recipient acts on it: they publish `seq` into their own presence,
 * and every client re-elects from the roster. `seq` is a counter rather than a
 * timestamp so transfers order correctly no matter how far apart the
 * participants' clocks are.
 */
export interface HostTransferPayload {
  to: string; // recipient userId
  toUsername: string; // for the log line, so viewers can name them
  seq: number;
  /** The lock state the outgoing host was running, so it survives the handover. */
  hostOnly: boolean;
}

/**
 * A targeted WebRTC signaling message — every peer ignores signals not addressed
 * to it. `to: '*'` addresses everyone in the room (used by the presence-independent
 * `hello`/`bye` announcements, which would otherwise cost one message per peer).
 *
 * Kinds:
 *   offer/answer → SDP exchange
 *   ice          → a *batch* of ICE candidates (see webrtc.ts: candidates are
 *                  coalesced to stay under the Realtime per-client event rate limit)
 *   hello        → "I'm in the call" — lets peers pair up without waiting on presence
 *   bye          → "I left the call" — tears the connection down immediately
 *   reset        → "drop our connection and rebuild it at generation `gen`"
 */
export interface WebrtcSignalPayload {
  to: string; // recipient userId, or '*' for everyone
  kind: 'offer' | 'answer' | 'ice' | 'hello' | 'bye' | 'reset';
  data: unknown; // RTCSessionDescriptionInit | RTCIceCandidateInit[] | null
  /**
   * Connection generation. Bumped whenever a peer gives up on a stuck connection
   * and rebuilds it, so both sides can discard signals belonging to a dead
   * RTCPeerConnection instead of applying them to the new one.
   */
  gen?: number;
}

// ─── Video Call ────────────────────────────────────────────────────────────

export type PeerConnectionStatus = 'connecting' | 'connected' | 'failed' | 'closed';

/**
 * Why we have no camera/mic. These need telling apart because only one of them
 * is the user's to fix: `denied` is a browser permission prompt, whereas
 * `insecure` is the page being served over plain http — which is what a phone
 * gets when it opens a dev server by LAN IP, and no amount of tapping "allow"
 * will help. `unavailable` covers a device with no working capture hardware.
 */
export type CallMediaError = 'denied' | 'insecure' | 'unavailable';

/** One emoji someone threw at the call, as it goes over the wire. */
export interface CallReactionPayload {
  emoji: string;
}

/**
 * A reaction in flight on this client. Deliberately not persisted anywhere —
 * it exists only for the few seconds it spends floating up the tiles, so each
 * client mints its own id rather than the sender naming it.
 */
export interface CallReaction {
  id: string;
  userId: string;
  username: string;
  emoji: string;
  /** Horizontal start, 0–100, so simultaneous reactions don't stack in a line. */
  offset: number;
}

export interface VideoCallState {
  /** True once the local user has called joinCall(). */
  inCall: boolean;
  cameraOn: boolean;
  micOn: boolean;
  /** null = not yet requested, false = user denied it. */
  hasMediaPermission: boolean | null;
  /** Set when we're in the call without local media — see CallMediaError. */
  mediaError: CallMediaError | null;
  /** True while we're sending our screen in place of our camera. */
  screenSharing: boolean;
  /** False where getDisplayMedia doesn't exist — every current mobile browser. */
  canScreenShare: boolean;
  peers: Record<string, PeerConnectionStatus>;
}

// ─── Room Context State ───────────────────────────────────────────────────────

export interface RoomContextState {
  room: Room | null;
  currentUser: PresenceUser | null;
  users: PresenceUser[];
  playbackState: PlaybackState;
  syncState: SyncState;
  extensionState: ExtensionState;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  events: SyncEvent[];
  chatMessages: ChatMessage[];
  /** The video the host is watching, for the "open the same video" link. */
  hostVideo: HostVideo;
  /** True when our player tab is on a different video than the host. */
  videoMismatch: boolean;
  /** State of the in-page YouTube player (the extension-free path). */
  inPagePlayer: InPagePlayerState;
  /** True when this client is the presence-elected host. */
  amHost: boolean;
  /** userId of the current host, or null until presence first syncs. */
  hostId: string | null;
  /**
   * When true, only the host's play/pause/seek moves the room; viewers control
   * their own player without dragging everyone else along. Off by default.
   */
  hostOnlyControl: boolean;
}
