import React from 'react';
import type { Metadata } from 'next';
import JoinRoomContent from './components/JoinRoomContent';

export const metadata: Metadata = {
  title: 'Join a Room',
  description: 'Enter a 6-character room code to join a synchronized watch session.',
};

export default function JoinRoomPage() {
  return <JoinRoomContent />;
}
