'use client';

import React, { useState } from 'react';
import { MonitorPlay, ChevronDown, ChevronUp } from 'lucide-react';
import PlaybackPanel from './PlaybackPanel';
import UsersPanel from './UserPanel';
import EventLogPanel from './EventLogPanel';
import ChatPanel from './ChatPanel';
import ExtensionPanel from './ExtensionPanel';
import InPagePlayer from './InPagePlayer';
import VideoCallPanel from './VideoCallPanel';
import { useRoom } from '@/context/RoomContext';

type Tab = 'playback' | 'users' | 'chat' | 'events' | 'video';
type RightTab = Exclude<Tab, 'playback'>;

export default function RoomLayout() {
  const [tab, setTab] = useState<Tab>('playback');
  // The in-page player is opt-in: mounting it is what claims the room's video
  // slot, so it stays closed until someone asks for it rather than being the
  // default surface for every mobile visitor.
  const [watchHereOpen, setWatchHereOpen] = useState(false);
  const { extensionState, hostVideo, videoCallState } = useRoom();

  // Only one thing may drive playback. When the extension is attached it owns a
  // real video tab and the in-page player would be a second, competing source;
  // otherwise (always, on mobile) the in-page player is the way to watch.
  const canWatchHere = extensionState.status !== 'connected';
  const showInPagePlayer = canWatchHere && watchHereOpen;
  // Closed player + a video already running in the room: the entry point is the
  // only thing telling a viewer there is something to open.
  const hostIsPlaying = Boolean(hostVideo.videoId);

  // On md+ the playback column is always visible, so the right panel
  // falls back to 'users' while the mobile-only 'playback' tab is active.
  const rightTab: RightTab = tab === 'playback' ? 'users' : tab;

  const mobileTabs: { id: Tab; label: string }[] = [
    { id: 'playback', label: 'Playback' },
    { id: 'users', label: 'Users' },
    { id: 'video', label: 'Video' },
    { id: 'chat', label: 'Chat' },
    { id: 'events', label: 'Events' },
  ];

  const rightTabs: { id: RightTab; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'video', label: 'Video' },
    { id: 'chat', label: 'Chat' },
    { id: 'events', label: 'Events' },
  ];

  const tabButtonClass = (active: boolean) =>
    `flex-1 py-2.5 text-xs font-semibold transition-all duration-150 border-b-2 ${
      active
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      {/* Mobile tab bar — playback included as a tab below md */}
      <div className="flex md:hidden border-b border-border shrink-0">
        {mobileTabs.map((t) => (
          <button
            key={`mtab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`${tabButtonClass(tab === t.id)} relative`}
          >
            {t.label}
            {t.id === 'video' && videoCallState.inCall && (
              <span className="absolute top-1.5 right-1/2 translate-x-4 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Left column — playback + extension */}
      <div
        className={`${
          tab === 'playback' ? 'flex' : 'hidden'
        } md:flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden md:border-r border-border`}
      >
        {canWatchHere && (
          <div className="px-4 sm:px-5 pt-4 shrink-0">
            <button
              type="button"
              onClick={() => setWatchHereOpen((open) => !open)}
              aria-expanded={watchHereOpen}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                watchHereOpen
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <MonitorPlay size={16} className="text-primary shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">Watch here</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {watchHereOpen
                    ? 'Playing inside this room. Close it to watch elsewhere.'
                    : hostIsPlaying
                      ? 'A video is playing in this room. Open the player to join in.'
                      : 'Play a YouTube link right here, no extension needed.'}
                </span>
              </span>
              {!watchHereOpen && hostIsPlaying && (
                <span className="h-2 w-2 rounded-full bg-primary shrink-0 animate-pulse" />
              )}
              {watchHereOpen ? (
                <ChevronUp size={16} className="text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown size={16} className="text-muted-foreground shrink-0" />
              )}
            </button>
          </div>
        )}

        {showInPagePlayer && <InPagePlayer />}
        <PlaybackPanel />
        <ExtensionPanel />
      </div>

      {/* Right column — tabbed panel */}
      <div
        className={`${
          tab === 'playback' ? 'hidden' : 'flex'
        } md:flex w-full md:w-80 xl:w-96 flex-col flex-1 md:flex-none min-w-0 min-h-0 overflow-hidden`}
      >
        {/* Desktop tab bar */}
        <div className="hidden md:flex border-b border-border shrink-0">
          {rightTabs.map((t) => (
            <button
              key={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`${tabButtonClass(rightTab === t.id)} relative`}
            >
              {t.label}
              {t.id === 'video' && videoCallState.inCall && (
                <span className="absolute top-1.5 right-1/2 translate-x-4 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {rightTab === 'users' && <UsersPanel />}
          {rightTab === 'video' && <VideoCallPanel />}
          {rightTab === 'chat' && <ChatPanel />}
          {rightTab === 'events' && <EventLogPanel />}
        </div>
      </div>
    </div>
  );
}
