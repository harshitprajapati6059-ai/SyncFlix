/**
 * Utilities for generating and validating room codes.
 * Room codes are 6-character alphanumeric uppercase strings.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars: I, O, 0, 1

/**
 * Generates a random 6-character room code.
 * Format: [A-Z2-9]{6} — e.g. "AB12CD", "X7P91Q"
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Validates a room code format (client-side only).
 * Does not check if the room exists — use the room service for that.
 */
export function isValidRoomCodeFormat(code: string): boolean {
  return /^[A-Z2-9]{6}$/.test(code.toUpperCase().trim());
}

/**
 * Normalizes a room code input (uppercase, trim, remove spaces).
 */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/**
 * Builds the shareable invite URL for a room — the SyncFlix equivalent of a
 * Google Meet link. Opening it lands on the join screen with the code already
 * filled in, so the guest only picks a display name.
 *
 * Origin comes from the browser, so this returns '' on the server. Callers
 * should build it in an effect and treat '' as "not ready yet".
 */
export function buildInviteLink(code: string): string {
  const normalized = normalizeRoomCode(code ?? '');
  if (!normalized || typeof window === 'undefined') return '';
  return `${window.location.origin}/join-room?code=${normalized}`;
}
