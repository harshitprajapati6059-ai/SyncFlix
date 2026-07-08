/**
 * Mock data and simulation helpers for UI development.
 * BACKEND: Replace these with Supabase Realtime channel subscriptions.
 */

import type {
  Room,
  PresenceUser,
  PlaybackState,
  SyncState,
  ExtensionState,
  SyncEvent,
  ChatMessage,
} from '@/types/room';

export const MOCK_ROOM: Room = {
  id: 'room-7f3a2b1c',
  code: 'X7P91Q',
  createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  hostId: 'user-host-001',
  status: 'active',
};

export const MOCK_USERS: PresenceUser[] = [
  {
    userId: 'user-host-001',
    username: 'BlueFox',
    role: 'host',
    connected: true,
    joinedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    lastSeen: new Date(Date.now() - 5 * 1000).toISOString(),
  },
  {
    userId: 'user-viewer-002',
    username: 'SilentTiger',
    role: 'viewer',
    connected: true,
    joinedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    lastSeen: new Date(Date.now() - 12 * 1000).toISOString(),
  },
  {
    userId: 'user-viewer-003',
    username: 'NovaWolf',
    role: 'viewer',
    connected: true,
    joinedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    lastSeen: new Date(Date.now() - 3 * 1000).toISOString(),
  },
];

export const MOCK_PLAYBACK: PlaybackState = {
  playing: true,
  status: 'playing',
  currentTime: 1847,
  playbackRate: 1.0,
  platform: 'YouTube',
  lastUpdated: new Date(Date.now() - 2 * 1000).toISOString(),
  updatedBy: 'user-host-001',
};

export const MOCK_SYNC: SyncState = {
  status: 'synced',
  latencyMs: 42,
  drift: 0.2,
  lastChecked: new Date(Date.now() - 1 * 1000).toISOString(),
};

export const MOCK_EXTENSION: ExtensionState = {
  status: 'connected',
  platform: 'YouTube',
  version: '1.0.3',
};

export const MOCK_EVENTS: SyncEvent[] = [
  {
    id: 'evt-001',
    type: 'JOIN_ROOM',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { role: 'host' },
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-002',
    type: 'PLATFORM_CHANGED',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { platform: 'YouTube' },
    timestamp: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-003',
    type: 'JOIN_ROOM',
    userId: 'user-viewer-002',
    username: 'SilentTiger',
    payload: { role: 'viewer' },
    timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-004',
    type: 'PLAY',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { currentTime: 0, platform: 'YouTube' },
    timestamp: new Date(Date.now() - 5.5 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-005',
    type: 'JOIN_ROOM',
    userId: 'user-viewer-003',
    username: 'NovaWolf',
    payload: { role: 'viewer' },
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-006',
    type: 'SEEK',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { from: 342, to: 1200 },
    timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-007',
    type: 'PAUSE',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { currentTime: 1423 },
    timestamp: new Date(Date.now() - 2.5 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-008',
    type: 'PLAY',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { currentTime: 1423, platform: 'YouTube' },
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-009',
    type: 'HEARTBEAT',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { currentTime: 1680 },
    timestamp: new Date(Date.now() - 60 * 1000).toISOString(),
  },
  {
    id: 'evt-010',
    type: 'POSITION_UPDATE',
    userId: 'user-host-001',
    username: 'BlueFox',
    payload: { currentTime: 1847, playing: true },
    timestamp: new Date(Date.now() - 15 * 1000).toISOString(),
  },
];

export const MOCK_CHAT: ChatMessage[] = [
  {
    id: 'msg-001',
    userId: 'user-viewer-002',
    username: 'SilentTiger',
    message: 'Ready when you are',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'msg-002',
    userId: 'user-host-001',
    username: 'BlueFox',
    message: 'Starting now',
    timestamp: new Date(Date.now() - 5.4 * 60 * 1000).toISOString(),
  },
  {
    id: 'msg-003',
    userId: 'user-viewer-003',
    username: 'NovaWolf',
    message: 'Just joined, catching up',
    timestamp: new Date(Date.now() - 3.9 * 60 * 1000).toISOString(),
  },
  {
    id: 'msg-004',
    userId: 'user-viewer-002',
    username: 'SilentTiger',
    message: 'That scene was wild',
    timestamp: new Date(Date.now() - 90 * 1000).toISOString(),
  },
  {
    id: 'msg-005',
    userId: 'user-host-001',
    username: 'BlueFox',
    message: 'Agreed lol',
    timestamp: new Date(Date.now() - 80 * 1000).toISOString(),
  },
];
