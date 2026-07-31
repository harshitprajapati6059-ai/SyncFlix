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
  inCall?: boolean;
  cameraOn?: boolean;
  micOn?: boolean;
  [key: string]: unknown;
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
  const joinedAt = new Date().toISOString();
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

  const selfPresence: PresenceState = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    joinedAt,
  };

  // ─── Presence → connected-user list ──────────────────────────────────────
  const emitPresence = () => {
    if (!presenceHandler) return;
    const state = channel.presenceState<PresenceState>();
    const now = new Date().toISOString();
    const users: PresenceUser[] = Object.values(state)
      .map((entries) => entries[0]) // one entry per presence key
      .filter(Boolean)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        role: p.role,
        connected: true,
        joinedAt: p.joinedAt,
        lastSeen: now,
        inCall: p.inCall,
        cameraOn: p.cameraOn,
        micOn: p.micOn,
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
          void channel.track(selfPresence);
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
      Object.assign(selfPresence, state);
      void channel.track(selfPresence);
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
