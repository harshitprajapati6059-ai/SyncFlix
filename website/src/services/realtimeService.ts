/**
 * Realtime service — Supabase Realtime channel management.
 * BACKEND: Replace mock implementations with actual Supabase Realtime channels.
 *
 * Supabase Realtime integration points:
 * - Presence: supabase.channel(roomCode).on('presence', ...).subscribe()
 * - Broadcast: supabase.channel(roomCode).on('broadcast', { event: 'PLAY' }, handler)
 * - Send: channel.send({ type: 'broadcast', event: 'PLAY', payload: {...} })
 */

import type { SyncEventType, PresenceUser } from '@/types/room';

export type EventHandler = (
  payload: Record<string, unknown>,
  userId: string,
  username: string
) => void;
export type PresenceHandler = (users: PresenceUser[]) => void;

export interface RealtimeChannel {
  subscribe: (event: SyncEventType, handler: EventHandler) => void;
  broadcast: (event: SyncEventType, payload: Record<string, unknown>) => void;
  updatePresence: (state: Partial<PresenceUser>) => void;
  onPresenceChange: (handler: PresenceHandler) => void;
  disconnect: () => void;
}

/**
 * Creates a mock realtime channel for a given room code.
 * BACKEND: Replace with:
 *   const channel = supabase.channel(`room:${roomCode}`, { config: { presence: { key: userId } } })
 */
export function createRealtimeChannel(roomCode: string, userId: string): RealtimeChannel {
  // BACKEND: Initialize Supabase channel here
  const handlers = new Map<SyncEventType, EventHandler[]>();
  let presenceHandler: PresenceHandler | null = null;

  console.log(`[realtimeService] Mock channel created for room ${roomCode}, user ${userId}`);

  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },

    broadcast(event, payload) {
      // BACKEND: await channel.send({ type: 'broadcast', event, payload })
      console.log(`[realtimeService] Broadcast ${event}`, payload);
      // In mock mode, echo back to self after a short delay
      setTimeout(() => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.forEach((h) => h(payload, userId, 'self'));
      }, 50);
    },

    updatePresence(state) {
      // BACKEND: await channel.track(state)
      console.log(`[realtimeService] Presence update`, state);
    },

    onPresenceChange(handler) {
      presenceHandler = handler;
      // BACKEND: channel.on('presence', { event: 'sync' }, () => { handler(channel.presenceState()) })
    },

    disconnect() {
      // BACKEND: await supabase.removeChannel(channel)
      handlers.clear();
      presenceHandler = null;
      console.log(`[realtimeService] Channel disconnected for room ${roomCode}`);
    },
  };
}

/**
 * Extension API interface — the browser extension communicates via these methods.
 * BACKEND: Implement as postMessage bridge between extension content script and page.
 */
export interface ExtensionAPI {
  onPlaybackEvent: (
    handler: (event: { type: SyncEventType; payload: Record<string, unknown> }) => void
  ) => void;
  onPlatformChange: (handler: (platform: string) => void) => void;
  broadcastToExtension: (event: SyncEventType, payload: Record<string, unknown>) => void;
  getStatus: () => 'connected' | 'disconnected' | 'waiting';
}

/**
 * Creates the extension API bridge.
 * BACKEND: Replace with window.addEventListener('message', ...) for extension postMessage.
 */
export function createExtensionAPI(): ExtensionAPI {
  // BACKEND: Listen for messages from the browser extension content script
  // window.addEventListener('message', (event) => { if (event.source !== window) return; ... })

  return {
    onPlaybackEvent(handler) {
      // BACKEND: Register handler for extension → page playback events
      console.log('[extensionAPI] Registered playback event handler');
    },
    onPlatformChange(handler) {
      // BACKEND: Register handler for platform change events from extension
      console.log('[extensionAPI] Registered platform change handler');
    },
    broadcastToExtension(event, payload) {
      // BACKEND: window.postMessage({ source: 'syncflix-web', type: event, payload }, '*')
      console.log(`[extensionAPI] Broadcast to extension: ${event}`, payload);
    },
    getStatus() {
      // BACKEND: Check if extension responded to handshake ping
      return 'waiting';
    },
  };
}
