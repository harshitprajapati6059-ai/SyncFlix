'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import SyncLogo from '@/components/ui/SyncLogo';
import CopyButton from '@/components/ui/CopyButton';
import ConnectionDot from '@/components/ui/ConnectionDot';
import RoleBadge from '@/components/ui/RoleBadge';
import { useRoom } from '@/context/RoomContext';

export default function RoomHeader() {
  const router = useRouter();
  const { room, currentUser, connectionStatus, leaveRoom } = useRoom();

  const handleLeave = () => {
    leaveRoom();
    router?.push('/');
  };

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
      {/* Left: Logo + Room code */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <SyncLogo size={24} />
          <span className="text-sm font-semibold text-foreground hidden sm:block">SyncFlix</span>
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Room</span>
          <code className="font-mono text-sm font-semibold text-foreground tracking-widest bg-muted px-2 py-0.5 rounded-md">
            {room?.code ?? '------'}
          </code>
          <CopyButton value={room?.code ?? ''} label="room code" />
        </div>
      </div>
      {/* Right: Status + Role + Leave */}
      <div className="flex items-center gap-3">
        <ConnectionDot
          status={
            connectionStatus === 'connected'
              ? 'connected'
              : connectionStatus === 'connecting'
                ? 'connecting'
                : 'disconnected'
          }
          showLabel
        />

        {currentUser && (
          <>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">
                {currentUser?.username}
              </span>
              <RoleBadge role={currentUser?.role} size="sm" />
            </div>
          </>
        )}

        <div className="h-4 w-px bg-border" />

        <button
          onClick={handleLeave}
          className="btn-ghost px-2.5 py-1.5 text-xs gap-1.5 text-muted-foreground hover:text-[var(--status-error)]"
          title="Leave room"
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">Leave</span>
        </button>
      </div>
    </header>
  );
}
