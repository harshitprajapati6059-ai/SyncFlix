'use client';

import React from 'react';
import { Video, PhoneCall } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import { VideoTileGrid, CallControls } from './VideoCallTiles';

export default function VideoCallPanel() {
  const { users, currentUser, videoCallState, joinCall } = useRoom();

  const inCallUsers = users.filter((u) => u.inCall && u.userId !== currentUser?.userId);
  const inCallCount = inCallUsers.length + (videoCallState.inCall ? 1 : 0);

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
        {inCallCount > 0 && (
          <span className="text-xs font-mono-data font-semibold text-foreground bg-muted px-2 py-0.5 rounded-full">
            {inCallCount}
          </span>
        )}
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
            {videoCallState.hasMediaPermission === false && (
              <p className="text-[10px] text-[var(--status-error)] max-w-[220px]">
                Camera/mic access was denied — check your browser permissions and try again.
              </p>
            )}
          </div>
        ) : (
          <VideoTileGrid />
        )}
      </div>

      {videoCallState.inCall && <CallControls />}
    </div>
  );
}
