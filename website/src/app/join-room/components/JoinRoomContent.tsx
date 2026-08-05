'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Hash, Loader2, AlertCircle, ArrowRight, User, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import SyncLogo from '@/components/ui/SyncLogo';
import { getRoomByCode } from '@/services/roomService';
import { isValidRoomCodeFormat, normalizeRoomCode } from '@/utils/roomCode';
import { generateUserId, generateUsername } from '@/utils/username';
import { setSessionIdentity } from '@/utils/session';

type ErrorType = 'invalid_format' | 'not_found' | 'expired' | 'network' | null;

const ERROR_MESSAGES: Record<NonNullable<ErrorType>, string> = {
  invalid_format: 'Room codes are 6 characters — letters and numbers only.',
  not_found: 'No active room found with that code. Check the code and try again.',
  expired: 'That room has expired. Ask the host to create a new one.',
  network: 'Connection failed. Check your network and try again.',
};

export default function JoinRoomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set when the user arrived from a shared invite link (/join-room?code=AB12CD).
  const invitedCode = normalizeRoomCode(searchParams?.get('code') ?? '');

  const [code, setCode] = useState(invitedCode);
  const [username, setUsername] = useState(() => generateUsername());
  const [isLoading, setIsLoading] = useState(false);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // With the code already filled in, the only thing left to decide is the
  // display name — so start there.
  useEffect(() => {
    if (invitedCode) {
      setCode(invitedCode);
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [invitedCode]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const normalized = normalizeRoomCode(e.target.value);
      setCode(normalized);
      if (errorType) setErrorType(null);
    },
    [errorType]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
    },
    [code]
  );

  const handleSubmit = async () => {
    if (isLoading) return;

    const trimmed = code.trim();
    const name = username.trim();

    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }

    if (!isValidRoomCodeFormat(trimmed)) {
      setErrorType('invalid_format');
      return;
    }

    if (!name) {
      toast.error('Pick a display name first');
      return;
    }

    setIsLoading(true);
    setErrorType(null);

    try {
      const room = await getRoomByCode(trimmed);

      if (!room) {
        setErrorType('not_found');
        setIsLoading(false);
        return;
      }

      if (room.status === 'expired') {
        setErrorType('expired');
        setIsLoading(false);
        return;
      }

      // Anonymous, per-tab identity (no auth). Presence tracking uses this.
      const userId = generateUserId();
      setSessionIdentity({ userId, username: name, role: 'viewer' });

      toast.success(`Joining room ${room.code}`);
      router.push(`/room-page?code=${room.code}&role=viewer`);
    } catch {
      setErrorType('network');
      setIsLoading(false);
    }
  };

  const hasError = errorType !== null;
  const isReady = code.length === 6 && username.trim().length > 0 && !hasError && !isLoading;

  return (
    <div className="min-h-screen supports-[min-height:100dvh]:min-h-dvh flex flex-col items-center justify-between bg-background px-6">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto">
        {/* Back nav */}
        <div className="w-full mb-8">
          <button
            onClick={() => router.push('/')}
            className="btn-ghost px-0 gap-1.5 text-muted-foreground"
          >
            <ArrowLeft size={15} />
            Back
          </button>
        </div>

        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <SyncLogo size={32} />
          <span className="text-lg font-semibold tracking-tight text-foreground">SyncFlix</span>
        </div>

        {/* Form card */}
        <div className="w-full card p-6 space-y-5">
          <div>
            <h1 className="text-lg font-semibold text-foreground mb-1">Join a room</h1>
            <p className="text-xs text-muted-foreground">
              {invitedCode
                ? "You've been invited — pick a display name and you're in."
                : 'Enter the 6-character code shared by the host.'}
            </p>
          </div>

          {/* Code input */}
          <div className="space-y-2">
            <label
              htmlFor="room-code"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Room Code
            </label>

            <div className="relative">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
                <Hash size={15} className="text-muted-foreground" />
              </div>
              <input
                ref={inputRef}
                id="room-code"
                type="text"
                value={code}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="AB12CD"
                maxLength={6}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={isLoading}
                className={`input-field pl-9 font-mono text-center text-xl tracking-widest uppercase font-semibold transition-all duration-150 ${
                  hasError
                    ? 'border-[var(--status-error)] focus:border-[var(--status-error)] focus:ring-[var(--status-error)]'
                    : code.length === 6
                      ? 'border-[var(--status-synced)] focus:border-[var(--status-synced)] focus:ring-[var(--status-synced)]'
                      : ''
                }`}
              />
              {/* Character count dots */}
              <div className="absolute inset-y-0 right-3.5 flex items-center gap-0.5 pointer-events-none">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={`dot-${i}`}
                    className={`w-1 h-1 rounded-full transition-all duration-150 ${
                      i < code.length
                        ? hasError
                          ? 'bg-[var(--status-error)]'
                          : 'bg-primary'
                        : 'bg-border'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Error message */}
            {hasError && errorType && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--status-error-bg)] border border-[var(--status-error)]/20 fade-in-up">
                <AlertCircle size={14} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                <p className="text-xs text-[var(--status-error)] leading-relaxed">
                  {ERROR_MESSAGES[errorType]}
                </p>
              </div>
            )}
          </div>

          {/* Display name */}
          <div className="space-y-2">
            <label
              htmlFor="display-name"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Your name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
                <User size={15} className="text-muted-foreground" />
              </div>
              <input
                ref={nameRef}
                id="display-name"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 20))}
                onKeyDown={handleKeyDown}
                placeholder="Your name"
                maxLength={20}
                autoComplete="off"
                disabled={isLoading}
                className="input-field pl-9 pr-10 text-sm font-medium"
              />
              <button
                type="button"
                onClick={() => setUsername(generateUsername())}
                disabled={isLoading}
                title="Suggest another name"
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-primary transition-colors duration-150 disabled:opacity-40"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!isReady && !isLoading}
            className="btn-primary w-full py-3 text-sm font-semibold"
          >
            {isLoading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                Join Room
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>

        {/* Hint */}
        <p className="mt-4 text-xs text-muted-foreground text-center">
          Need to create a room instead?{' '}
          <button
            onClick={() => router.push('/')}
            className="text-primary hover:underline transition-all duration-150"
          >
            Go back
          </button>
        </p>
      </div>

      <footer className="pb-8">
        <p className="text-xs text-muted-foreground">Built for personal use.</p>
      </footer>
    </div>
  );
}
