'use client';

import React from 'react';
import { Video, PhoneCall, Maximize2, Minimize2 } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import type { CallMediaError } from '@/types/room';
import { VideoTileGrid, CallControls } from './VideoCallTiles';

const MEDIA_ERROR_TEXT: Record<CallMediaError, string> = {
  denied:
    "Camera/mic access was denied — you can see and hear everyone, but they can't see or hear you.",
  // Phones opening a dev server by LAN IP land here. No permission prompt will
  // ever appear, so pointing at browser settings would send them in circles.
  insecure:
    'Camera and mic need a secure connection. Open this room over https (or on localhost) to be seen and heard.',
  unavailable: 'No camera or mic found — you can still see and hear everyone else.',
};

interface VideoCallPanelProps {
  /** True while the call has taken over the whole room area. */
  maximized?: boolean;
  /** Omitted on surfaces that have nothing to expand into (e.g. the PiP window). */
  onToggleMaximize?: () => void;
}

export default function VideoCallPanel({ maximized, onToggleMaximize }: VideoCallPanelProps) {
  const { users, currentUser, videoCallState, joinCall } = useRoom();

  const inCallUsers = users.filter((u) => u.inCall && u.userId !== currentUser?.userId);
  const inCallCount = inCallUsers.length + (videoCallState.inCall ? 1 : 0);
  // Nothing to maximise until you're actually on the call, and the phone layout
  // already gives the video tab the whole screen.
  const canMaximize = Boolean(onToggleMaximize) && videoCallState.inCall;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Video size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Video Call
          </span>
        </div>
        <div className="flex items-center gap-2">
          {inCallCount > 0 && (
            <span className="text-xs font-mono-data font-semibold text-foreground bg-muted px-2 py-0.5 rounded-full">
              {inCallCount}
            </span>
          )}
          {canMaximize && (
            <button
              onClick={onToggleMaximize}
              title={maximized ? 'Back to the room (Esc)' : 'Maximise call'}
              aria-label={maximized ? 'Back to the room' : 'Maximise call'}
              className="hidden md:inline-flex w-7 h-7 rounded-md items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Tiles / empty state */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!videoCallState.inCall ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <Video size={28} className="text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">
              {inCallCount > 0
                ? `${inCallCount} ${inCallCount === 1 ? 'person is' : 'people are'} already on the call`
                : 'No one is on a call yet'}
            </p>
            <button
              onClick={joinCall}
              className="btn-primary inline-flex items-center gap-2 !px-4 !py-2 text-xs"
            >
              <PhoneCall size={13} />
              Join call
            </button>
            {videoCallState.mediaError && (
              <p className="text-[10px] text-[var(--status-error)] max-w-[240px]">
                {MEDIA_ERROR_TEXT[videoCallState.mediaError]}
              </p>
            )}
          </div>
        ) : (
          <VideoTileGrid variant={maximized ? 'stage' : 'panel'} />
        )}
      </div>

      {videoCallState.inCall && <CallControls />}
    </div>
  );
}
