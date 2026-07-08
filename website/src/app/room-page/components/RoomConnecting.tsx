import React from 'react';
import SyncLogo from '@/components/ui/SyncLogo';

export default function RoomConnecting() {
  return (
    <div
      suppressHydrationWarning
      className="min-h-screen flex flex-col items-center justify-center bg-background gap-4"
    >
      <div className="heartbeat">
        <SyncLogo size={48} />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">Connecting to room</p>
        <p className="text-xs text-muted-foreground">Establishing realtime connection...</p>
      </div>
      <div className="flex gap-1 mt-2">
        {Array.from({ length: 3 })?.map((_, i) => (
          <span
            key={`loading-dot-${i}`}
            suppressHydrationWarning
            className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}
