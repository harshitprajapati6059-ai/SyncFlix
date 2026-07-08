'use client';

import React from 'react';

interface ConnectionDotProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG = {
  connected: {
    dot: 'bg-[var(--status-synced)]',
    label: 'Connected',
    labelClass: 'text-[var(--status-synced)]',
    pulse: true,
  },
  connecting: {
    dot: 'bg-[var(--status-warning)]',
    label: 'Connecting',
    labelClass: 'text-[var(--status-warning)]',
    pulse: true,
  },
  disconnected: {
    dot: 'bg-muted-foreground',
    label: 'Disconnected',
    labelClass: 'text-muted-foreground',
    pulse: false,
  },
  error: {
    dot: 'bg-[var(--status-error)]',
    label: 'Error',
    labelClass: 'text-[var(--status-error)]',
    pulse: false,
  },
};

export default function ConnectionDot({
  status,
  showLabel = false,
  size = 'sm',
}: ConnectionDotProps) {
  const config = STATUS_CONFIG[status];
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex">
        {config.pulse && (
          <span
            className={`absolute inline-flex w-full h-full rounded-full ${config.dot} opacity-60 pulse-dot`}
          />
        )}
        <span className={`relative inline-flex rounded-full ${dotSize} ${config.dot}`} />
      </span>
      {showLabel && (
        <span className={`text-xs font-medium ${config.labelClass}`}>{config.label}</span>
      )}
    </span>
  );
}
