'use client';

import React from 'react';
import { Play, Pause, Clock, Gauge, Wifi } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import SyncStatusBadge from '@/components/ui/SyncStatusBadge';
import { formatPlaybackTime, relativeTime } from '@/utils/time';

export default function PlaybackPanel() {
  const { playbackState, syncState, room } = useRoom();

  const totalMockDuration = 5400; // 1h30m for display
  const progressPct = Math.min(100, (playbackState?.currentTime / totalMockDuration) * 100);

  return (
    <div className="flex-1 flex flex-col p-5 gap-5 overflow-auto scrollbar-thin">
      {/* Section header */}
      <div className="flex items-center justify-between">
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
      {/* Playback status card */}
      <div className="card p-5 space-y-5">
        {/* Platform + Status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <Wifi size={15} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Platform</p>
              <p className="text-sm font-semibold text-foreground">
                {playbackState?.platform ?? 'Not connected'}
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
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
            <span>{formatPlaybackTime(totalMockDuration)}</span>
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
