# SyncFlix Browser Extension — Plan

## Goal

A Chrome (MV3) extension that controls video playback on streaming sites, driven by
sync events from the SyncFlix website. Version 1 targets YouTube only.

## Architecture

Per PROJECT_RULES: the **website owns rooms and realtime communication** (Supabase
Realtime); the **extension owns playback control**. The extension never talks to
Supabase directly — it bridges the website tab and the video tab.

```
┌─────────────────────┐        ┌──────────────────────┐
│  SyncFlix room page  │        │     YouTube tab       │
│  (Next.js, Supabase) │        │                       │
│         ▲            │        │  ┌─────────────────┐  │
│  window.postMessage  │        │  │ player content   │  │
│         ▼            │        │  │ script + adapter │  │
│  ┌────────────────┐  │        │  └───────▲─────────┘  │
│  │ bridge content  │  │        │          │            │
│  │ script          │  │        │          │            │
│  └───────▲────────┘  │        └──────────┼────────────┘
└──────────┼───────────┘                   │
           │        chrome.runtime ports    │
           └──────────►┌───────────────┐◄──┘
                       │ background     │
                       │ service worker │
                       └───────────────┘
```

Why this shape (vs. the extension joining Supabase itself):
- Supabase credentials and room logic stay in one place (the website).
- The website UI is already the source of truth for room/presence/chat state.
- The extension stays tiny and platform-focused, matching the project rules.

## Components

### 1. `website/extension/` package
- TypeScript, Manifest V3, bundled with esbuild (one entry per script, `build.mjs`).
- No runtime dependencies if possible — keep it free and auditable.
- Targets Chrome/Edge/Brave first; Firefox later (MV3 support differs).

### 2. Manifest
- `content_scripts`:
  - bridge script on the SyncFlix site (`http://localhost:3000/*` + Netlify URL)
  - player script on `*://*.youtube.com/*`
- `permissions`: `storage` (settings), `tabs` (find/track the video tab).
- `background.service_worker`.

### 3. Website bridge content script
- Runs on the room page; talks to the page via `window.postMessage` with a
  versioned, origin-checked message envelope (`{ source: 'syncflix', v: 1, type, payload }`).
- Handshake: page sends `EXTENSION_PING`, bridge replies `EXTENSION_HELLO`
  with `{ version, platform }` → populates the existing `ExtensionState` type.
- Relays sync events both directions between the page and the service worker.

### 4. Background service worker
- Routes messages between the website tab and the video tab.
- Tracks which tab is the active video tab (first YouTube tab with a playing adapter;
  re-detect on navigation/close).
- Holds no room state beyond routing — stateless enough to survive MV3 worker
  suspension (persist the tab mapping in `chrome.storage.session`).

### 5. Player content script + adapter interface
One adapter per platform (project rule). V1 ships YouTube only.

```ts
interface PlayerAdapter {
  platform: string; // "YouTube"
  attach(): Promise<void>;                    // find the <video>, wire listeners
  getState(): { currentTime: number; paused: boolean; rate: number };
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  onLocalEvent(cb: (e: LocalPlayerEvent) => void): void; // user-initiated play/pause/seek/rate
}
```

YouTube adapter: `document.querySelector('video.html5-main-video')`, handle SPA
navigation (`yt-navigate-finish`) and the video element being replaced.

### 6. Sync engine (in the player content script)
- **Outgoing**: local user actions → `PLAY` / `PAUSE` / `SEEK` / `PLAYBACK_SPEED`
  events (payload shapes already defined in `website/src/types/room.ts`).
- **Echo suppression**: mark programmatic actions so the resulting DOM events are
  not re-broadcast (a short-lived "applying remote event" flag / expected-state check).
  This is the #1 source of feedback loops — build it in from day one.
- **Drift correction** (viewers, against host `POSITION_UPDATE`/`HEARTBEAT`):
  - drift < 0.5 s → do nothing
  - 0.5–3 s → nudge `playbackRate` briefly to converge smoothly
  - > 3 s → hard seek
- **Host authority**: host emits `POSITION_UPDATE` on an interval; viewers only correct.

### 7. Popup UI
Minimal (project rule): extension status, detected platform, connected room code.
No controls — the website is the control surface.

## Website changes required
- `RoomContext`: wire the postMessage bridge — forward inbound Supabase sync events
  to the extension, broadcast extension-reported local events to the channel.
- Extension detection (ping/hello) to drive the existing `ExtensionState` UI.

## Message protocol
Reuse `SyncEventType` from `room.ts` verbatim for sync events. Add extension-only
control messages: `EXTENSION_PING`, `EXTENSION_HELLO`, `EXTENSION_STATE`,
`ADAPTER_ATTACHED`, `ADAPTER_LOST`. Share the types via a small `shared/` module
or duplicate the `.d.ts` in the extension (decide at milestone 1).

## Detailed flows — how it works at runtime

### Contexts and transport
Three JavaScript contexts, two transports:

