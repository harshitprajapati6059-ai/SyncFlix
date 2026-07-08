'use client';

/**
 * RoomContext — provides all room state to the Room page and its children.
 * BACKEND: Replace mock state with Supabase Realtime subscriptions.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
} from '@/types/room';
import {
  MOCK_ROOM,
  MOCK_USERS,
  MOCK_PLAYBACK,
  MOCK_SYNC,
  MOCK_EXTENSION,
  MOCK_EVENTS,
  MOCK_CHAT,
} from '@/lib/mockData';

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

export function RoomProvider({ children, roomCode, isHost = false }: RoomProviderProps) {
  const [room] = useState<Room>({ ...MOCK_ROOM, code: roomCode ?? MOCK_ROOM.code });
  const [users, setUsers] = useState<PresenceUser[]>(MOCK_USERS);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(MOCK_PLAYBACK);
  const [syncState, setSyncState] = useState<SyncState>(MOCK_SYNC);
  const [extensionState] = useState<ExtensionState>(MOCK_EXTENSION);
  const [connectionStatus, setConnectionStatus] =
    useState<RoomContextState['connectionStatus']>('connecting');
  const [events, setEvents] = useState<SyncEvent[]>(MOCK_EVENTS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(MOCK_CHAT);

  const currentUser = users.find((u) => u.role === (isHost ? 'host' : 'viewer')) ?? users[0];
  const tickRef = useRef(0);

  // Simulate connection establishment
  useEffect(() => {
    // BACKEND: Initialize Supabase Realtime channel here
    const timer = setTimeout(() => setConnectionStatus('connected'), 1200);
    return () => clearTimeout(timer);
  }, []);

  // Simulate playback ticker
  useEffect(() => {
    if (!playbackState.playing || connectionStatus !== 'connected') return;
    const interval = setInterval(() => {
      tickRef.current += 1;
      setPlaybackState((prev) => ({
        ...prev,
        currentTime: prev.playing ? prev.currentTime + 1 : prev.currentTime,
        lastUpdated: new Date().toISOString(),
      }));
      // Simulate occasional sync drift correction
      if (tickRef.current % 8 === 0) {
        setSyncState((prev) => ({
          ...prev,
          latencyMs: 30 + Math.floor(Math.random() * 40),
          drift: parseFloat((Math.random() * 0.6 - 0.3).toFixed(1)),
          lastChecked: new Date().toISOString(),
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [playbackState.playing, connectionStatus]);

  const sendChatMessage = useCallback(
    (message: string) => {
      if (!message.trim() || !currentUser) return;
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        userId: currentUser.userId,
        username: currentUser.username,
        message: message.trim(),
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, newMsg]);
      // BACKEND: channel.send({ type: 'broadcast', event: 'CHAT_MESSAGE', payload: newMsg })
    },
    [currentUser]
  );

  const broadcastEvent = useCallback(
    (type: SyncEventType, payload: Record<string, unknown>) => {
      if (!currentUser) return;
      const evt: SyncEvent = {
        id: `evt-${Date.now()}`,
        type,
        userId: currentUser.userId,
        username: currentUser.username,
        payload,
        timestamp: new Date().toISOString(),
      };
      setEvents((prev) => [evt, ...prev].slice(0, 50));
      // BACKEND: channel.send({ type: 'broadcast', event: type, payload })
    },
    [currentUser]
  );

  const copyRoomCode = useCallback(() => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(room.code);
    }
  }, [room.code]);

  const leaveRoom = useCallback(() => {
    // BACKEND: channel.untrack() + supabase.removeChannel(channel)
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, []);

  const value: RoomContextValue = {
    room,
    currentUser: currentUser ?? null,
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
