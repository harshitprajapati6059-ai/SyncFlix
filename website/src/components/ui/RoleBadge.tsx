import React from 'react';
import type { UserRole } from '@/types/room';

interface RoleBadgeProps {
  role: UserRole;
  size?: 'sm' | 'md';
}

export default function RoleBadge({ role, size = 'md' }: RoleBadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  if (role === 'host') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full font-semibold border ${sizeClass} bg-[var(--status-host-bg)] text-[var(--status-host)] border-[var(--status-host)]/20`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-host)]" />
        Host
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold border ${sizeClass} bg-[var(--status-viewer-bg)] text-[var(--status-viewer)] border-[var(--status-viewer)]/20`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-viewer)]" />
      Viewer
    </span>
  );
}
