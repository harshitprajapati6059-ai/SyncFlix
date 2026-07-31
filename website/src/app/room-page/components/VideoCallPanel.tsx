'use client';

import React, { useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, PhoneCall, RefreshCw } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import type { PeerConnectionStatus } from '@/types/room';

function Avatar({ username }: { username?: string }) {
  return (
    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-foreground uppercase">
      {username?.slice(0, 2)}
    </div>
  );
}

function LocalTile() {
  const { videoCallState, getLocalCallStream, currentUser } = useRoom();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Re-attach whenever the call starts or the camera track is (re)acquired —
  // the underlying MediaStream is mutated in place, so identity alone won't
  // trigger this effect.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = getLocalCallStream();
  }, [videoCallState.inCall, videoCallState.cameraOn, getLocalCallStream]);

  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-muted border border-border">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`w-full h-full object-cover -scale-x-100 ${videoCallState.cameraOn ? '' : 'opacity-0'}`}
      />
      {!videoCallState.cameraOn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar username={currentUser?.username} />
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white">
        You
        {!videoCallState.micOn && <MicOff size={10} />}
      </div>
    </div>
  );
}

interface RemoteTileProps {
  username: string;
  cameraOn?: boolean;
  micOn?: boolean;
  stream?: MediaStream;
  connectionStatus?: PeerConnectionStatus;
}

function RemoteTile({ username, cameraOn, micOn, stream, connectionStatus }: RemoteTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  // The <video> element stays mounted even with the camera off — it's also
  // carrying the audio track, so hiding it visually (not unmounting it) is
  // what keeps remote audio playing for mic-only participants.
  const showVideo = Boolean(cameraOn && stream);

  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-muted border border-border">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${showVideo ? '' : 'opacity-0'}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar username={username} />
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white max-w-[80%]">
        <span className="truncate">{username}</span>
        {micOn === false && <MicOff size={10} className="shrink-0" />}
      </div>
      {connectionStatus === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="text-[10px] font-semibold text-white">Connecting…</span>
        </div>
      )}
      {connectionStatus === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="text-[10px] font-semibold text-[var(--status-error)]">
            Connection failed
          </span>
        </div>
      )}
    </div>
  );
}

export default function VideoCallPanel() {
  const {
    users,
    currentUser,
    videoCallState,
    remoteStreams,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
  } = useRoom();

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
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
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
          <div className="grid grid-cols-2 gap-2">
            <LocalTile />
            {inCallUsers.map((u) => (
              <RemoteTile
                key={`call-${u.userId}`}
                username={u.username}
                cameraOn={u.cameraOn}
                micOn={u.micOn}
                stream={remoteStreams[u.userId]}
                connectionStatus={videoCallState.peers[u.userId]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      {videoCallState.inCall && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={toggleMic}
            title={videoCallState.micOn ? 'Mute mic' : 'Unmute mic'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              videoCallState.micOn
                ? 'bg-muted hover:bg-muted/70 text-foreground'
                : 'bg-[var(--status-error)]/15 text-[var(--status-error)]'
            }`}
          >
            {videoCallState.micOn ? <Mic size={15} /> : <MicOff size={15} />}
          </button>
          <button
            onClick={toggleCamera}
            title={videoCallState.cameraOn ? 'Turn camera off' : 'Turn camera on'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              videoCallState.cameraOn
                ? 'bg-muted hover:bg-muted/70 text-foreground'
                : 'bg-[var(--status-error)]/15 text-[var(--status-error)]'
            }`}
          >
            {videoCallState.cameraOn ? <Video size={15} /> : <VideoOff size={15} />}
          </button>
          <button
            onClick={switchCamera}
            title="Switch camera"
            className="md:hidden w-9 h-9 rounded-full flex items-center justify-center bg-muted hover:bg-muted/70 text-foreground transition-colors"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={leaveCall}
            title="Leave call"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--status-error)] text-white hover:opacity-90 transition-opacity"
          >
            <PhoneOff size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
