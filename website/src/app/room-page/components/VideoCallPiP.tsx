'use client';

/**
 * Picture-in-picture for the video call, in two flavours because no single API
 * covers both kinds of device.
 *
 * Desktop uses the Document Picture-in-Picture API (Chrome/Edge 116+), which is
 * the only way to float an interactive surface — multiple tiles, controls, chat
 * — instead of one raw video frame. The PiP window shares this page's JS
 * context, so a React portal into it keeps full access to RoomContext.
 *
 * No mobile browser implements that. Phones instead get the classic
 * single-<video> PiP (`requestPictureInPicture`, or `webkitSetPresentationMode`
 * on iOS), which floats one video over the home screen and other apps. Since it
 * can only carry one frame, it shows the pinned participant — the person you
 * said you cared about — falling back to whoever else has their camera on.
 *
 * Mounted once at the room level (see RoomPageContent.tsx) so it stays alive
 * — and can auto-trigger on tab-hide — no matter which sidebar tab is open.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoom } from '@/context/RoomContext';
import { VideoTileGrid, CallControls } from './VideoCallTiles';
import ChatPanel from './ChatPanel';

interface PiPContextValue {
  isSupported: boolean;
  isActive: boolean;
  toggle: () => void;
}

const PiPContext = createContext<PiPContextValue>({
  isSupported: false,
  isActive: false,
  toggle: () => {},
});

export const usePiP = () => useContext(PiPContext);

const PIP_WINDOW_WIDTH = 380;
const PIP_WINDOW_HEIGHT = 560;

/** iOS exposes element PiP under a prefix and never implemented the standard one. */
interface WebkitVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void;
  webkitPresentationMode?: string;
}

/** True where a single <video> can be floated out of the page. */
function elementPipSupported(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.pictureInPictureEnabled) return true;
  const probe = document.createElement('video') as WebkitVideoElement;
  return typeof probe.webkitSupportsPresentationMode === 'function';
}

/** Copies the app's stylesheets (and theme/font classes) into the PiP document — it starts blank. */
function hydratePipDocument(pipDoc: Document) {
  pipDoc.title = 'SyncFlix — Call';
  pipDoc.documentElement.className = document.documentElement.className;
  pipDoc.body.className = `${document.body.className} bg-background`;

  Array.from(document.styleSheets).forEach((styleSheet) => {
    try {
      const cssText = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = pipDoc.createElement('style');
      style.textContent = cssText;
      pipDoc.head.appendChild(style);
    } catch {
      // Cross-origin stylesheet (e.g. a font host) — .cssRules throws; link it instead.
      if (styleSheet.href) {
        const link = pipDoc.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleSheet.href;
        pipDoc.head.appendChild(link);
      }
    }
  });
}

