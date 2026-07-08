'use client';

import React from 'react';
import { Users } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import RoleBadge from '@/components/ui/RoleBadge';
import ConnectionDot from '@/components/ui/ConnectionDot';
import { relativeTime } from '@/utils/time';

export default function UsersPanel() {
  const { users } = useRoom();

  const connectedCount = users?.filter((u) => u?.connected)?.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Users size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Connected Users
          </span>
        </div>
        <span className="text-xs font-mono-data font-semibold text-foreground bg-muted px-2 py-0.5 rounded-full">
          {connectedCount}
        </span>
      </div>
      {/* User list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {users?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <Users size={28} className="text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">No users connected yet</p>
          </div>
        ) : (
          <ul className="p-3 space-y-1">
            {users?.map((user) => (
              <li
                key={`user-${user?.userId}`}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors duration-150"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-foreground uppercase">
                      {user?.username?.slice(0, 2)}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <ConnectionDot
                        status={user?.connected ? 'connected' : 'disconnected'}
                        size="sm"
                      />
                    </span>
                  </div>

                  {/* Name + last seen */}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {user?.username}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {user?.connected ? 'Active now' : relativeTime(user?.lastSeen)}
                    </p>
                  </div>
                </div>

                <RoleBadge role={user?.role} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
