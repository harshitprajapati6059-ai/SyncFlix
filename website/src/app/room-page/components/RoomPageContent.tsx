'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <RoomHeader />
      <RoomLayout />
    </div>
  );
}

function RoomPageInner() {
  const searchParams = useSearchParams();
  const code = searchParams?.get('code') ?? 'X7P91Q';
  const role = searchParams?.get('role') === 'host' ? true : false;

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
