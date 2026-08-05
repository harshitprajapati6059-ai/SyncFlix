/**
 * Realtime service — Supabase Realtime channel management.
 *
 * Rooms are ephemeral: they exist only while users are connected. There is no
 * database. A "room" is simply a Supabase Realtime channel named after the room
 * code, carrying two things:
 *   - Presence  → who is in the room (the connected-user list)
 *   - Broadcast → sync events (PLAY / PAUSE / SEEK / POSITION_UPDATE / …) and chat
 *
 * When the last client leaves the channel, the room ceases to exist.
 */

import type { RealtimeChannel as SupabaseRealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getRoomJoinedAt, getRoomHostSeq, getRoomHostOnly } from '@/utils/session';
import type { SyncEventType, PresenceUser, UserRole } from '@/types/room';

export type EventHandler = (
  payload: Record<string, unknown>,
  userId: string,
  username: string
) => void;
export type PresenceHandler = (users: PresenceUser[]) => void;
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type StatusHandler = (status: ConnectionStatus) => void;

export interface RealtimeChannel {
  /** Register a handler for an incoming broadcast event. Call before connect(). */
  subscribe: (event: SyncEventType, handler: EventHandler) => void;
  /** Register a handler that fires whenever the presence roster changes. */
  onPresenceChange: (handler: PresenceHandler) => void;
  /** Register a handler for connection-status transitions. */
  onStatusChange: (handler: StatusHandler) => void;
  /** Open the channel. Tracks our presence and starts receiving events. */
  connect: () => void;
  /** Send a broadcast event to everyone in the room (including ourselves). */
  broadcast: (event: SyncEventType, payload: Record<string, unknown>) => void;
  /** Update our own presence metadata (merged into the tracked state). */
  updatePresence: (state: Partial<PresenceUser>) => void;
  /** Leave the room and tear down the channel. */
  disconnect: () => void;
}

/** Identity carried by a channel member. */
export interface ChannelUser {
  userId: string;
  username: string;
  role: UserRole;
}

/** The shape we track into Supabase presence. */
interface PresenceState {
  userId: string;
  username: string;
  role: UserRole;
  joinedAt: string;
  /** Bumped on every track() so the newest meta for a key is identifiable. */
  rev: number;
  /**
   * Wall-clock stamp of this track(), and the primary way the newest meta is
   * found. `rev` alone can't do it: it restarts at 1 on every page load while
   * the metas it competes with survive, so after a reload the pre-reload meta
   * outranked the live one forever.
   *
   * Only ever compared against other metas for the *same* key — i.e. stamps
   * produced by one machine's clock — so cross-device clock skew never matters.
   */
  at: number;
  hostSeq: number;
  hostOnly: boolean;
  inCall?: boolean;
  cameraOn?: boolean;
  micOn?: boolean;
  screenSharing?: boolean;
  // Needed so this can be handed to channel.track() as a payload. It also means
  // a field can be *written* into presence that the projection below never
  // reads back out, with nothing to catch it — see CALL_FLAG_KEYS.
  [key: string]: unknown;
}

/** The volatile call flags a participant publishes about themselves. */
type CallFlags = Pick<PresenceUser, 'inCall' | 'cameraOn' | 'micOn' | 'screenSharing'>;

/**
 * Every call flag, as an exhaustive lookup rather than a list.
 *
 * The mapped type is the point: `Required` forces this object to name every key
 * in CallFlags, so adding a flag there without adding it here fails to compile.
 * That is what stops the projection from silently dropping a field — which is
 * precisely how `screenSharing` came to be published by the sharer and never
 * seen by anyone else, leaving a shared screen invisible to the whole room.
 */
const CALL_FLAG_KEYS: { [K in keyof Required<CallFlags>]: true } = {
  inCall: true,
  cameraOn: true,
  micOn: true,
  screenSharing: true,
};

function callFlagsOf(meta: PresenceState): CallFlags {
  const flags: CallFlags = {};
  (Object.keys(CALL_FLAG_KEYS) as (keyof CallFlags)[]).forEach((key) => {
    flags[key] = meta[key] as boolean | undefined;
  });
  return flags;
}

/**
 * The current meta for a presence key.
 *
 * A key routinely holds more than one. Re-tracking — how a call-state change or
 * a host handover is published — appends a meta rather than replacing one, and
 * the superseded metas are never evicted, not even once the connection that
 * wrote them is gone. So a key accumulates every state a user has ever been in,
 * in no guaranteed order, and picking the live one is entirely up to us.
 *
 * `at` (wall-clock at track() time) is what picks it. An incrementing `rev`
 * can't: it restarts at 1 on every page load while the stale metas it competes
 * with survive, so after a refresh the pre-refresh meta won forever and the
 * viewer stayed frozen on old state until they themselves reloaded. `rev` is
 * kept only to break ties inside a single millisecond.
 */
function currentMeta(entries: PresenceState[] | undefined): PresenceState | undefined {
  if (!entries?.length) return undefined;
  const rank = (e: PresenceState | undefined) => [e?.at ?? 0, e?.rev ?? 0] as const;
  return entries.reduce((newest, entry) => {
    const [entryAt, entryRev] = rank(entry);
    const [newestAt, newestRev] = rank(newest);
    if (entryAt !== newestAt) return entryAt > newestAt ? entry : newest;
    return entryRev >= newestRev ? entry : newest;
  });
}

