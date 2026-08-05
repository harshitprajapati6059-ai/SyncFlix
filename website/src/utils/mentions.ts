/**
 * @-mentions in chat.
 *
 * SyncFlix has no accounts, so there are no handles to match against, only the
 * display names in the current presence roster, which a user picks freely and
 * may contain spaces. That rules out the usual `@\w+` regex: mentions are found
 * by matching the roster's names against the text, longest name first, so
 * "@BlueFox" never resolves to a shorter "@Blue" who happens to also be in the
 * room.
 *
 * Nothing here is authoritative. The sender resolves mentions against the
 * roster they can see and ships the resulting userIds with the message, so
 * every recipient agrees on who was pinged even if their own roster has since
 * moved on. Rendering re-parses locally purely to know which spans to highlight.
 */

/** Stands in for the whole room in a message's `mentions` list. */
export const MENTION_EVERYONE = '*';

/** Names that ping everyone rather than one person. */
const EVERYONE_ALIASES = ['everyone', 'room', 'all'];

/** How much text after '@' the composer will consider part of a query. */
const MAX_QUERY_LENGTH = 32;

export interface MentionTarget {
  userId: string;
  username: string;
}

/** A parsed span of message text: either a plain run or a resolved mention. */
export type MessageSegment =
  { type: 'text'; text: string } | { type: 'mention'; text: string; userId: string };

/** An in-progress `@…` the caret is sitting inside, for the composer popup. */
export interface MentionQuery {
  /** Index of the '@' itself. */
  start: number;
  /** Text typed after the '@', up to the caret. */
  query: string;
}

/** True for positions where an '@' may start a mention (not mid-word, not an email). */
function isStartBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s([{<"'`,;:!?]/.test(char);
}

/** True for positions where a mention may end: anything that isn't more name. */
function isEndBoundary(char: string | undefined): boolean {
  return char === undefined || !/[\p{L}\p{N}_]/u.test(char);
}

/**
 * Roster names plus the everyone aliases, longest first so the greediest match
 * wins. Ties are broken on the name itself to keep the order deterministic
 * across clients whose rosters arrived in a different order.
 */
function candidates(targets: MentionTarget[]): { userId: string; name: string }[] {
  const list = targets
    .filter((t) => t.username.trim().length > 0)
    .map((t) => ({ userId: t.userId, name: t.username }));
  for (const alias of EVERYONE_ALIASES) {
    list.push({ userId: MENTION_EVERYONE, name: alias });
  }
  return list.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

/**
 * Splits message text into plain runs and mention spans.
 *
 * Unmatched '@' text stays plain. A name that left the room, or a typo, reads
 * as ordinary text rather than a dead highlight.
 */
export function parseMessageSegments(text: string, targets: MentionTarget[]): MessageSegment[] {
  if (!text.includes('@')) return text ? [{ type: 'text', text }] : [];

  const list = candidates(targets);
  const lower = text.toLowerCase();
  const segments: MessageSegment[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '@' || !isStartBoundary(text[i - 1])) {
      i += 1;
      continue;
    }
    const match = list.find(
      (c) =>
        lower.startsWith(c.name.toLowerCase(), i + 1) && isEndBoundary(text[i + 1 + c.name.length])
    );
    if (!match) {
      i += 1;
      continue;
    }
    if (i > plainStart) segments.push({ type: 'text', text: text.slice(plainStart, i) });
    const end = i + 1 + match.name.length;
    segments.push({ type: 'mention', text: text.slice(i, end), userId: match.userId });
    i = end;
    plainStart = end;
  }

  if (plainStart < text.length) segments.push({ type: 'text', text: text.slice(plainStart) });
  return segments;
}

/** The distinct userIds a message pings. MENTION_EVERYONE covers the room. */
export function extractMentionIds(text: string, targets: MentionTarget[]): string[] {
  const ids = new Set<string>();
  for (const segment of parseMessageSegments(text, targets)) {
    if (segment.type === 'mention') ids.add(segment.userId);
  }
  return [...ids];
}

/** True when `mentions` pings this user, either by name or as part of the room. */
export function mentionsUser(mentions: string[] | undefined, userId: string | undefined): boolean {
  if (!mentions?.length || !userId) return false;
  return mentions.includes(userId) || mentions.includes(MENTION_EVERYONE);
}

/**
 * The `@…` the caret is currently inside, or null.
 *
 * The query deliberately stops at whitespace even though names may contain it:
 * letting it run on would keep the popup open across a whole sentence. A name
 * with a space is still reachable, since its first word narrows the list and
 * picking from the list inserts the full name.
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (!isStartBoundary(text[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH || /\s/.test(query)) return null;
  return { start: at, query };
}

/** Roster entries whose name matches an in-progress query, best match first. */
export function matchMentionTargets(query: string, targets: MentionTarget[]): MentionTarget[] {
  const q = query.trim().toLowerCase();
  const everyone: MentionTarget = { userId: MENTION_EVERYONE, username: 'everyone' };
  const pool = [everyone, ...targets];
  if (!q) return pool;
  return pool
    .filter((t) => t.username.toLowerCase().includes(q))
    .sort((a, b) => {
      // Prefix matches beat matches buried in the middle of a name.
      const aStarts = a.username.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.username.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.username.localeCompare(b.username);
    });
}

/**
 * Replaces the in-progress query with a full mention, returning the new text
 * and where the caret belongs. A trailing space is added so the next word
 * doesn't get swallowed into the name.
 */
export function applyMention(
  text: string,
  active: MentionQuery,
  username: string
): { text: string; caret: number } {
  const inserted = `@${username} `;
  const before = text.slice(0, active.start);
  const after = text.slice(active.start + 1 + active.query.length);
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}
