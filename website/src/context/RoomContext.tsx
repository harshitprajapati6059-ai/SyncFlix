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
  SyncEvent,
  ChatMessage,
  SyncEventType,
  UserRole,
} from '@/types/room';
import { createRealtimeChannel, type RealtimeChannel } from '@/services/realtimeService';
import { getSessionIdentity } from '@/utils/session';

interface RoomContextValue extends RoomContextState {
  sendChatMessage: (message: string) => void;
  copyRoomCode: () => void;
  leaveRoom: () => void;
  broadcastEvent: (type: SyncEventType, payload: Record<string, unknown>) => void;
}

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

const INITIAL_PLAYBACK: PlaybackState = {
  playing: false,
  status: 'idle',
  currentTime: 0,
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

const INITIAL_EXTENSION: ExtensionState = {
  status: 'waiting',
  platform: null,
  version: null,
};

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
  const [extensionState] = useState<ExtensionState>(INITIAL_EXTENSION);
  const [connectionStatus, setConnectionStatus] =
    useState<RoomContextState['connectionStatus']>('connecting');
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest local playback time, so the host can heartbeat without stale closures.
  const playbackRef = useRef<PlaybackState>(INITIAL_PLAYBACK);
  playbackRef.current = playbackState;

  const currentUser: PresenceUser | null = users.find((u) => u.userId === identity.userId) ?? {
    userId: identity.userId,
    username: identity.username,
    role,
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
            id: `evt-${type}-${userId}-${prev.length}`,
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

    const channel = createRealtimeChannel(code, {
      userId: identity.userId,
      username: identity.username,
      role,
    });
    channelRef.current = channel;

    channel.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    channel.onPresenceChange((roster) => {
      setUsers(roster);
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
      logEvent('PAUSE', userId, username, payload);
    });

    channel.subscribe('SEEK', (payload, userId, username) => {
      applyPlayback(
        { currentTime: typeof payload.to === 'number' ? payload.to : undefined },
        userId
      );
      logEvent('SEEK', userId, username, payload);
    });

    channel.subscribe('PLAYBACK_SPEED', (payload, userId, username) => {
      applyPlayback(
        { playbackRate: typeof payload.rate === 'number' ? payload.rate : undefined },
        userId
      );
      logEvent('PLAYBACK_SPEED', userId, username, payload);
    });

    channel.subscribe('PLATFORM_CHANGED', (payload, userId, username) => {
      applyPlayback({ platform: (payload.platform as string | null) ?? null }, userId);
      logEvent('PLATFORM_CHANGED', userId, username, payload);
    });

    // Position heartbeat from the host: viewers snap to it and measure drift.
    channel.subscribe('POSITION_UPDATE', (payload, userId) => {
      if (userId === identity.userId) return; // ignore our own heartbeat echo
      const hostTime = typeof payload.currentTime === 'number' ? payload.currentTime : null;
      const hostPlaying = Boolean(payload.playing);
      if (hostTime === null) return;

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
          id: `msg-${userId}-${prev.length}`,
          userId,
          username,
          message: text,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    channel.connect();

    return () => {
      channel.disconnect();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ─── Host position heartbeat ────────────────────────────────────────────────
  useEffect(() => {
    if (role !== 'host' || connectionStatus !== 'connected') return;
    const interval = setInterval(() => {
      const pb = playbackRef.current;
      channelRef.current?.broadcast('POSITION_UPDATE', {
        currentTime: pb.currentTime,
        playing: pb.playing,
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [role, connectionStatus]);

  // ─── Local playback ticker ──────────────────────────────────────────────────
  // Advances the local clock while playing so the position display moves between
  // discrete events / heartbeats. Extension integration will later drive this
  // from the real player, but the ticker keeps the UI live in the meantime.
  useEffect(() => {
    if (!playbackState.playing || connectionStatus !== 'connected') return;
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
  }, [playbackState.playing, playbackState.playbackRate, connectionStatus]);

  const broadcastEvent = useCallback((type: SyncEventType, payload: Record<string, unknown>) => {
    channelRef.current?.broadcast(type, payload);
  }, []);

  const sendChatMessage = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      // Optimistically render our own message, then broadcast.
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg-self-${prev.length}`,
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
    sendChatMessage,
    copyRoomCode,
    leaveRoom,
    broadcastEvent,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
