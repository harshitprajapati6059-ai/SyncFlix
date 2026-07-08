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
  playbackRate: number; // 1.0 = normal
  platform: string | null; // "YouTube" | "Netflix" | null — provided by extension
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
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: string;
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
  | 'USER_DISCONNECTED';

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
}
