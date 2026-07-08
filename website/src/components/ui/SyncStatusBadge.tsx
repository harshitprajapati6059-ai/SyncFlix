'use client';

import React from 'react';
import type { SyncStatus } from '@/types/room';
import { formatDrift } from '@/utils/time';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  latencyMs?: number;
  drift?: number;
  showDetail?: boolean;
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; className: string; dotColor: string }> = {
  synced: {
    label: 'In Sync',
    className: 'badge-synced',
    dotColor: 'bg-[var(--status-synced)]',
  },
  syncing: {
    label: 'Syncing',
    className: 'badge-warning',
    dotColor: 'bg-[var(--status-warning)]',
  },
  desynced: {
    label: 'Desynced',
    className: 'badge-error',
    dotColor: 'bg-[var(--status-error)]',
  },
  unknown: {
    label: 'Unknown',
    className: 'badge-info',
    dotColor: 'bg-muted-foreground',
  },
};

export default function SyncStatusBadge({
  status,
  latencyMs,
  drift,
  showDetail = false,
}: SyncStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span className={config.className}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} pulse-dot`} />
      {config.label}
      {showDetail && latencyMs !== undefined && (
        <span className="font-mono-data opacity-70 ml-1">{latencyMs}ms</span>
      )}
      {showDetail && drift !== undefined && Math.abs(drift) > 0.5 && (
        <span className="font-mono-data opacity-70 ml-1">{formatDrift(drift)}</span>
      )}
    </span>
  );
}
