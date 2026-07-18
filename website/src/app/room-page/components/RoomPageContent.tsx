'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RoomProvider } from '@/context/RoomContext';
import RoomHeader from './RoomHeader';
import RoomLayout from './RoomLayout';
import RoomConnecting from './RoomConnecting';
import { useRoom } from '@/context/RoomContext';

function RoomInner() {
  const { connectionStatus } = useRoom();

  if (connectionStatus === 'connecting') {
    return <RoomConnecting />;
  }

  return (
    <div className="flex flex-col h-screen supports-[height:100dvh]:h-dvh bg-background overflow-hidden">
      <RoomHeader />
      <RoomLayout />
    </div>
  );
}

function RoomPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams?.get('code') ?? null;
  const role = searchParams?.get('role') === 'host';

  // No code → nothing to connect to. Send the user to the join flow instead of
  // silently dropping them into a hardcoded phantom room.
  useEffect(() => {
    if (!code) router.replace('/join-room');
  }, [code, router]);

  if (!code) return <RoomConnecting />;

  return (
    <RoomProvider roomCode={code} isHost={role}>
      <RoomInner />
    </RoomProvider>
  );
}

export default function RoomPageContent() {
  return (
    <Suspense fallback={<RoomConnecting />}>
      <RoomPageInner />
    </Suspense>
  );
}
