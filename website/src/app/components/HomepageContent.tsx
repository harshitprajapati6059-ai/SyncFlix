'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Hash, ArrowRight, Loader2, User, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import SyncLogo from '@/components/ui/SyncLogo';
import { createRoom } from '@/services/roomService';
import { generateUserId, generateUsername } from '@/utils/username';
import { setSessionIdentity } from '@/utils/session';

export default function HomepageContent() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  // Prefilled with a random suggestion; the user can edit or re-roll it.
  const [username, setUsername] = useState(() => generateUsername());

  const handleCreateRoom = async () => {
    if (isCreating) return;
    const name = username.trim();
    if (!name) {
      toast.error('Pick a display name first');
      return;
    }
    setIsCreating(true);

    try {
      const userId = generateUserId();

      // Anonymous, per-tab identity (no auth). Presence tracking uses this.
      setSessionIdentity({ userId, username: name, role: 'host' });

      const room = await createRoom(userId);

      toast.success(`Room ${room.code} created`);
      router.push(`/room-page?code=${room.code}&role=host`);
    } catch {
      toast.error('Failed to create room — please try again');
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    router.push('/join-room');
  };

  return (
    <div className="min-h-screen supports-[min-height:100dvh]:min-h-dvh flex flex-col items-center justify-between bg-background px-6">
      {/* Main centered content */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto">
        {/* Logo + Brand */}
        <div className="flex flex-col items-center gap-6 mb-12">
          <div className="flex items-center gap-3">
            <SyncLogo size={48} />
            <span className="text-2xl font-semibold tracking-tight text-foreground">SyncFlix</span>
          </div>

          {/* Tagline */}
          <div className="text-center space-y-1">
            <p className="text-muted-foreground text-sm font-medium tracking-wide">Minimal UI.</p>
            <p className="text-muted-foreground text-sm font-medium tracking-wide">
              Maximum Synchronization.
            </p>
          </div>
        </div>

        {/* Display name */}
        <div className="w-full mb-3">
          <label
            htmlFor="display-name"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            Your name
          </label>
          <div className="relative mt-1.5">
            <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
              <User size={15} className="text-muted-foreground" />
            </div>
            <input
              id="display-name"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.slice(0, 20))}
              placeholder="Your name"
              maxLength={20}
              autoComplete="off"
              disabled={isCreating}
              className="input-field pl-9 pr-10 text-sm font-medium"
            />
            <button
              type="button"
              onClick={() => setUsername(generateUsername())}
              disabled={isCreating}
              title="Suggest another name"
              className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-primary transition-colors duration-150 disabled:opacity-40"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* CTAs */}
        <div className="w-full space-y-3">
          <button
            onClick={handleCreateRoom}
            disabled={isCreating || !username.trim()}
            className="btn-primary w-full py-3.5 text-sm font-semibold"
          >
            {isCreating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating room...
              </>
            ) : (
              <>
                <Plus size={16} />
                Create Room
              </>
            )}
          </button>

          <button
            onClick={handleJoinRoom}
            disabled={isCreating}
            className="btn-secondary w-full py-3.5 text-sm font-semibold"
          >
            <Hash size={16} />
            Join Room
            <ArrowRight size={14} className="ml-auto opacity-50" />
          </button>
        </div>

        {/* Extension hint */}
        <p className="mt-8 text-center text-xs text-muted-foreground leading-relaxed max-w-xs">
          Works with the SyncFlix browser extension.
          <br />
          Supports YouTube, Netflix and Prime Video, with more platforms coming.
        </p>
      </div>
    </div>
  );
}
