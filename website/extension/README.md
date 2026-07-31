# SyncFlix Extension

Chrome (MV3) extension that syncs video playback with a SyncFlix room.
The website owns the room and Supabase Realtime; this extension only bridges
the room page and the video tab, and controls the `<video>` element.

## Build

```bash
npm install
npm run build     # one-shot → dist/
npm run watch     # rebuild on change
```

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder's `dist/` directory

## Test end-to-end

1. Run the website (`npm run dev` in `website/`) and create a room.
   The Extension panel should switch from *waiting* to *connected* once a
   video tab is open on a supported platform.
2. Open the same video in a second browser/profile, join the room
   as a viewer (extension installed there too).
3. Play/pause/seek on either side — the other side follows. The host's
   position heartbeat corrects viewer drift automatically.

After editing extension code: rebuild, then click the reload icon on the
extension card in `chrome://extensions`, and reload the SyncFlix + video tabs.

## Layout

- `src/messages.ts` — message protocol (mirrored by `../src/services/extensionBridge.ts`)
- `src/background.ts` — service worker: routes messages between tabs
- `src/bridge.ts` — content script on the SyncFlix site (page ⇄ worker relay)
- `src/player.ts` — content script on the video site: sync engine (echo suppression, drift correction)
- `src/adapters/` — one `PlatformAdapter` per streaming platform (YouTube, Netflix, Prime Video)
- `src/netflix-page.ts` — MAIN-world script on Netflix: drives playback via Netflix's player API
  (driving the element directly stalls its player, or gets reverted by it)
- `src/popup.ts` + `public/popup.html` — read-only status popup

## Adding a platform

1. Add `src/adapters/<name>.ts` exporting a `PlatformAdapter` — `matches()` claims
   the hostname, `findVideo()` returns the player's element (never a trailer's).
2. Register it in the `ADAPTERS` list in `src/player.ts`.
3. Add the host match patterns to `manifest.json`.

Optional hooks cover platform misbehaviour: `seek`/`play`/`pause` when the element
can't be driven directly, `canNudgeRate: false` when `playbackRate` is ignored, and
`isAdPlaying()` when ads share the element (sync goes quiet for the break).