export default function VideoCallPiP({ children }: { children: React.ReactNode }) {
  const { videoCallState, users, currentUser, remoteStreams, pinnedUserId } = useRoom();
  const [docPipSupported, setDocPipSupported] = useState(false);
  const [elemPipSupported, setElemPipSupported] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [elemPipActive, setElemPipActive] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  const elemVideoRef = useRef<HTMLVideoElement>(null);

  // Client-only checks, deferred to an effect so SSR/hydration render the same
  // "unsupported" state before this resolves — evaluating it during render
  // would mismatch between server and browser.
  useEffect(() => {
    const hasDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
    setDocPipSupported(hasDocPip);
    // Only offered where the richer surface isn't, so one button never has two
    // different meanings on the same machine.
    setElemPipSupported(!hasDocPip && elementPipSupported());
  }, []);

  // Which single stream the phone's floating window shows: the pinned person if
  // there is one, else the first participant actually sending video.
  const elemPipUser =
    users.find((u) => u.inCall && u.userId === pinnedUserId && u.userId !== currentUser?.userId) ??
    users.find(
      (u) =>
        u.inCall &&
        u.userId !== currentUser?.userId &&
        (u.cameraOn || u.screenSharing) &&
        remoteStreams[u.userId]
    ) ??
    users.find((u) => u.inCall && u.userId !== currentUser?.userId && remoteStreams[u.userId]);
  const elemPipStream = elemPipUser ? (remoteStreams[elemPipUser.userId] ?? null) : null;

  useEffect(() => {
    const el = elemVideoRef.current;
    if (!el || el.srcObject === elemPipStream) return;
    el.srcObject = elemPipStream;
    if (elemPipStream) void el.play().catch(() => {});
  }, [elemPipStream]);

  const exitElementPip = useCallback(() => {
    const el = elemVideoRef.current as WebkitVideoElement | null;
    if (!el) return;
    if (document.pictureInPictureElement === el)
      void document.exitPictureInPicture().catch(() => {});
    else el.webkitSetPresentationMode?.('inline');
  }, []);

  const enterElementPip = useCallback(async () => {
    const el = elemVideoRef.current as WebkitVideoElement | null;
    if (!el || !el.srcObject) return;
    try {
      // PiP is refused on a paused element, and a stream assigned from script
      // doesn't reliably autoplay — so make sure it's running first.
      await el.play().catch(() => {});
      if (typeof el.requestPictureInPicture === 'function') await el.requestPictureInPicture();
      else el.webkitSetPresentationMode?.('picture-in-picture');
    } catch (err) {
      // Usually "requires a user gesture" on the auto-trigger path; the button
      // still works.
      console.warn('[SyncFlix] Picture-in-picture unavailable:', err);
    }
  }, []);

  // The floating window can be dismissed from OS chrome we don't own, so the
  // element's own events — not our click handler — are the source of truth.
  useEffect(() => {
    const el = elemVideoRef.current;
    if (!el) return;
    const onEnter = () => setElemPipActive(true);
    const onLeave = () => setElemPipActive(false);
    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('leavepictureinpicture', onLeave);
    const onWebkitChange = () => {
      const mode = (el as WebkitVideoElement).webkitPresentationMode;
      setElemPipActive(mode === 'picture-in-picture');
    };
    el.addEventListener('webkitpresentationmodechanged', onWebkitChange);
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('leavepictureinpicture', onLeave);
      el.removeEventListener('webkitpresentationmodechanged', onWebkitChange);
    };
  }, []);

  const exit = useCallback(() => {
    if (elemPipSupported) exitElementPip();
    else pipWindowRef.current?.close();
  }, [elemPipSupported, exitElementPip]);

  const enter = useCallback(async () => {
    if (elemPipSupported) {
      await enterElementPip();
      return;
    }
    if (pipWindowRef.current || !window.documentPictureInPicture) return;
    try {
      const pip = await window.documentPictureInPicture.requestWindow({
        width: PIP_WINDOW_WIDTH,
        height: PIP_WINDOW_HEIGHT,
      });
      hydratePipDocument(pip.document);
      pip.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipWindow(null);
      });
      pipWindowRef.current = pip;
      setPipWindow(pip);
    } catch (err) {
      // Most likely: no active user gesture and the browser declined the
      // auto-trigger path. The manual button remains the reliable fallback.
      console.warn('[SyncFlix] Picture-in-picture unavailable:', err);
    }
  }, [elemPipSupported, enterElementPip]);

  const isActive = elemPipSupported ? elemPipActive : pipWindow !== null;

  const toggle = useCallback(() => {
    if (isActive) exit();
    else void enter();
  }, [isActive, enter, exit]);

  // Auto-enter once the tab is hidden mid-call (switched tabs, minimized,
  // app-switched on mobile/desktop) — mirrors Google Meet. Auto-exit on
  // return, since the floating window's job is done once you're looking at
  // the tab again.
  const isSupported = docPipSupported || elemPipSupported;

  useEffect(() => {
    if (!isSupported) return;
    const handleVisibility = () => {
      if (document.hidden) {
        if (videoCallState.inCall && !isActive) void enter();
      } else if (isActive) {
        exit();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isSupported, isActive, videoCallState.inCall, enter, exit]);

  // The call ended (e.g. the other side hung up while we were tabbed away) —
  // don't leave an empty floating window behind.
  useEffect(() => {
    if (!videoCallState.inCall && isActive) exit();
  }, [videoCallState.inCall, isActive, exit]);

  // Leaving the room entirely: close the floating window with it.
  useEffect(() => () => pipWindowRef.current?.close(), []);

  const value: PiPContextValue = { isSupported, isActive, toggle };

  return (
    <PiPContext.Provider value={value}>
      {children}
      {/* The element the phone floats. Kept mounted at room level so it
          survives tab switches, and parked off-screen rather than hidden —
          `display:none` would make PiP refuse it. Muted on purpose: the call
          tiles are still playing this same stream's audio, and a second
          playback would double every voice. */}
      {elemPipSupported && (
        <video
          ref={elemVideoRef}
          autoPlay
          muted
          playsInline
          aria-hidden
          className="fixed -left-[9999px] top-0 w-40 h-24 opacity-0 pointer-events-none"
        />
      )}
      {pipWindow && createPortal(<PiPContent />, pipWindow.document.body)}
    </PiPContext.Provider>
  );
}

function pipTabClass(active: boolean) {
  return `flex-1 py-2.5 text-xs font-semibold transition-all duration-150 border-b-2 ${
    active
      ? 'border-primary text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground'
  }`;
}

function PiPContent() {
  const [tab, setTab] = useState<'video' | 'chat'>('video');

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
      <div className="flex border-b border-border shrink-0">
        <button onClick={() => setTab('video')} className={pipTabClass(tab === 'video')}>
          Video
        </button>
        <button onClick={() => setTab('chat')} className={pipTabClass(tab === 'chat')}>
          Chat
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {tab === 'video' ? <VideoTileGrid /> : <ChatPanel />}
      </div>
      {tab === 'video' && <CallControls />}
    </div>
  );
}
