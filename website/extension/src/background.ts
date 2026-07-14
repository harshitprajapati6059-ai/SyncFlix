/**
 * Background service worker — a stateless message router.
 *
 * Routes:
 *   bridge tab (SyncFlix site)  → SYNC_EVENT → active player tab
 *   player tab (YouTube)        → SYNC_EVENT → every bridge tab
 *   player attach/detach        → EXTENSION_STATE → every bridge tab + popup
 *
 * All registries are in-memory. MV3 may suspend this worker at any time; when
 * it revives, content scripts reconnect their ports (they retry on disconnect)
 * and re-announce their state, so the registry rebuilds itself losslessly.
 */

import {
  BRIDGE_PORT,
  PLAYER_PORT,
  type ExtensionStatePayload,
  type PortMessage,
} from './messages';

const bridgePorts = new Map<number, chrome.runtime.Port>(); // tabId → port
const playerPorts = new Map<number, { port: chrome.runtime.Port; platform: string | null }>();
let activePlayerTab: number | null = null;

function currentState(): ExtensionStatePayload {
  const active = activePlayerTab !== null ? playerPorts.get(activePlayerTab) : undefined;
  return {
    status: active?.platform ? 'connected' : 'waiting',
    platform: active?.platform ?? null,
    version: chrome.runtime.getManifest().version,
  };
}

function broadcastStateToBridges(): void {
  const msg: PortMessage = { type: 'EXTENSION_STATE', payload: currentState() };
  bridgePorts.forEach((port) => port.postMessage(msg));
}

/** Most recently attached player wins; fall back to any other attached tab. */
function pickAttachedPlayerTab(): number | null {
  for (const [tabId, entry] of playerPorts) {
    if (entry.platform) return tabId;
  }
  return null;
}

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;

  if (port.name === BRIDGE_PORT) {
    bridgePorts.set(tabId, port);

    port.onMessage.addListener((msg: PortMessage) => {
      if (msg.type === 'GET_STATE') {
        port.postMessage({ type: 'EXTENSION_STATE', payload: currentState() } satisfies PortMessage);
      } else if (msg.type === 'SYNC_EVENT') {
        const target = activePlayerTab !== null ? playerPorts.get(activePlayerTab) : undefined;
        target?.port.postMessage(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      bridgePorts.delete(tabId);
    });
    return;
  }

  if (port.name === PLAYER_PORT) {
    playerPorts.set(tabId, { port, platform: null });

    port.onMessage.addListener((msg: PortMessage) => {
      const entry = playerPorts.get(tabId);
      if (!entry) return;

      if (msg.type === 'ADAPTER_ATTACHED') {
        entry.platform = msg.payload.platform;
        activePlayerTab = tabId; // most recent attach wins
        broadcastStateToBridges();
      } else if (msg.type === 'ADAPTER_LOST') {
        entry.platform = null;
        if (activePlayerTab === tabId) activePlayerTab = pickAttachedPlayerTab();
        broadcastStateToBridges();
      } else if (msg.type === 'SYNC_EVENT') {
        if (tabId !== activePlayerTab) return; // ignore non-active video tabs
        bridgePorts.forEach((bridge) => bridge.postMessage(msg));
      }
    });

    port.onDisconnect.addListener(() => {
      playerPorts.delete(tabId);
      if (activePlayerTab === tabId) {
        activePlayerTab = pickAttachedPlayerTab();
        broadcastStateToBridges();
      }
    });
  }
});

// The popup asks for state with a one-shot message (it has no long-lived port).
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'GET_STATE') {
    sendResponse(currentState());
  }
});
