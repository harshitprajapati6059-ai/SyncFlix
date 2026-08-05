import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import JoinRoomContent from './components/JoinRoomContent';

export const metadata: Metadata = {
  title: 'Join a Room',
  description: 'Enter a 6-character room code to join a synchronized watch session.',
};

export default function JoinRoomPage() {
  // The form reads ?code= from an invite link via useSearchParams, which has to
  // sit under a Suspense boundary or the page can't be statically rendered.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen supports-[min-height:100dvh]:min-h-dvh bg-background" />
      }
    >
      <JoinRoomContent />
    </Suspense>
  );
}
