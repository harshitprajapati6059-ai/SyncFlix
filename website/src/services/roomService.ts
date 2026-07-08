/**
 * Room service — room creation and join-time validation.
 *
 * There is no database. A room is an ephemeral Supabase Realtime channel that
 * exists only while at least one person is connected to it. Consequently:
 *
 *   - createRoom() does no network I/O — it just mints a unique code. The room
 *     "comes into existence" when the host connects to the channel on the room
 *     page and tracks their presence.
 *
 *   - getRoomByCode() can't SELECT from a table. Instead it briefly joins the
 *     channel and inspects presence: if anyone is already there, the room is
 *     live. If nobody appears within a short window, we treat the code as an
 *     inactive/non-existent room.
 */

import type { Room } from '@/types/room';
import { createClient } from '@/lib/supabase/client';
import { generateRoomCode } from '@/utils/roomCode';

/** How long to wait for presence to appear before deciding a room is empty. */
const PRESENCE_PROBE_TIMEOUT_MS = 3500;

/**
 * Creates a new room by minting a unique code. No I/O — the room becomes real
 * when the host connects to the channel and tracks presence on the room page.
 */
export async function createRoom(hostId: string): Promise<Room> {
  const code = generateRoomCode();
  return {
    id: `room:${code}`,
    code,
    createdAt: new Date().toISOString(),
    hostId,
    status: 'active',
  };
}

/**
 * Validates a room code by probing the channel's presence roster.
 *
 * Returns a Room if at least one participant is currently connected, otherwise
 * null (nobody home → treat as not found / expired). This is a temporary,
 * read-only channel subscription that is torn down before returning.
 */
export async function getRoomByCode(code: string): Promise<Room | null> {
  const supabase = createClient();
  const channel = supabase.channel(`room:${code}`, {
    // No presence key needed — this is a passive probe; we never track ourselves.
    config: { broadcast: { self: false } },
  });

  return new Promise<Room | null>((resolve) => {
    let settled = false;

    const finish = (result: Room | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
      resolve(result);
    };

    // If presence syncs and shows an existing member (a host or viewer already
    // in the room), the room is live.
    const checkPresence = () => {
      const state = channel.presenceState();
      const occupants = Object.values(state).flat();
      if (occupants.length > 0) {
        finish({
          id: `room:${code}`,
          code,
          createdAt: new Date().toISOString(),
          hostId: 'unknown', // real host id resolves from presence on the room page
          status: 'active',
        });
      }
    };

    channel.on('presence', { event: 'sync' }, checkPresence);
    channel.on('presence', { event: 'join' }, checkPresence);

    const timer = setTimeout(() => finish(null), PRESENCE_PROBE_TIMEOUT_MS);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // presenceState may already be populated on subscribe; check immediately.
        checkPresence();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        finish(null);
      }
    });
  });
}
