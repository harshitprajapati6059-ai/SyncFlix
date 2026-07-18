/**
 * Extension bridge — the page side of the website ⇄ extension protocol.
 *
 * The extension's bridge content script listens on this same window. Messages
 * are tagged by direction: we send `syncflix-page`, the extension sends
 * `syncflix-ext`. The extension-side mirror of this protocol lives in
 * website/extension/src/messages.ts — keep the two in sync.
 *
 * Flow:
 *   - We post EXTENSION_PING until the extension answers EXTENSION_HELLO.
 *   - EXTENSION_STATE messages drive the ExtensionState shown in the room UI.
 *   - SYNC_EVENT messages carry playback events both ways:
 *       to the extension   → remote room events to apply to the video
 *       from the extension → local player actions to broadcast to the room
 */

import type { ExtensionState, SyncEventType } from '@/types/room';

const PAGE_SOURCE = 'syncflix-page';
const EXT_SOURCE = 'syncflix-ext';
const PROTOCOL_VERSION = 1;
const PING_INTERVAL_MS = 2000;

interface WindowEnvelope {
  source: string;
  v: number;
  type: 'EXTENSION_PING' | 'EXTENSION_HELLO' | 'EXTENSION_STATE' | 'SYNC_EVENT' | 'HOST_VIDEO';
  payload?: unknown;
}

function post(type: WindowEnvelope['type'], payload?: unknown): void {
  if (typeof window === 'undefined') return;
  const envelope: WindowEnvelope = { source: PAGE_SOURCE, v: PROTOCOL_VERSION, type, payload };
  window.postMessage(envelope, window.location.origin);
}

/** Forward a remote room event to the extension so it's applied to the video. */
export function sendSyncEventToExtension(
  event: SyncEventType,
  payload: Record<string, unknown>
): void {
  post('SYNC_EVENT', { event, payload });
}

/** Report the room host's video URL so the popup can offer an "Open video" link. */
export function sendHostVideoToExtension(url: string | null): void {
  post('HOST_VIDEO', { url });
}

export interface ExtensionBridgeHandlers {
  /** Extension status changed (installed / video attached / lost). */
  onStateChange: (state: ExtensionState) => void;
  /** A local player action (or position report) arrived from the video tab. */
  onPlayerEvent: (event: SyncEventType, payload: Record<string, unknown>) => void;
}

/**
 * Start listening for the extension and ping until it answers.
 * Returns a cleanup function.
 */
export function connectExtensionBridge(handlers: ExtensionBridgeHandlers): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let helloReceived = false;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as WindowEnvelope | undefined;
    if (!data || data.source !== EXT_SOURCE) return;

    if (data.type === 'EXTENSION_HELLO') {
      helloReceived = true;
      const { version } = (data.payload ?? {}) as { version?: string };
      handlers.onStateChange({
        status: 'waiting',
        platform: null,
        version: version ?? null,
        videoId: null,
        videoUrl: null,
      });
    } else if (data.type === 'EXTENSION_STATE') {
      const state = (data.payload ?? {}) as {
        status?: 'connected' | 'waiting';
        platform?: string | null;
        version?: string;
        videoId?: string | null;
        videoUrl?: string | null;
      };
      handlers.onStateChange({
        status: state.status ?? 'waiting',
        platform: state.platform ?? null,
        version: state.version || null,
        videoId: state.videoId ?? null,
        videoUrl: state.videoUrl ?? null,
      });
    } else if (data.type === 'SYNC_EVENT') {
      const { event: syncEvent, payload } = (data.payload ?? {}) as {
        event?: SyncEventType;
        payload?: Record<string, unknown>;
      };
      if (syncEvent) handlers.onPlayerEvent(syncEvent, payload ?? {});
    }
  };

  window.addEventListener('message', onMessage);

  post('EXTENSION_PING');
  const pingTimer = window.setInterval(() => {
    if (helloReceived) {
      window.clearInterval(pingTimer);
      return;
    }
    post('EXTENSION_PING');
  }, PING_INTERVAL_MS);

  return () => {
    window.removeEventListener('message', onMessage);
    window.clearInterval(pingTimer);
  };
}
