'use client';

import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import { formatTimestamp } from '@/utils/time';

export default function ChatPanel() {
  const { chatMessages, sendChatMessage, currentUser } = useRoom();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    sendChatMessage(msg);
    setInput('');
    // BACKEND: channel.send({ type: 'broadcast', event: 'CHAT_MESSAGE', payload: { message: msg } })
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <MessageSquare size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Chat
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-3">
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare size={28} className="text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">No messages yet</p>
          </div>
        ) : (
          chatMessages.map((msg) => {
            const isSelf = msg.userId === currentUser?.userId;
            return (
              <div
                key={`msg-${msg.id}`}
                className={`flex flex-col gap-0.5 ${isSelf ? 'items-end' : 'items-start'}`}
              >
                {!isSelf && (
                  <span className="text-[10px] text-muted-foreground font-medium px-1">
                    {msg.username}
                  </span>
                )}
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                    isSelf
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}
                >
                  {msg.message}
                </div>
                <span className="text-[9px] text-muted-foreground px-1 font-mono-data">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <div className="flex items-center gap-2 bg-input border border-border rounded-xl px-3 py-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring transition-all duration-150">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            maxLength={200}
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-primary disabled:opacity-30 transition-all duration-150 active:scale-95"
            aria-label="Send message"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
