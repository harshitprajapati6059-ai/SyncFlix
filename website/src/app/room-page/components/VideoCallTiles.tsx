'use client';

/**
 * Shared video-call rendering pieces — tiles and the control bar.
 *
 * Used both in the sidebar's VideoCallPanel and inside the Document
 * Picture-in-Picture window (see VideoCallPiP.tsx), so the two surfaces stay
 * pixel-identical instead of drifting as separate implementations.
 */

import React, { useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, Phone, X, RefreshCw, PictureInPicture2 } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import type { PeerConnectionStatus } from '@/types/room';
import { usePiP } from './VideoCallPiP';

export function Avatar({ username }: { username?: string }) {
  return (
    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-foreground uppercase">
      {username?.slice(0, 2)}
    </div>
  );
}

/** Handset + a distinct X badge (not a slash-through) — matches the hang-up icon design. */
export function HangUpIcon({ size = 15 }: { size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Phone size={size} strokeWidth={2} className="absolute inset-0" />
      <X size={Math.round(size * 0.6)} strokeWidth={2.5} className="absolute -top-0.5 -right-0.5" />
    </span>
  );
}

export function LocalTile() {
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

export function RemoteTile({
  username,
  cameraOn,
  micOn,
  stream,
  connectionStatus,
}: RemoteTileProps) {
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

export function VideoTileGrid() {
  const { users, currentUser, remoteStreams, videoCallState } = useRoom();
  const inCallUsers = users.filter((u) => u.inCall && u.userId !== currentUser?.userId);

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
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
  );
}

const controlButtonClass = (active: boolean) =>
  `w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
    active
      ? 'bg-muted hover:bg-muted/70 text-foreground'
      : 'bg-[var(--status-error)]/15 text-[var(--status-error)]'
  }`;

export function CallControls() {
  const { videoCallState, toggleCamera, toggleMic, switchCamera, leaveCall } = useRoom();
  const { isSupported: pipSupported, isActive: pipActive, toggle: togglePip } = usePiP();

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-border shrink-0">
      <button
        onClick={toggleMic}
        title={videoCallState.micOn ? 'Mute mic' : 'Unmute mic'}
        className={controlButtonClass(videoCallState.micOn)}
      >
        {videoCallState.micOn ? <Mic size={15} /> : <MicOff size={15} />}
      </button>
      <button
        onClick={toggleCamera}
        title={videoCallState.cameraOn ? 'Turn camera off' : 'Turn camera on'}
        className={controlButtonClass(videoCallState.cameraOn)}
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
      {pipSupported && (
        <button
          onClick={togglePip}
          title={pipActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
            pipActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/70 text-foreground'
          }`}
        >
          <PictureInPicture2 size={15} />
        </button>
      )}
      <button
        onClick={leaveCall}
        title="Leave call"
        className="w-9 h-9 rounded-full flex items-center justify-center bg-[#D32F2F] text-white hover:opacity-90 transition-opacity"
      >
        <HangUpIcon size={15} />
      </button>
    </div>
  );
}
