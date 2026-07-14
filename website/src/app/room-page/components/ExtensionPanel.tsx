'use client';

import React from 'react';
import { Puzzle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';

export default function ExtensionPanel() {
  const { extensionState } = useRoom();

  const statusConfig = {
    connected: {
      icon: <CheckCircle2 size={14} className="text-[var(--status-synced)]" />,
      label: 'Extension connected',
      labelClass: 'text-[var(--status-synced)]',
      bg: 'bg-[var(--status-synced-bg)] border-[var(--status-synced)]/20',
    },
    disconnected: {
      icon: <XCircle size={14} className="text-[var(--status-error)]" />,
      label: 'Extension not detected',
      labelClass: 'text-[var(--status-error)]',
      bg: 'bg-[var(--status-error-bg)] border-[var(--status-error)]/20',
    },
    waiting: {
      icon: <Clock size={14} className="text-[var(--status-warning)]" />,
      label: 'Waiting for extension',
      labelClass: 'text-[var(--status-warning)]',
      bg: 'bg-[var(--status-warning-bg)] border-[var(--status-warning)]/20',
    },
  };

  const config = statusConfig?.[extensionState?.status];

  return (
    <div className="px-4 sm:px-5 pb-4 shrink-0">
      <div
        className={`flex items-center justify-between flex-wrap gap-2 px-4 py-3 rounded-xl border ${config?.bg}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Puzzle size={14} className="text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            {config?.icon}
            <span className={`text-xs font-semibold ${config?.labelClass}`}>{config?.label}</span>
          </div>
        </div>

        {extensionState?.platform && (
          <span className="text-[10px] font-mono-data text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {extensionState?.platform}
          </span>
        )}

        {extensionState?.version && (
          <span className="text-[10px] text-muted-foreground">v{extensionState?.version}</span>
        )}
      </div>
    </div>
  );
}
