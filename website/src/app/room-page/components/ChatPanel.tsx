'use client';

/**
 * Room chat.
 *
 * The panel owns everything about composing and reading; each message's own
 * gestures live in ChatMessageRow. Three things are worth knowing here:
 *
 *   - Replies quote a snapshot of the original rather than a pointer to it.
 *     There is no history server, so a pointer would resolve to nothing for
 *     anyone who joined after the original was sent.
 *   - The mention popup matches against the live presence roster, which is the
 *     only source of names in a room with no accounts.
 *   - Auto-scroll only follows the conversation when you were already at the
 *     bottom. Scrolling up to re-read something and being yanked back down by
 *     someone else's message is the worst thing a chat panel can do.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { ArrowDown, AtSign, Bell, BellOff, MessageSquare, Send, X } from 'lucide-react';
import { useRoom } from '@/context/RoomContext';
import type { ChatMessage, ChatReplyRef } from '@/types/room';
import { AppleEmojiText } from '@/components/AppleEmoji';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import ChatMessageRow from './ChatMessageRow';
import {
  activeMentionQuery,
  applyMention,
  matchMentionTargets,
  mentionsUser,
  MENTION_EVERYONE,
  type MentionQuery,
  type MentionTarget,
} from '@/utils/mentions';
import {
  desktopNotificationsEnabled,
  notificationPermission,
  requestNotificationPermission,
  setDesktopNotificationsEnabled,
  type NotificationPermissionState,
} from '@/services/notifications';

/** Mentions cost characters, so there is a little more room than a bare line. */
const MAX_MESSAGE_LENGTH = 300;
/** Within this far of the bottom counts as "following the conversation". */
const AT_BOTTOM_SLACK_PX = 64;
/** How long a jumped-to message keeps its ring. */
const HIGHLIGHT_MS = 1600;