/** Every broadcast payload carries the sender's identity so the UI can attribute it. */
interface BroadcastEnvelope {
  senderId: string;
  senderName: string;
  payload: Record<string, unknown>;
}

/**
 * Creates a live realtime channel for a given room code.
 *
 * The channel uses a presence key of the userId, so each user appears exactly
 * once in presence state (a reconnect replaces the entry rather than adding one).
 */
export function createRealtimeChannel(roomCode: string, user: ChannelUser): RealtimeChannel {
  const supabase = createClient();
  // Sticky across reloads — host election reads this, and a fresh timestamp on
  // every mount meant refreshing the page cost you the host role.
  const joinedAt = getRoomJoinedAt(roomCode);
  const topic = `room:${roomCode}`;

  // Supabase reuses channels by topic. If a channel with this topic already
  // exists (e.g. React StrictMode remounted the effect before the previous
  // channel finished tearing down), remove it first so we get a pristine
  // channel. Registering `.on()` handlers on an already-subscribed channel
  // throws "cannot add callbacks after subscribe()".
  supabase
    .getChannels()
    .filter((c) => c.topic === `realtime:${topic}`)
    .forEach((c) => {
      void supabase.removeChannel(c);
    });

  const channel: SupabaseRealtimeChannel = supabase.channel(topic, {
    config: {
      presence: { key: user.userId },
      broadcast: { self: true }, // echo our own events back so local UI stays consistent
    },
  });

  const eventHandlers = new Map<SyncEventType, EventHandler[]>();
  const boundEvents = new Set<SyncEventType>();
  let presenceHandler: PresenceHandler | null = null;
  let statusHandler: StatusHandler | null = null;
  let connected = false;

  let rev = 0;
  /**
   * Publish our presence, stamped so receivers can tell it from every stale meta
   * still sitting on our key — including ones written before the last reload.
   * See currentMeta() for why the wall-clock stamp is what does the work.
   */
  const trackSelf = () => {
    selfPresence.rev = ++rev;
    selfPresence.at = Date.now();
    void channel.track(selfPresence);
  };

  const selfPresence: PresenceState = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    joinedAt,
    rev: 0,
    at: 0, // replaced by trackSelf() before this is ever published
    // Both survive a reload for the same reason joinedAt does — a host who was
    // handed the role, and the lock they set, must come back as they left.
    hostSeq: getRoomHostSeq(roomCode),
    hostOnly: getRoomHostOnly(roomCode),
  };

  // ─── Presence → connected-user list ──────────────────────────────────────
  const emitPresence = () => {
    if (!presenceHandler) return;
    const state = channel.presenceState<PresenceState>();
    const now = new Date().toISOString();
    const users: PresenceUser[] = Object.values(state)
      .map((entries) => currentMeta(entries))
      .filter((p): p is PresenceState => Boolean(p))
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        role: p.role,
        connected: true,
        joinedAt: p.joinedAt,
        lastSeen: now,
        hostSeq: typeof p.hostSeq === 'number' ? p.hostSeq : 0,
        hostOnly: p.hostOnly === true,
        ...callFlagsOf(p),
      }))
      // joinedAt first; userId tiebreak so every client derives the same order
      // (host election picks the first entry — it must be deterministic).
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId));
    presenceHandler(users);
  };

  channel.on('presence', { event: 'sync' }, emitPresence);
  channel.on('presence', { event: 'join' }, emitPresence);
  channel.on('presence', { event: 'leave' }, emitPresence);

  // ─── Broadcast → sync events ──────────────────────────────────────────────
  // Supabase requires one listener per event name; we bind lazily the first
  // time an event is subscribed to.
  const bindBroadcast = (event: SyncEventType) => {
    if (boundEvents.has(event)) return;
    boundEvents.add(event);
    channel.on('broadcast', { event }, (message) => {
      const envelope = message.payload as BroadcastEnvelope;
      const handlers = eventHandlers.get(event) ?? [];
      handlers.forEach((h) =>
        h(envelope?.payload ?? {}, envelope?.senderId ?? '', envelope?.senderName ?? '')
      );
    });
  };

  return {
    subscribe(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
      bindBroadcast(event);
    },

    onPresenceChange(handler) {
      presenceHandler = handler;
    },

    onStatusChange(handler) {
      statusHandler = handler;
    },

    connect() {
      if (connected) return;
      connected = true;
      statusHandler?.('connecting');
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          trackSelf();
          statusHandler?.('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          statusHandler?.('error');
        } else if (status === 'CLOSED') {
          statusHandler?.('disconnected');
        }
      });
    },

    broadcast(event, payload) {
      const envelope: BroadcastEnvelope = {
        senderId: user.userId,
        senderName: user.username,
        payload,
      };
      void channel.send({ type: 'broadcast', event, payload: envelope });
    },

    updatePresence(state) {
      // Every track() appends a meta to our presence key that is never evicted,
      // so re-publishing state that hasn't changed grows the payload every
      // client receives for no benefit. Only publish real transitions.
      const changed = Object.entries(state).some(([key, value]) => selfPresence[key] !== value);
      if (!changed) return;
      Object.assign(selfPresence, state);
      trackSelf();
    },

    disconnect() {
      eventHandlers.clear();
      boundEvents.clear();
      presenceHandler = null;
      const notify = statusHandler;
      statusHandler = null;
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
      notify?.('disconnected');
    },
  };
}
