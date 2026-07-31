'use client';

/**
 * Picture-in-picture for the video call, via the Document Picture-in-Picture
 * API (Chrome/Edge 116+) rather than the classic single-<video> PiP — that's
 * the only way to float an interactive surface (multiple tiles, controls,
 * chat) instead of one raw video frame. The PiP window shares this page's JS
 * context, so a React portal into it keeps full access to RoomContext: no
 * separate bundle, no message-passing.
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
  const { videoCallState } = useRoom();
  const [isSupported, setIsSupported] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  // Client-only check, deferred to an effect so SSR/hydration render the same
  // "unsupported" state before this resolves — evaluating it during render
  // would mismatch between server and browser.
  useEffect(() => {
    setIsSupported(typeof window !== 'undefined' && 'documentPictureInPicture' in window);
  }, []);

  const exit = useCallback(() => {
    pipWindowRef.current?.close();
  }, []);

  const enter = useCallback(async () => {
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
  }, []);

  const toggle = useCallback(() => {
    if (pipWindowRef.current) exit();
    else void enter();
  }, [enter, exit]);

  // Auto-enter once the tab is hidden mid-call (switched tabs, minimized,
  // app-switched on mobile/desktop) — mirrors Google Meet. Auto-exit on
  // return, since the floating window's job is done once you're looking at
  // the tab again.
  useEffect(() => {
    if (!isSupported) return;
    const handleVisibility = () => {
      if (document.hidden) {
        if (videoCallState.inCall && !pipWindowRef.current) void enter();
      } else if (pipWindowRef.current) {
        exit();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isSupported, videoCallState.inCall, enter, exit]);

  // The call ended (e.g. the other side hung up while we were tabbed away) —
  // don't leave an empty floating window behind.
  useEffect(() => {
    if (!videoCallState.inCall && pipWindowRef.current) exit();
  }, [videoCallState.inCall, exit]);

  // Leaving the room entirely: close the floating window with it.
  useEffect(() => () => pipWindowRef.current?.close(), []);

  const value: PiPContextValue = { isSupported, isActive: pipWindow !== null, toggle };

  return (
    <PiPContext.Provider value={value}>
      {children}
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
