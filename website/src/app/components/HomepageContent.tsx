'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Hash, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import SyncLogo from '@/components/ui/SyncLogo';
import { createRoom } from '@/services/roomService';
import { generateUserId, generateUsername } from '@/utils/username';

export default function HomepageContent() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const userId = generateUserId();
      const username = generateUsername();

      // Store session info
      // BACKEND: This would be replaced with Supabase session/presence tracking
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('syncflix_user_id', userId);
        sessionStorage.setItem('syncflix_username', username);
        sessionStorage.setItem('syncflix_role', 'host');
      }

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
    <div className="min-h-screen flex flex-col items-center justify-between bg-background px-6">
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

        {/* CTAs */}
        <div className="w-full space-y-3">
          <button
            onClick={handleCreateRoom}
            disabled={isCreating}
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
          Supports YouTube and more platforms.
        </p>
      </div>

      {/* Footer */}
      <footer className="pb-8 text-center">
        <p className="text-xs text-muted-foreground">Built for personal use.</p>
      </footer>
    </div>
  );
}