export default function ChatPanel() {
  const {
    chatMessages,
    sendChatMessage,
    toggleReaction,
    deleteMessageForMe,
    deleteMessageForEveryone,
    currentUser,
    users,
  } = useRoom();
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageEls = useRef(new Map<string, HTMLDivElement>());

  const myId = currentUser?.userId;

  // ─── Mention targets ───────────────────────────────────────────────────────
  // Everyone in the room resolves for *rendering* (including us, since being
  // pinged is the point), but the picker leaves us out; nobody pings themselves.
  const mentionTargets = useMemo<MentionTarget[]>(
    () => users.map((user) => ({ userId: user.userId, username: user.username })),
    [users]
  );
  const pickerTargets = useMemo(
    () => mentionTargets.filter((target) => target.userId !== myId),
    [mentionTargets, myId]
  );

  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMatches = useMemo(
    () => (mention ? matchMentionTargets(mention.query, pickerTargets) : []),
    [mention, pickerTargets]
  );
  const mentionOpen = mention !== null && mentionMatches.length > 0;
  // Clamp rather than reset, so the list re-filtering under the cursor as you
  // type never leaves the selection pointing past the end.
  const activeIndex = Math.min(mentionIndex, Math.max(0, mentionMatches.length - 1));

  const refreshMention = useCallback((value: string, caret: number | null) => {
    setMention(caret === null ? null : activeMentionQuery(value, caret));
  }, []);

  // ─── Scroll position ───────────────────────────────────────────────────────
  const atBottomRef = useRef(true);
  const [missedBelow, setMissedBelow] = useState(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    atBottomRef.current = true;
    setMissedBelow(0);
  }, []);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= AT_BOTTOM_SLACK_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setMissedBelow(0);
  }, []);

  // Only a *growing* list is new conversation. Deleting for yourself shortens
  // it, and that must not read as an arrival to scroll to or count as missed.
  const seenLengthRef = useRef(0);
  useEffect(() => {
    const grew = chatMessages.length > seenLengthRef.current;
    const firstBatch = seenLengthRef.current === 0;
    seenLengthRef.current = chatMessages.length;
    if (!grew || chatMessages.length === 0) return;

    const last = chatMessages[chatMessages.length - 1];
    // Our own message always pulls the view down, since we just pressed send.
    if (atBottomRef.current || last.userId === myId) {
      scrollToBottom(firstBatch ? 'auto' : 'smooth');
    } else {
      setMissedBelow((count) => count + 1);
    }
    // Length alone: reactions and deletions mutate the array in place, and
    // neither should move anyone's scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, myId, scrollToBottom]);

  // ─── Reply quotes ──────────────────────────────────────────────────────────
  const registerEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) messageEls.current.set(id, el);
    else messageEls.current.delete(id);
  }, []);

  const startReply = useCallback((message: ChatMessage) => {
    setReplyTo({
      id: message.id,
      userId: message.userId,
      username: message.username,
      message: message.message,
    });
    inputRef.current?.focus();
  }, []);

  const handleDeleteForMe = useCallback(
    (messageId: string) => {
      deleteMessageForMe(messageId);
      // Don't leave the composer quoting something this client no longer has.
      setReplyTo((current) => (current?.id === messageId ? null : current));
    },
    [deleteMessageForMe]
  );

  const jumpToQuoted = useCallback((messageId: string) => {
    const el = messageEls.current.get(messageId);
    // Not in our list: sent before we joined, since there is no chat history.
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
  }, []);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // ─── Composing ─────────────────────────────────────────────────────────────
  const insertAtCaret = useCallback(
    (text: string) => {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? input.length;
      const next = `${input.slice(0, caret)}${text}${input.slice(caret)}`.slice(
        0,
        MAX_MESSAGE_LENGTH
      );
      setInput(next);
      const nextCaret = Math.min(caret + text.length, next.length);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(nextCaret, nextCaret);
        refreshMention(next, nextCaret);
      });
    },
    [input, refreshMention]
  );

  const chooseMention = useCallback(
    (target: MentionTarget) => {
      if (!mention) return;
      const { text, caret } = applyMention(input, mention, target.username);
      const clipped = text.slice(0, MAX_MESSAGE_LENGTH);
      setInput(clipped);
      setMention(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const at = Math.min(caret, clipped.length);
        inputRef.current?.setSelectionRange(at, at);
      });
    },
    [input, mention]
  );

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;
    sendChatMessage(msg, replyTo);
    setInput('');
    setReplyTo(null);
    setMention(null);
  }, [input, replyTo, sendChatMessage]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseMention(mentionMatches[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      setReplyTo(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Desktop notification toggle ───────────────────────────────────────────
  // Read in an effect, not during render: both values come from browser APIs
  // the server can't see, and reading them inline would break hydration.
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  useEffect(() => {
    setPermission(notificationPermission());
    setNotifyEnabled(desktopNotificationsEnabled());
  }, []);

  const notifyingOn = permission === 'granted' && notifyEnabled;
  const handleNotifyToggle = useCallback(async () => {
    if (permission === 'default') {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result === 'granted') {
        setDesktopNotificationsEnabled(true);
        setNotifyEnabled(true);
      }
      return;
    }
    if (permission !== 'granted') return; // denied at the browser level
    const next = !notifyEnabled;
    setDesktopNotificationsEnabled(next);
    setNotifyEnabled(next);
  }, [permission, notifyEnabled]);

  const notifyTitle =
    permission === 'denied'
      ? 'Notifications are blocked for this site in your browser settings'
      : permission === 'default'
        ? 'Get notified when the tab is in the background'
        : notifyingOn
          ? 'Background notifications on'
          : 'Background notifications off';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Chat
          </span>
        </div>
        {permission !== 'unsupported' && (
          <button
            type="button"
            onClick={handleNotifyToggle}
            disabled={permission === 'denied'}
            title={notifyTitle}
            aria-label={notifyTitle}
            aria-pressed={notifyingOn}
            className={`shrink-0 p-1 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              notifyingOn ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {notifyingOn ? <Bell size={13} /> : <BellOff size={13} />}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto scrollbar-thin px-3 py-2 space-y-3"
        >
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <MessageSquare size={28} className="text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">No messages yet</p>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                Swipe a message left to reply, hold it to react, and type @ to ping someone.
              </p>
            </div>
          ) : (
            chatMessages.map((msg) => (
              <ChatMessageRow
                key={`msg-${msg.id}`}
                message={msg}
                isSelf={msg.userId === myId}
                myUserId={myId}
                mentionTargets={mentionTargets}
                pingsMe={msg.userId !== myId && mentionsUser(msg.mentions, myId)}
                highlighted={highlightId === msg.id}
                onReply={startReply}
                onReact={toggleReaction}
                onJumpToQuoted={jumpToQuoted}
                onMentionUser={(username) => insertAtCaret(`@${username} `)}
                onDeleteForMe={handleDeleteForMe}
                onDeleteForEveryone={deleteMessageForEveryone}
                registerEl={registerEl}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Only shown when new messages landed off-screen while reading back. */}
        {missedBelow > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] font-semibold text-foreground shadow-lg fade-in-up"
          >
            <ArrowDown size={11} className="text-primary" />
            {missedBelow} new {missedBelow === 1 ? 'message' : 'messages'}
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        {replyTo && (
          <div className="flex items-stretch gap-1.5 mb-2 rounded-lg overflow-hidden bg-muted/60">
            <span className="w-0.5 shrink-0 bg-primary" />
            <div className="min-w-0 flex-1 py-1.5">
              <p className="text-[10px] font-semibold text-primary truncate">
                Replying to {replyTo.userId === myId ? 'yourself' : replyTo.username}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                <AppleEmojiText text={replyTo.message} size={11} />
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="shrink-0 px-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="relative">
          {mentionOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 max-h-44 overflow-y-auto scrollbar-thin rounded-xl border border-border bg-card shadow-xl z-30 fade-in-up">
              {mentionMatches.map((target, i) => (
                <button
                  key={`mention-${target.userId}`}
                  type="button"
                  // mousedown, not click: the input's blur would otherwise tear
                  // the popup down before the click ever landed.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseMention(target);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    i === activeIndex ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold uppercase text-foreground">
                    {target.userId === MENTION_EVERYONE ? (
                      <AtSign size={11} className="text-primary" />
                    ) : (
                      target.username.slice(0, 2)
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-foreground truncate">
                      {target.username}
                    </span>
                    {target.userId === MENTION_EVERYONE && (
                      <span className="block text-[9px] text-muted-foreground">
                        Ping everyone in the room
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 bg-input border border-border rounded-xl px-3 py-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring transition-all duration-150">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                refreshMention(e.target.value, e.target.selectionStart);
              }}
              onKeyUp={(e) => refreshMention(e.currentTarget.value, e.currentTarget.selectionStart)}
              onClick={(e) => refreshMention(e.currentTarget.value, e.currentTarget.selectionStart)}
              onBlur={() => setMention(null)}
              onKeyDown={handleKeyDown}
              placeholder={replyTo ? `Reply to ${replyTo.username}...` : 'Message...'}
              maxLength={MAX_MESSAGE_LENGTH}
              className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
            <button
              type="button"
              onClick={() => insertAtCaret('@')}
              aria-label="Mention someone"
              className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-primary transition-all duration-150 active:scale-95"
            >
              <AtSign size={14} />
            </button>
            <EmojiPickerButton onEmojiSelect={(emoji) => insertAtCaret(emoji)} />
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
    </div>
  );
}
