/**
 * Bridge content script — runs on the SyncFlix website.
 *
 * Relays messages between the room page (via window.postMessage) and the
 * background service worker (via a long-lived Port):
 *
 *   page EXTENSION_PING  → reply EXTENSION_HELLO, forward GET_STATE to worker
 *   page SYNC_EVENT      → worker (routed to the active video tab)
 *   worker SYNC_EVENT    → page (local player actions from the video tab)
 *   worker EXTENSION_STATE → page (drives the ExtensionState UI)
 */

import {
  BRIDGE_PORT,
  EXT_SOURCE,
  PAGE_SOURCE,
  PROTOCOL_VERSION,
  type PortMessage,
  type WindowEnvelope,
} from './messages';

const RECONNECT_DELAY_MS = 1000;

let port: chrome.runtime.Port | null = null;

function postToPage(type: WindowEnvelope['type'], payload?: unknown): void {
  const envelope: WindowEnvelope = { source: EXT_SOURCE, v: PROTOCOL_VERSION, type, payload };
  window.postMessage(envelope, window.location.origin);
}

function connect(): void {
  try {
    port = chrome.runtime.connect({ name: BRIDGE_PORT });
  } catch {
    // Extension was reloaded/updated and this content script is orphaned.
    port = null;
    return;
  }

  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'EXTENSION_STATE') {
      postToPage('EXTENSION_STATE', msg.payload);
    } else if (msg.type === 'SYNC_EVENT') {
      postToPage('SYNC_EVENT', msg.payload);
    }
  });

  port.onDisconnect.addListener(() => {
    // Worker suspended or extension reloaded — tell the page we're degraded,
    // then keep retrying (a revived worker accepts the reconnect immediately).
    port = null;
    postToPage('EXTENSION_STATE', { status: 'waiting', platform: null, version: '' });
    window.setTimeout(connect, RECONNECT_DELAY_MS);
  });

  port.postMessage({ type: 'GET_STATE' } satisfies PortMessage);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as WindowEnvelope | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;

  if (data.type === 'EXTENSION_PING') {
    postToPage('EXTENSION_HELLO', { version: chrome.runtime.getManifest().version });
    if (port) {
      port.postMessage({ type: 'GET_STATE' } satisfies PortMessage);
    } else {
      connect();
    }
  } else if (data.type === 'SYNC_EVENT') {
    port?.postMessage({ type: 'SYNC_EVENT', payload: data.payload } as PortMessage);
  }
});

connect();
