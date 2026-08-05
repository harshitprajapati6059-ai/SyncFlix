'use client';

import React from 'react';
import {
  Play,
  Pause,
  Clock,
  Gauge,
  Wifi,
  ExternalLink,
  AlertTriangle,
  Lock,
  LockOpen,
} from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import SyncStatusBadge from '@/components/ui/SyncStatusBadge';
import { formatPlaybackTime, relativeTime } from '@/utils/time';

export default function PlaybackPanel() {
  const {
    playbackState,
    syncState,
    room,
    hostVideo,
    videoMismatch,
    amHost,
    hostOnlyControl,
    setHostOnlyControl,
  } = useRoom();

  // The in-page player reports a real duration; the extension never has, so
  // treat 0 as "unknown" and show an indeterminate bar rather than inventing a
  // total. (This used to be a hardcoded 1h30m, which read as a real number.)
  const duration = playbackState?.duration ?? 0;
  const hasDuration = duration > 0;
  const progressPct = hasDuration
    ? Math.min(100, ((playbackState?.currentTime ?? 0) / duration) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-5 gap-4 sm:gap-5 overflow-auto scrollbar-thin">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Playback State
        </h2>
        <SyncStatusBadge
          status={syncState?.status}
          latencyMs={syncState?.latencyMs}
          drift={syncState?.drift}
          showDetail
        />
      </div>
      {/* Different-video warning: sync is suspended until the viewer opens the
          host's video, so make the one-click fix impossible to miss. */}
      {videoMismatch && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 rounded-xl border bg-[var(--status-warning-bg)] border-[var(--status-warning)]/20">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--status-warning)]">
            <AlertTriangle size={14} className="shrink-0" />
            You&apos;re watching a different video than the host — sync is paused
          </div>
          {hostVideo?.videoUrl && (
            <a
              href={hostVideo.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline shrink-0"
            >
              <ExternalLink size={12} />
              Open host&apos;s video
            </a>
          )}
        </div>
      )}
      {/* Host-only control lock. The host toggles it; everyone else sees where
          it stands, so a viewer whose pause went nowhere knows why. */}
      <div className="card p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {hostOnlyControl ? (
              <Lock size={14} className="text-[var(--status-host)]" />
            ) : (
              <LockOpen size={14} className="text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Host controls only</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {hostOnlyControl
                ? 'Only the host’s play, pause and seek move the room.'
                : 'Anyone can play, pause or seek for everyone.'}
            </p>
          </div>
        </div>

        {amHost ? (
          <button
            type="button"
            role="switch"
            aria-checked={hostOnlyControl}
            aria-label="Host controls only"
            onClick={() => setHostOnlyControl(!hostOnlyControl)}
            className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-150 ${
              hostOnlyControl ? 'bg-[var(--status-host)]' : 'bg-muted border border-border'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-150 ${
                hostOnlyControl ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        ) : (
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full shrink-0 ${
              hostOnlyControl
                ? 'bg-[var(--status-host-bg)] text-[var(--status-host)]'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {hostOnlyControl ? 'On' : 'Off'}
          </span>
        )}
      </div>
      {/* Playback status card */}
      <div className="card p-4 sm:p-5 space-y-4 sm:space-y-5">
        {/* Platform + Status row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Wifi size={15} className="text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium">Platform</p>
              <p className="text-sm font-semibold text-foreground">
                {playbackState?.platform ?? 'Not connected'}
              </p>
              {hostVideo?.videoUrl && (
                <a
                  href={hostVideo.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-full"
                >
                  <ExternalLink size={11} className="shrink-0" />
                  Open host&apos;s video
                </a>
              )}
            </div>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold shrink-0 ${
              playbackState?.playing
                ? 'bg-[var(--status-synced-bg)] text-[var(--status-synced)]'
                : 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]'
            }`}
          >
            {playbackState?.playing ? (
              <>
                <Play size={13} fill="currentColor" /> Playing
              </>
            ) : (
              <>
                <Pause size={13} fill="currentColor" /> Paused
              </>
            )}
          </div>
        </div>

        {/* Time display */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock size={11} />
              Current position
            </span>
            <span className="font-mono-data text-foreground font-semibold text-sm">
              {formatPlaybackTime(playbackState?.currentTime)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex justify-between text-[10px] font-mono-data text-muted-foreground">
            <span>{formatPlaybackTime(playbackState?.currentTime)}</span>
            <span>{hasDuration ? formatPlaybackTime(duration) : '--:--'}</span>
          </div>
        </div>

        {/* Playback speed */}
        <div className="flex items-center justify-between py-3 px-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge size={13} />
            Playback speed
          </div>
          <span className="font-mono-data text-sm font-semibold text-foreground">
            {playbackState?.playbackRate?.toFixed(2)}×
          </span>
        </div>
      </div>
      {/* Sync detail card */}
      <div className="card p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Sync Detail
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Status
            </p>
            <p
              className={`text-sm font-semibold capitalize ${
                syncState?.status === 'synced'
                  ? 'text-[var(--status-synced)]'
                  : syncState?.status === 'desynced'
                    ? 'text-[var(--status-error)]'
                    : 'text-[var(--status-warning)]'
              }`}
            >
              {syncState?.status}
            </p>
          </div>

          <div className="space-y-1 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Latency
            </p>
            <p className="text-sm font-semibold text-foreground font-mono-data">
              {syncState?.latencyMs}ms
            </p>
          </div>

          <div className="space-y-1 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Drift
            </p>
            <p
              className={`text-sm font-semibold font-mono-data ${
                Math.abs(syncState?.drift) < 0.5
                  ? 'text-[var(--status-synced)]'
                  : 'text-[var(--status-warning)]'
              }`}
            >
              {syncState?.drift > 0 ? '+' : ''}
              {syncState?.drift?.toFixed(1)}s
            </p>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground text-right">
          Last checked {relativeTime(syncState?.lastChecked)}
        </p>
      </div>
      {/* Room info */}
      <div className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Room Info
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Room ID</span>
            <code className="font-mono-data text-foreground text-[11px] bg-muted px-1.5 py-0.5 rounded">
              {room?.id?.slice(0, 16) ?? '—'}
            </code>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Created</span>
            <span className="font-mono-data text-foreground text-[11px]">
              {relativeTime(room?.createdAt ?? new Date()?.toISOString())}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Status</span>
            <span
              className={`font-semibold text-[11px] capitalize ${
                room?.status === 'active'
                  ? 'text-[var(--status-synced)]'
                  : 'text-[var(--status-error)]'
              }`}
            >
              {room?.status ?? 'unknown'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
