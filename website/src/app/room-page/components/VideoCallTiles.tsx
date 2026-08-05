'use client';

/**
 * Shared video-call rendering pieces — tiles and the control bar.
 *
 * Used both in the sidebar's VideoCallPanel and inside the Document
 * Picture-in-Picture window (see VideoCallPiP.tsx), so the two surfaces stay
 * pixel-identical instead of drifting as separate implementations.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  X,
  RefreshCw,
  PictureInPicture2,
  Pin,
  PinOff,
  Volume2,
  VolumeX,
  MonitorUp,
  SmilePlus,
} from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import type { CallReaction, PeerConnectionStatus } from '@/types/room';
import { usePiP } from './VideoCallPiP';

/** The quick-bar of reactions. Small on purpose — a picker would be a menu, not a reflex. */
const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '😮'];

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

/**
 * Point a <video> at a stream and make sure it actually plays.
 *
 * Mobile browsers routinely ignore the autoplay attribute for a srcObject set
 * from script, and iOS in particular leaves the element paused showing a black
 * rectangle. Calling play() explicitly — again once metadata lands, since the
 * first attempt can land before there's anything to play — is what makes tiles
 * reliable on a phone. The rejection is expected and ignorable: it just means
 * the browser wants a user gesture, which joining the call already provided.
 */
function useAttachStream(
  ref: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (!stream) return;
    const play = () => {
      void el.play().catch(() => {});
    };
    play();
    el.addEventListener('loadedmetadata', play);
    return () => el.removeEventListener('loadedmetadata', play);
  }, [ref, stream]);
}

/**
 * Tile shape for a call of `tileCount` people, on a narrow screen.
 *
 * A phone panel is narrow and tall, so the shape that uses it best changes with
 * the headcount. Two people get a column each to themselves at a full 16:9 —
 * roughly 376×211 on a 400px phone, with height to spare.
 *
 * Past that the grid goes to two columns and each tile is only ~184px wide,
 * where 16:9 collapses into a 103px letterbox strip: a sliver of face, with the
 * panel's remaining height left empty below. Squaring the ratio up spends that
 * spare height on the faces instead — 4:3 gives 138px, 1:1 gives 184px — so the
 * more people are on the call, the more of each tile is actually a person.
 *
 * `md:` restores 16:9 everywhere — the desktop sidebar is a fixed 320px column
 * whose tiles were never the thing under pressure.
 */
function tileAspectClass(tileCount: number): string {
  if (tileCount <= 2) return 'aspect-video';
  if (tileCount <= 4) return 'aspect-[4/3] md:aspect-video';
  return 'aspect-square md:aspect-video';
}

export function LocalTile({ aspectClass = 'aspect-video' }: { aspectClass?: string }) {
  const { videoCallState, getLocalCallStream, currentUser } = useRoom();
  const videoRef = useRef<HTMLVideoElement>(null);

  const sharing = videoCallState.screenSharing;

  // Re-attach whenever the call starts or the outgoing video changes — the
  // underlying MediaStream is mutated in place (and swapped entirely when a
  // screen share starts), so identity alone won't trigger this effect.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = getLocalCallStream();
  }, [videoCallState.inCall, videoCallState.cameraOn, sharing, getLocalCallStream]);

  const showVideo = sharing || videoCallState.cameraOn;

  return (
    <div
      className={`relative ${aspectClass} rounded-xl overflow-hidden bg-muted border ${
        sharing ? 'border-primary' : 'border-border'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        // Mirroring is right for a camera (you expect to move like a mirror)
        // and wrong for a screen, where it would reverse all the text.
        className={`w-full h-full ${
          sharing ? 'object-contain bg-black' : 'object-cover -scale-x-100'
        } ${showVideo ? '' : 'opacity-0'}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar username={currentUser?.username} />
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white">
        {sharing ? 'You — sharing' : 'You'}
        {sharing && <MonitorUp size={10} className="text-primary" />}
        {!videoCallState.micOn && <MicOff size={10} />}
      </div>
    </div>
  );
}

/**
 * The emoji people have thrown at the call, drifting up over the tiles.
 *
 * Pointer-events are off throughout: a reaction must never sit between someone
 * and the mute button underneath it.
 */
