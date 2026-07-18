/**
 * Message protocol — the single source of truth for every envelope that crosses
 * a context boundary.
 *
 * Two transports:
 *   - window.postMessage  page ⇄ bridge content script (on the SyncFlix site)
 *   - chrome.runtime Port content scripts ⇄ background service worker
 *
 * The page-side mirror of this protocol lives in
 * website/src/services/extensionBridge.ts — keep the two in sync.
 */

// ─── Identity tags on window messages ────────────────────────────────────────
// Both sides listen on the same window, so each direction is tagged to avoid
// handling our own messages.

/** Messages sent BY the page (website) TO the extension. */
export const PAGE_SOURCE = 'syncflix-page';
/** Messages sent BY the extension TO the page. */
export const EXT_SOURCE = 'syncflix-ext';

export const PROTOCOL_VERSION = 1;

// ─── Sync events ─────────────────────────────────────────────────────────────
// Subset of the website's SyncEventType that the extension produces/consumes.
// Payload shapes match website/src/types/room.ts exactly.

export type SyncEventType = 'PLAY' | 'PAUSE' | 'SEEK' | 'POSITION_UPDATE' | 'PLAYBACK_SPEED';

export interface SyncEventEnvelope {
  event: SyncEventType;
  payload: Record<string, unknown>;
}

// ─── Extension state (reported up to the page) ──────────────────────────────

export interface ExtensionStatePayload {
  /** 'connected' = a platform adapter is attached to a video; 'waiting' = not yet. */
  status: 'connected' | 'waiting';
  platform: string | null;
  version: string;
  /** SyncFlix room tabs currently bridged. Diagnostic only — the popup shows it. */
  roomTabs: number;
  /** Player tabs the worker can route to. 0 means sync events have nowhere to go. */
  playerTabs: number;
  /** Identity of the video in the active player tab (null when none attached). */
  videoId: string | null;
  videoUrl: string | null;
  /** The room host's video URL, reported down by the page. Drives the popup's
   *  "Open video" link so a mismatched machine can jump to the right video. */
  hostVideoUrl: string | null;
}

// ─── window.postMessage envelopes ───────────────────────────────────────────

export interface WindowEnvelope {
  source: typeof PAGE_SOURCE | typeof EXT_SOURCE;
  v: number;
  type: 'EXTENSION_PING' | 'EXTENSION_HELLO' | 'EXTENSION_STATE' | 'SYNC_EVENT' | 'HOST_VIDEO';
  payload?: unknown;
}

// ─── Port messages (content scripts ⇄ service worker) ───────────────────────

export type PortMessage =
  | { type: 'GET_STATE' }
  | { type: 'EXTENSION_STATE'; payload: ExtensionStatePayload }
  | {
      type: 'ADAPTER_ATTACHED';
      payload: { platform: string; videoId: string | null; videoUrl: string | null };
    }
  | { type: 'ADAPTER_LOST' }
  | { type: 'SYNC_EVENT'; payload: SyncEventEnvelope }
  /** Page → worker: the room host's current video URL (for the popup link). */
  | { type: 'HOST_VIDEO'; payload: { url: string | null } };

/** Port names, so the service worker knows which kind of tab connected. */
export const BRIDGE_PORT = 'bridge';
export const PLAYER_PORT = 'player';