| From | To | Transport |
|---|---|---|
| Room page (Next.js) | Bridge content script | `window.postMessage` (origin-checked) |
| Bridge / player content scripts | Service worker | `chrome.runtime.connect()` long-lived Ports |

Content scripts live in an isolated world — the page can't call them directly, hence
postMessage. Every message uses one envelope:

```ts
{ source: 'syncflix-ext', v: 1, type: string, payload: object }
```

### Flow 1 — Discovery handshake
1. Room page mounts → a `useExtensionBridge` hook posts `EXTENSION_PING` every 2 s.
2. If the extension is installed, the bridge content script answers `EXTENSION_HELLO { version }`
   and opens a Port to the service worker, registering this tab as **the website tab**.
3. The service worker replies with current adapter status; the bridge forwards
   `EXTENSION_STATE { status, platform }` to the page → `ExtensionState` flips to `connected`.
4. No answer after N pings → UI stays `waiting` (extension not installed).

### Flow 2 — Video tab attach
1. Player content script loads on any YouTube page; on `yt-navigate-finish` (SPA nav)
   it looks for `video.html5-main-video`.
2. Found → adapter attaches DOM listeners (`play`, `pause`, `seeked`, `ratechange`,
   `timeupdate`) and sends `ADAPTER_ATTACHED { platform: 'YouTube' }` over its Port.
3. Service worker records `{ websiteTabId, playerTabId }` in `chrome.storage.session`
   (survives MV3 worker suspension) and notifies the website tab.
4. Tab closed / navigated away → Port disconnects → `ADAPTER_LOST` → UI back to `waiting`.
   Multiple YouTube tabs: most recently attached wins.

### Flow 3 — Local action broadcast (e.g. host presses play on YouTube)
```
video 'play' event → adapter
  → suppression check: was this action expected (remote-applied)? if yes, swallow
  → PLAY { currentTime, platform } over Port → service worker
  → routed to website tab → bridge → postMessage → page
  → RoomContext.broadcastEvent('PLAY', payload)   ← already exists
  → Supabase broadcast → everyone in the room
```

### Flow 4 — Remote event applied (viewer side)
```
Supabase → RoomContext PLAY handler (already exists)
  → forward to bridge via postMessage → service worker → player tab
  → sync engine: register expected state { action: 'play', time, expires: +500ms }
  → video.currentTime = t (if off by > tolerance); video.play()
  → resulting DOM 'play'/'seeking' events match the expected entry → consumed,
    NOT re-broadcast (this is the echo-suppression core)
```
Suppression is expected-state matching, not just a boolean flag — a bare
"applying" flag misses overlapping events and re-broadcasts on slow devices.

### Flow 5 — Heartbeat and drift correction
- **Host**: adapter sends `POSITION_UPDATE { currentTime, playing }` up to the page
  every ~1 s; this replaces the fake local ticker in RoomContext with real player time.
  The existing 2 s host heartbeat then broadcasts real positions.
- **Viewer**: RoomContext receives the heartbeat and forwards it to the extension.
  The sync engine computes `drift = localTime - hostTime` and corrects:

| |drift| | action |
|---|---|
| < 0.5 s | nothing (tolerated) |
| 0.5 – 3 s | nudge `playbackRate` (±5 %) until converged, then restore |
| > 3 s | hard `video.currentTime = hostTime` |

  The viewer's adapter also reports its real position up to the page so the
  existing drift/`SyncState` UI shows true numbers.

### Flow 6 — MV3 service-worker suspension
Chrome kills idle service workers (~30 s). Handling:
- Tab registry lives in `chrome.storage.session`, not worker memory.
- Any incoming Port message revives the worker; content scripts reconnect
  their Ports on `onDisconnect`.
- The worker holds no sync state — it is a pure router, so revival is lossless.

### Website changes (concrete)
- `useExtensionBridge()` hook: ping/hello, postMessage listener, forwards
  inbound sync events to the extension and extension events to `broadcastEvent`.
- `ExtensionState` becomes stateful (currently a static `useState` initial value).
- The local playback ticker in RoomContext is disabled while the extension is
  connected (real player time drives the clock instead).

## Milestones
1. **Scaffold** — `website/extension/` with esbuild + TS + MV3 manifest; loads unpacked, logs from all three contexts.
2. **Handshake** — website shows "Extension connected" via ping/hello bridge.
3. **YouTube adapter** — read state and control the video locally from the popup/console.
4. **End-to-end sync** — two browsers, one room: play/pause/seek propagates
   host → Supabase → viewer → video, using the existing event payloads.
5. **Robustness** — echo suppression hardening, drift correction, SPA navigation,
   tab close/reload recovery, MV3 worker suspension.
6. **Ship** — unpacked-install instructions in `docs/`; Chrome Web Store later if wanted
   (one-time $5 fee — otherwise stays free).

## Out of scope for v1
Netflix/Prime/Disney+/Crunchyroll/JioHotstar adapters, Firefox build, auto-navigation
to the same video URL (host can paste the link in chat), storing any streaming content.
