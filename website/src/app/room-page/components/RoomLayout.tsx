'use client';

import React, { useState } from 'react';
import PlaybackPanel from './PlaybackPanel';
import UsersPanel from './UserPanel';
import EventLogPanel from './EventLogPanel';
import ChatPanel from './ChatPanel';
import ExtensionPanel from './ExtensionPanel';

type Tab = 'playback' | 'users' | 'chat' | 'events';
type RightTab = Exclude<Tab, 'playback'>;

export default function RoomLayout() {
  const [tab, setTab] = useState<Tab>('playback');

  // On md+ the playback column is always visible, so the right panel
  // falls back to 'users' while the mobile-only 'playback' tab is active.
  const rightTab: RightTab = tab === 'playback' ? 'users' : tab;

  const mobileTabs: { id: Tab; label: string }[] = [
    { id: 'playback', label: 'Playback' },
    { id: 'users', label: 'Users' },
    { id: 'chat', label: 'Chat' },
    { id: 'events', label: 'Events' },
  ];

  const rightTabs: { id: RightTab; label: string }[] = [
    { id: 'users', label: 'Users' },
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
            className={tabButtonClass(tab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Left column — playback + extension */}
      <div
        className={`${
          tab === 'playback' ? 'flex' : 'hidden'
        } md:flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden md:border-r border-border`}
      >
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
              className={tabButtonClass(rightTab === t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {rightTab === 'users' && <UsersPanel />}
          {rightTab === 'chat' && <ChatPanel />}
          {rightTab === 'events' && <EventLogPanel />}
        </div>
      </div>
    </div>
  );
}
