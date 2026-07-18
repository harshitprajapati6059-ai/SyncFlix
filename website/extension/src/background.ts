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

interface PlayerEntry {
  port: chrome.runtime.Port;
  platform: string | null;
  videoId: string | null;
  videoUrl: string | null;
}

const bridgePorts = new Map<number, chrome.runtime.Port>(); // tabId → port
const playerPorts = new Map<number, PlayerEntry>();
let activePlayerTab: number | null = null;
// The room host's video URL, reported down by a bridge tab. In-memory like the
// rest — the page re-sends it on every extension-state change, so a revived
// worker re-learns it within one state round-trip.
let hostVideoUrl: string | null = null;

function currentState(): ExtensionStatePayload {
  const active = activePlayerTab !== null ? playerPorts.get(activePlayerTab) : undefined;
  return {
    status: active?.platform ? 'connected' : 'waiting',
    platform: active?.platform ?? null,
    version: chrome.runtime.getManifest().version,
    roomTabs: bridgePorts.size,
    playerTabs: playerPorts.size,
    videoId: active?.videoId ?? null,
    videoUrl: active?.videoUrl ?? null,
    hostVideoUrl,
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
        if (!target) {
          // No attached video tab — the event has nowhere to go. This used to be
          // a silent drop, which is indistinguishable from "sync is broken" when
          // debugging a second machine. Tell the page so the UI can say so.
          console.warn('[SyncFlix] dropped %s: no attached player tab', msg.payload.event);
          port.postMessage({ type: 'EXTENSION_STATE', payload: currentState() } satisfies PortMessage);
          return;
        }
        target.port.postMessage(msg);
      } else if (msg.type === 'HOST_VIDEO') {
        if (hostVideoUrl !== msg.payload.url) {
          hostVideoUrl = msg.payload.url;
          broadcastStateToBridges();
        }
      }
    });

    port.onDisconnect.addListener(() => {
      bridgePorts.delete(tabId);
    });
    return;
  }

  if (port.name === PLAYER_PORT) {
    playerPorts.set(tabId, { port, platform: null, videoId: null, videoUrl: null });

    port.onMessage.addListener((msg: PortMessage) => {
      const entry = playerPorts.get(tabId);
      if (!entry) return;

      if (msg.type === 'ADAPTER_ATTACHED') {
        entry.platform = msg.payload.platform;
        entry.videoId = msg.payload.videoId;
        entry.videoUrl = msg.payload.videoUrl;
        activePlayerTab = tabId; // most recent attach wins
        broadcastStateToBridges();
      } else if (msg.type === 'ADAPTER_LOST') {
        entry.platform = null;
        entry.videoId = null;
        entry.videoUrl = null;
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
