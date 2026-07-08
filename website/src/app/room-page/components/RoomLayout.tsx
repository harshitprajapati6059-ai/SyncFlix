'use client';

import React, { useState } from 'react';
import PlaybackPanel from './PlaybackPanel';
import UsersPanel from './UserPanel';
import EventLogPanel from './EventLogPanel';
import ChatPanel from './ChatPanel';
import ExtensionPanel from './ExtensionPanel';

type RightTab = 'users' | 'chat' | 'events';

export default function RoomLayout() {
  const [rightTab, setRightTab] = useState<RightTab>('users');

  const tabs: { id: RightTab; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'chat', label: 'Chat' },
    { id: 'events', label: 'Events' },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left column — playback + extension */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-border">
        <PlaybackPanel />
        <ExtensionPanel />
      </div>

      {/* Right column — tabbed panel */}
      <div className="w-80 xl:w-96 flex flex-col shrink-0 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0">
          {tabs.map((tab) => (
            <button
              key={`tab-${tab.id}`}
              onClick={() => setRightTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-all duration-150 border-b-2 ${
                rightTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {rightTab === 'users' && <UsersPanel />}
          {rightTab === 'chat' && <ChatPanel />}
          {rightTab === 'events' && <EventLogPanel />}
        </div>
      </div>
    </div>
  );
}
