'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Download, CircleHelp, BookOpen } from 'lucide-react';
import SyncLogo from '@/components/ui/SyncLogo';
import CopyButton from '@/components/ui/CopyButton';
import ConnectionDot from '@/components/ui/ConnectionDot';
import RoleBadge from '@/components/ui/RoleBadge';
import InstallExtensionModal from './InstallExtensionModal';
import HowToUseModal from './HowToUseModal';
import { useRoom } from '@/context/RoomContext';

export default function RoomHeader() {
  const router = useRouter();
  const { room, currentUser, connectionStatus, leaveRoom } = useRoom();
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showUsageHelp, setShowUsageHelp] = useState(false);

  const handleLeave = () => {
    leaveRoom();
    router?.push('/');
  };

  const dotStatus =
    connectionStatus === 'connected'
      ? 'connected'
      : connectionStatus === 'connecting'
        ? 'connecting'
        : connectionStatus === 'error'
          ? 'error'
          : 'disconnected';

  return (
    <header className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-border bg-card shrink-0">
      {/* Left: Logo + Room code */}
      <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
        <div className="flex items-center gap-2">
          <SyncLogo size={24} />
          <span className="text-sm font-semibold text-foreground hidden sm:block">SyncFlix</span>
        </div>

        <div className="h-4 w-px bg-border shrink-0" />

        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs text-muted-foreground font-medium">Room</span>
          <code className="font-mono text-sm font-semibold text-foreground tracking-widest bg-muted px-2 py-0.5 rounded-md">
            {room?.code ?? '------'}
          </code>
          <CopyButton value={room?.code ?? ''} label="room code" />
        </div>
      </div>
      {/* Right: Status + Role + Leave */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="hidden sm:inline-flex">
          <ConnectionDot status={dotStatus} showLabel />
        </span>
        <span className="sm:hidden inline-flex">
          <ConnectionDot status={dotStatus} />
        </span>

        <a
          href="/downloads/syncflix-extension.zip"
          download
          className="btn-ghost px-2.5 py-1.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          title="Download the SyncFlix browser extension (load unpacked in chrome://extensions)"
        >
          <Download size={13} />
          <span className="hidden sm:inline">Extension</span>
        </a>

        <button
          onClick={() => setShowInstallHelp(true)}
          className="btn-ghost px-2.5 py-1.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          title="How to install the extension"
        >
          <CircleHelp size={13} />
          <span className="hidden sm:inline">How to install</span>
        </button>

        <button
          onClick={() => setShowUsageHelp(true)}
          className="btn-ghost px-2.5 py-1.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          title="How to use SyncFlix"
        >
          <BookOpen size={13} />
          <span className="hidden sm:inline">How to use</span>
        </button>

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

      <InstallExtensionModal open={showInstallHelp} onClose={() => setShowInstallHelp(false)} />
      <HowToUseModal open={showUsageHelp} onClose={() => setShowUsageHelp(false)} />
    </header>
  );
}
