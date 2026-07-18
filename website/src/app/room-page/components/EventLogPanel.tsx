'use client';

import React, { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import { getEventMeta } from '@/utils/eventColors';
import { formatTimestamp } from '@/utils/time';

export default function EventLogPanel() {
  const { events } = useRoom();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef?.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events?.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Event Log
          </span>
        </div>
        <span className="text-xs font-mono-data text-muted-foreground">
          {events?.length} events
        </span>
      </div>
      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-0.5">
        {events?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <Activity size={28} className="text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">No events yet</p>
          </div>
        ) : (
          events?.map((evt) => {
            const meta = getEventMeta(evt?.type);
            return (
              <div
                key={`evt-${evt?.id}`}
                className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors duration-100 event-row-enter"
              >
                {/* Dot */}
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-semibold ${meta.colorClass}`}>{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      by {evt?.username}
                    </span>
                  </div>

                  {/* Payload preview */}
                  {Object.keys(evt?.payload ?? {}).length > 0 && (
                    <p className="text-[10px] font-mono-data text-muted-foreground mt-0.5 truncate">
                      {Object.entries(evt?.payload ?? {})
                        ?.slice(0, 2)
                        ?.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                        ?.join(' ')}
                    </p>
                  )}
                </div>
                {/* Timestamp */}
                <span className="text-[10px] font-mono-data text-muted-foreground shrink-0 mt-0.5">
                  {formatTimestamp(evt?.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
