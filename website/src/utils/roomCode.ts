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
