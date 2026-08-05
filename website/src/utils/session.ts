/**
 * Session identity — anonymous, per-tab identity for a SyncFlix participant.
 *
 * SyncFlix has no accounts and no auth. A participant is just a random userId
 * plus a suggested username, held in sessionStorage for the life of the tab.
 * These are created when a user creates or joins a room and read back when the
 * room page mounts.
 */

import { generateUserId, generateUsername } from '@/utils/username';
import type { UserRole } from '@/types/room';

const USER_ID_KEY = 'syncflix_user_id';
const USERNAME_KEY = 'syncflix_username';
const ROLE_KEY = 'syncflix_role';
const JOINED_AT_PREFIX = 'syncflix_joined_at:';
const HOST_SEQ_PREFIX = 'syncflix_host_seq:';
const HOST_ONLY_PREFIX = 'syncflix_host_only:';

export interface SessionIdentity {
  userId: string;
  username: string;
  role: UserRole;
}

/**
 * Persists identity for the current tab. Called from Create/Join flows.
 */
export function setSessionIdentity(identity: SessionIdentity): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(USER_ID_KEY, identity.userId);
  sessionStorage.setItem(USERNAME_KEY, identity.username);
  sessionStorage.setItem(ROLE_KEY, identity.role);
}

/**
 * Reads identity for the current tab. If none exists (e.g. the user navigated
 * straight to a room URL), a fresh anonymous identity is created and stored so
 * the participant still gets a stable id + username for the session.
 *
 * `roleHint` (from the room URL) is used only when no role was stored.
 */
export function getSessionIdentity(roleHint: UserRole = 'viewer'): SessionIdentity {
  if (typeof sessionStorage === 'undefined') {
    // SSR / no storage — return an ephemeral identity; the client will re-read.
    return { userId: generateUserId(), username: generateUsername(), role: roleHint };
  }

  let userId = sessionStorage.getItem(USER_ID_KEY);
  let username = sessionStorage.getItem(USERNAME_KEY);
  const storedRole = sessionStorage.getItem(ROLE_KEY) as UserRole | null;

  if (!userId) {
    userId = generateUserId();
    sessionStorage.setItem(USER_ID_KEY, userId);
  }
  if (!username) {
    username = generateUsername();
    sessionStorage.setItem(USERNAME_KEY, username);
  }

  const role = storedRole ?? roleHint;
  if (!storedRole) sessionStorage.setItem(ROLE_KEY, role);

  return { userId, username, role };
}

/**
 * This tab's join time for a room, stable across page reloads.
 *
 * Host election sorts the presence roster by joinedAt and picks the earliest
 * member, so a timestamp minted on every mount handed the room to whoever
 * hadn't refreshed most recently. Pinning it per room keeps the creator first
 * in the roster no matter how often they reload.
 *
 * Scoped per room code so re-entering a *different* room joins as a newcomer,
 * and cleared on an explicit leave (see clearRoomJoinedAt).
 */
export function getRoomJoinedAt(roomCode: string): string {
  if (typeof sessionStorage === 'undefined') return new Date().toISOString();

  const key = JOINED_AT_PREFIX + roomCode;
  const stored = sessionStorage.getItem(key);
  if (stored) return stored;

  const joinedAt = new Date().toISOString();
  sessionStorage.setItem(key, joinedAt);
  return joinedAt;
}

/**
 * This tab's host-transfer counter for a room — 0 when the role was never
 * handed to us. Published into presence; the highest counter in the room is
 * host. Persisted for the same reason as joinedAt: a host who was *given* the
 * role must keep it across a reload.
 */
export function getRoomHostSeq(roomCode: string): number {
  if (typeof sessionStorage === 'undefined') return 0;
  const stored = Number(sessionStorage.getItem(HOST_SEQ_PREFIX + roomCode));
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

export function setRoomHostSeq(roomCode: string, seq: number): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(HOST_SEQ_PREFIX + roomCode, String(seq));
}

/**
 * The host-only playback lock this tab publishes while it holds the host role.
 * Off unless explicitly turned on, and remembered across a reload so refreshing
 * doesn't quietly unlock the room.
 */
export function getRoomHostOnly(roomCode: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(HOST_ONLY_PREFIX + roomCode) === 'true';
}

export function setRoomHostOnly(roomCode: string, hostOnly: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(HOST_ONLY_PREFIX + roomCode, String(hostOnly));
}

/**
 * Forgets everything pinned to a room. Called when the user deliberately
 * leaves, so walking back in later puts them at the end of the roster instead
 * of letting them reclaim the host role from whoever inherited it.
 */
export function clearRoomSession(roomCode: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(JOINED_AT_PREFIX + roomCode);
  sessionStorage.removeItem(HOST_SEQ_PREFIX + roomCode);
  sessionStorage.removeItem(HOST_ONLY_PREFIX + roomCode);
}
