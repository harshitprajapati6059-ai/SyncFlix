/**
 * Room service — handles room creation, joining, and validation.
 * BACKEND: All functions here should call Supabase REST API or RPC functions.
 * Replace mock implementations with actual Supabase client calls.
 */

import type { Room } from '@/types/room';
import { generateRoomCode } from '@/utils/roomCode';

/**
 * Creates a new room with a generated code.
 * BACKEND: INSERT into rooms table via Supabase client.
 */
export async function createRoom(hostId: string): Promise<Room> {
  // BACKEND: const { data, error } = await supabase.from('rooms').insert({ code, host_id: hostId }).select().single();
  await new Promise((resolve) => setTimeout(resolve, 600)); // simulate network

  const code = generateRoomCode();
  return {
    id: `room-${Date.now()}`,
    code,
    createdAt: new Date().toISOString(),
    hostId,
    status: 'active',
  };
}

/**
 * Validates and retrieves a room by code.
 * Returns null if the room does not exist or is expired.
 * BACKEND: SELECT from rooms table where code = roomCode and status = 'active'.
 */
export async function getRoomByCode(code: string): Promise<Room | null> {
  // BACKEND: const { data } = await supabase.from('rooms').select('*').eq('code', code).eq('status', 'active').single();
  await new Promise((resolve) => setTimeout(resolve, 800)); // simulate network

  // Simulate: codes ending in "X" are "expired" for demo purposes
  if (code.endsWith('X')) return null;

  return {
    id: `room-mock-${code}`,
    code,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    hostId: 'user-remote-host',
    status: 'active',
  };
}

/**
 * Marks a room as empty/expired when all users leave.
 * BACKEND: UPDATE rooms SET status = 'expired' WHERE id = roomId.
 */
export async function expireRoom(roomId: string): Promise<void> {
  // BACKEND: await supabase.from('rooms').update({ status: 'expired' }).eq('id', roomId);
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log(`[roomService] Room ${roomId} marked as expired`);
}
