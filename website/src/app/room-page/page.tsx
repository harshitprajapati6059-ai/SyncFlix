import React from 'react';
import type { Metadata } from 'next';
import RoomPageContent from './components/RoomPageContent';

export const metadata: Metadata = {
  title: 'Watch Room',
  description: 'Your synchronized watch session. Playback stays in sync for everyone in the room.',
};

export default function RoomPage() {
  return <RoomPageContent />;
}