function ReactionOverlay({ reactions }: { reactions: CallReaction[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
      {reactions.map((r) => (
        <div
          key={r.id}
          className="absolute bottom-2 animate-reaction-float flex flex-col items-center gap-0.5"
          style={{ left: `${r.offset}%` }}
        >
          <span className="text-3xl drop-shadow-lg leading-none">{r.emoji}</span>
          <span className="px-1 rounded bg-black/55 text-[9px] font-medium text-white whitespace-nowrap">
            {r.username}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Small translucent control that sits over a tile. */
function TileButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center backdrop-blur-sm transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'bg-black/55 text-white hover:bg-black/75'
      }`}
    >
      {children}
    </button>
  );
}

interface RemoteTileProps {
  userId: string;
  username: string;
  cameraOn?: boolean;
  micOn?: boolean;
  screenSharing?: boolean;
  stream?: MediaStream;
  connectionStatus?: PeerConnectionStatus;
  aspectClass?: string;
}

export function RemoteTile({
  userId,
  username,
  cameraOn,
  micOn,
  screenSharing,
  stream,
  connectionStatus,
  aspectClass = 'aspect-video',
}: RemoteTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { pinnedUserId, togglePinnedUser, mutedUserIds, toggleUserMuted } = useRoom();
  useAttachStream(videoRef, stream ?? null);

  const pinned = pinnedUserId === userId;
  const muted = mutedUserIds.includes(userId);

  // Muting is done on the element rather than the track: the track is shared
  // with anything else rendering this peer (the PiP window, the speaker view),
  // and disabling it would silence them everywhere at once.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // The <video> element stays mounted even with the camera off — it's also
  // carrying the audio track, so hiding it visually (not unmounting it) is
  // what keeps remote audio playing for mic-only participants.
  const showVideo = Boolean((cameraOn || screenSharing) && stream);

  return (
    <div
      className={`group relative ${aspectClass} rounded-xl overflow-hidden bg-muted border ${
        pinned ? 'border-primary' : 'border-border'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // A shared screen is letterboxed, not cropped — cover would cut off the
        // edges of exactly the content someone is trying to show you.
        className={`w-full h-full ${screenSharing ? 'object-contain bg-black' : 'object-cover'} ${
          showVideo ? '' : 'opacity-0'
        }`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar username={username} />
        </div>
      )}

      {/* Per-tile controls. Always visible on touch, where there is no hover. */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
        <TileButton
          onClick={() => toggleUserMuted(userId)}
          title={muted ? `Unmute ${username} for you` : `Mute ${username} for you`}
          active={muted}
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </TileButton>
        <TileButton
          onClick={() => togglePinnedUser(userId)}
          title={pinned ? 'Unpin' : `Pin ${username}`}
          active={pinned}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </TileButton>
      </div>

      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white max-w-[80%]">
        <span className="truncate">{username}</span>
        {screenSharing && <MonitorUp size={10} className="shrink-0 text-primary" />}
        {micOn === false && <MicOff size={10} className="shrink-0" />}
        {muted && <VolumeX size={10} className="shrink-0 text-[var(--status-error)]" />}
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

/**
 * Column count for the maximised call, where the grid has the whole room to
 * work with rather than a 320px rail. Tiles stay 16:9 here — there is width to
 * spend, so the useful lever is how many go on a row before they get small.
 */
function stageColumns(tileCount: number): string {
  if (tileCount <= 1) return 'grid-cols-1';
  if (tileCount <= 2) return 'grid-cols-1 sm:grid-cols-2';
  if (tileCount <= 4) return 'grid-cols-2';
  if (tileCount <= 9) return 'grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-3 lg:grid-cols-4';
}

/**
 * Caps how wide the grid may grow. Without it a two-person call on a wide
 * monitor stretches into two enormous tiles that push the controls off-screen.
 */
function stageMaxWidth(tileCount: number): string {
  if (tileCount <= 1) return 'max-w-3xl';
  if (tileCount <= 4) return 'max-w-6xl';
  return 'max-w-7xl';
}

export function VideoTileGrid({ variant = 'panel' }: { variant?: 'panel' | 'stage' }) {
  const { users, currentUser, remoteStreams, videoCallState, pinnedUserId, callReactions } =
    useRoom();
  const inCallUsers = users.filter((u) => u.inCall && u.userId !== currentUser?.userId);
  const stage = variant === 'stage';

  const remoteTile = (u: (typeof inCallUsers)[number], aspect: string) => (
    <RemoteTile
      key={`call-${u.userId}`}
      userId={u.userId}
      username={u.username}
      cameraOn={u.cameraOn}
      micOn={u.micOn}
      screenSharing={u.screenSharing}
      stream={remoteStreams[u.userId]}
      connectionStatus={videoCallState.peers[u.userId]}
      aspectClass={aspect}
    />
  );

  // ─── Speaker view ────────────────────────────────────────────────────────
  // One person fills the space and everyone else shrinks to a strip. This is
  // what makes the call usable as a plain conversation: pin whoever is talking
  // (or sharing) and the rest stops competing for room.
  const pinnedUser = pinnedUserId ? inCallUsers.find((u) => u.userId === pinnedUserId) : undefined;
  if (pinnedUser) {
    const others = inCallUsers.filter((u) => u.userId !== pinnedUser.userId);
    return (
      <div className="relative h-full flex flex-col gap-2 p-3">
        <ReactionOverlay reactions={callReactions} />
        <div className="min-h-0 flex-1 flex items-center">
          <div className="w-full">{remoteTile(pinnedUser, 'aspect-video')}</div>
        </div>
        {/* Filmstrip: fixed-width tiles that scroll sideways rather than
            reflowing the stage every time someone joins. */}
        <div className="shrink-0 flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          <div className="w-28 sm:w-36 shrink-0">
            <LocalTile aspectClass="aspect-video" />
          </div>
          {others.map((u) => (
            <div key={`strip-${u.userId}`} className="w-28 sm:w-36 shrink-0">
              {remoteTile(u, 'aspect-video')}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Grid view ───────────────────────────────────────────────────────────
  // A one-to-one call gets a single column on a phone: two side-by-side tiles in
  // a ~360px-wide panel leaves each face about 40px tall, which is unusable.
  // Three or more participants have to share the width regardless.
  const tileCount = inCallUsers.length + 1;
  const gridCols = stage
    ? stageColumns(tileCount)
    : tileCount <= 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-2';
  const aspectClass = stage ? 'aspect-video' : tileAspectClass(tileCount);

  const tiles = (
    <>
      <LocalTile aspectClass={aspectClass} />
      {inCallUsers.map((u) => remoteTile(u, aspectClass))}
    </>
  );

  if (stage) {
    return (
      <div className="relative h-full overflow-y-auto scrollbar-thin flex items-center justify-center p-4 sm:p-6">
        <ReactionOverlay reactions={callReactions} />
        <div className={`grid ${gridCols} gap-3 w-full ${stageMaxWidth(tileCount)} mx-auto`}>
          {tiles}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      <ReactionOverlay reactions={callReactions} />
      <div className={`grid ${gridCols} gap-2 p-3`}>{tiles}</div>
    </div>
  );
}

const controlButtonClass = (active: boolean) =>
  `w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
    active
      ? 'bg-muted hover:bg-muted/70 text-foreground'
      : 'bg-[var(--status-error)]/15 text-[var(--status-error)]'
  }`;

/** The emoji quick-bar, opened from the reaction button and dismissed on pick. */
function ReactionBar({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full bg-card border border-border shadow-lg">
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          title={`React ${emoji}`}
          className="w-8 h-8 rounded-full text-lg leading-none flex items-center justify-center hover:bg-muted transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function CallControls() {
  const {
    videoCallState,
    toggleCamera,
    toggleMic,
    switchCamera,
    leaveCall,
    toggleScreenShare,
    sendCallReaction,
  } = useRoom();
  const { isSupported: pipSupported, isActive: pipActive, toggle: togglePip } = usePiP();
  const [reactionsOpen, setReactionsOpen] = useState(false);

  return (
    <div className="relative flex items-center justify-center gap-2 px-4 py-3 border-t border-border shrink-0">
      {reactionsOpen && (
        <ReactionBar
          onPick={(emoji) => {
            sendCallReaction(emoji);
            setReactionsOpen(false);
          }}
        />
      )}
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
      <button
        onClick={() => setReactionsOpen((open) => !open)}
        title="React"
        aria-expanded={reactionsOpen}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
          reactionsOpen
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted hover:bg-muted/70 text-foreground'
        }`}
      >
        <SmilePlus size={15} />
      </button>
      {/* Hidden rather than disabled where getDisplayMedia doesn't exist — no
          mobile browser can capture a screen, and a dead button just invites
          tapping. */}
      {videoCallState.canScreenShare && (
        <button
          onClick={toggleScreenShare}
          title={videoCallState.screenSharing ? 'Stop sharing screen' : 'Share screen'}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
            videoCallState.screenSharing
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/70 text-foreground'
          }`}
        >
          <MonitorUp size={15} />
        </button>
      )}
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
