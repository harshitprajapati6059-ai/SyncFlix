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
