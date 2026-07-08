/**
 * Generates temporary session usernames.
 * Usernames only exist during the session — no persistence.
 */

const ADJECTIVES = [
  'Blue',
  'Silent',
  'Nova',
  'Pixel',
  'Neon',
  'Dark',
  'Swift',
  'Calm',
  'Bold',
  'Frost',
  'Lunar',
  'Solar',
  'Jade',
  'Ember',
  'Storm',
  'Void',
  'Echo',
  'Zen',
  'Sage',
  'Iron',
  'Onyx',
  'Ash',
  'Cyan',
  'Dusk',
];

const NOUNS = [
  'Fox',
  'Tiger',
  'Wolf',
  'Bear',
  'Hawk',
  'Lynx',
  'Raven',
  'Viper',
  'Falcon',
  'Shark',
  'Cobra',
  'Eagle',
  'Panther',
  'Otter',
  'Crane',
  'Bison',
  'Drake',
  'Moose',
  'Kite',
  'Wren',
  'Puma',
  'Ibis',
  'Dingo',
  'Newt',
];

/**
 * Generates a random temporary username like "BlueFox" or "SilentTiger".
 */
export function generateUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

/**
 * Generates a stable user ID for the session.
 * Uses crypto.randomUUID if available, falls back to timestamp-based ID.
 */
export function generateUserId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
