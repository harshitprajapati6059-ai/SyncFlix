'use client';

/**
 * Chat notifications: everything that tells you a message arrived while you
 * weren't looking at the chat.
 *
 * Three surfaces, picked by where your attention actually is:
 *   - chat open, tab in front   → nothing; you can already see it
 *   - another tab of the room   → an in-app toast with a jump-to-chat action
 *   - browser tab in background → a desktop notification, plus a count in the
 *                                 document title so the tab strip shows it
 *
 * The unread counts it returns drive the badge on the Chat tab in either case.
 *
 * This lives outside RoomContext deliberately: only the layout knows which tab
 * is showing, and that is the whole input to the decision.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRoom } from '@/context/RoomContext';
import { mentionsUser } from '@/utils/mentions';
import { showChatNotification } from '@/services/notifications';

/** One toast id for all of chat, so a burst replaces itself instead of stacking. */
const CHAT_TOAST_ID = 'syncflix-chat-incoming';

/** How much of a message a toast or notification shows. */
const PREVIEW_LENGTH = 90;

export interface ChatNotifications {
  /** Messages from other people since the chat was last on screen. */
  unreadCount: number;
  /** How many of those pinged you by name or via @everyone. */
  unreadMentions: number;
}

interface Options {
  /** True when the chat panel is the visible tab. */
  chatOpen: boolean;
  /** Bring the chat tab to the front. Wired to the toast's action button. */
  onOpenChat: () => void;
}

function preview(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

export function useChatNotifications({ chatOpen, onOpenChat }: Options): ChatNotifications {
  const { chatMessages, currentUser } = useRoom();
  const myId = currentUser?.userId;

  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);

  // How far down the message list we've already made a decision. Not state:
  // advancing it must not itself schedule a render.
  const processedRef = useRef(0);
  const onOpenChatRef = useRef(onOpenChat);
  onOpenChatRef.current = onOpenChat;

  // Whether the browser tab is in front. State rather than a ref because the
  // notification effect's behaviour changes the moment it flips.
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // "You can see the chat" needs both: the panel showing *and* the tab in front.
  const chatVisible = chatOpen && tabVisible;

  // ─── Announce whatever just arrived ────────────────────────────────────────
  useEffect(() => {
    if (processedRef.current > chatMessages.length) processedRef.current = chatMessages.length;
    if (processedRef.current === chatMessages.length) return;

    const fresh = chatMessages.slice(processedRef.current);
    processedRef.current = chatMessages.length;
    // Read while visible: seen, not unread. (The reset effect below keeps the
    // counters at zero for as long as that stays true.)
    if (chatVisible) return;

    const incoming = fresh.filter((msg) => msg.userId !== myId);
    if (incoming.length === 0) return;

    const mentioned = incoming.filter((msg) => mentionsUser(msg.mentions, myId));
    setUnreadCount((count) => count + incoming.length);
    if (mentioned.length > 0) setUnreadMentions((count) => count + mentioned.length);

    // A ping outranks whatever else came in alongside it.
    const isMention = mentioned.length > 0;
    const latest = isMention ? mentioned[mentioned.length - 1] : incoming[incoming.length - 1];
    const body = preview(latest.message);

    if (!tabVisible) {
      showChatNotification(
        isMention ? `${latest.username} mentioned you` : `${latest.username} in your room`,
        body
      );
      return;
    }

    toast(isMention ? `${latest.username} mentioned you` : latest.username, {
      id: CHAT_TOAST_ID,
      description: body,
      duration: isMention ? 8000 : 4500,
      action: { label: 'Open chat', onClick: () => onOpenChatRef.current() },
      // Pings get picked out, so a mention isn't lost in a run of ordinary chat.
      style: isMention ? { border: '1px solid var(--status-warning)' } : undefined,
    });
  }, [chatMessages, chatVisible, tabVisible, myId]);

  // ─── Clear once the chat is actually on screen ─────────────────────────────
  // Re-runs on every new message too, so messages arriving while you're reading
  // never accumulate a badge you'd have to dismiss.
  useEffect(() => {
    if (!chatVisible) return;
    processedRef.current = chatMessages.length;
    setUnreadCount(0);
    setUnreadMentions(0);
  }, [chatVisible, chatMessages.length]);

  // ─── Unread count in the document title ────────────────────────────────────
  // The only signal that survives the tab being in the background with
  // notifications turned off.
  const baseTitleRef = useRef<string>('');
  useEffect(() => {
    baseTitleRef.current = document.title;
    return () => {
      document.title = baseTitleRef.current;
    };
  }, []);
  useEffect(() => {
    const base = baseTitleRef.current;
    if (!base) return;
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  return { unreadCount, unreadMentions };
}
