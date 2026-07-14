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
   YouTube video tab is open.
2. Open the same YouTube video in a second browser/profile, join the room
   as a viewer (extension installed there too).
3. Play/pause/seek on either side — the other side follows. The host's
   position heartbeat corrects viewer drift automatically.

After editing extension code: rebuild, then click the reload icon on the
extension card in `chrome://extensions`, and reload the SyncFlix + YouTube tabs.

## Layout

- `src/messages.ts` — message protocol (mirrored by `../src/services/extensionBridge.ts`)
- `src/background.ts` — service worker: routes messages between tabs
- `src/bridge.ts` — content script on the SyncFlix site (page ⇄ worker relay)
- `src/player.ts` — content script on YouTube: sync engine (echo suppression, drift correction)
- `src/adapters/` — one `PlatformAdapter` per streaming platform (v1: YouTube)
- `src/popup.ts` + `public/popup.html` — read-only status popup
