'use client';

/**
 * One chat message, with everything you can do to it.
 *
 * Reply and react are reachable two ways, because the two form factors want
 * different things:
 *   - pointer devices: buttons that fade in beside the bubble on hover
 *   - touch devices:   swipe the message left to reply, press and hold for the
 *                      actions panel
 *
 * The swipe deliberately gives up the moment the finger moves more vertically
 * than horizontally. The messages list is a scroller first, and a swipe that
 * fights the scroll is worse than no swipe at all.
 *
 * Sizing note: every level from the row down is explicitly full-width, and the
 * bubble is capped as a share of that. An earlier version let the row shrink to
 * fit its content, which made the bubble's percentage cap resolve against an
 * indefinite width and collapse it to one character per line in a narrow
 * window.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, MoreVertical, Plus, SmilePlus, Trash2, Users } from 'lucide-react';
import type { ChatMessage } from '@/types/room';
import { AppleEmojiText } from '@/components/AppleEmoji';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import AnchoredPopover from '@/components/AnchoredPopover';
import { formatTimestamp } from '@/utils/time';
import { MENTION_EVERYONE, parseMessageSegments, type MentionTarget } from '@/utils/mentions';

/** The one-tap reactions, in the order Instagram-style bars tend to run. */
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

/** Movement before we commit to "this is a swipe, not a scroll". */
const DIRECTION_LOCK_PX = 8;
/** How far the message will travel, however hard you swipe. */
const SWIPE_MAX_PX = 72;
/** Travel past which releasing opens the reply composer. */
const SWIPE_TRIGGER_PX = 48;
/** Hold this long without moving to open the actions panel. */
const LONG_PRESS_MS = 420;
/**
 * How wide the bubble is allowed to get.
 *
 * Below md the hover buttons aren't rendered at all, so the bubble gets the
 * usual share of the row. From md up it gives back exactly the 76px those three
 * buttons occupy, so the two never compete for the same pixels and a long word
 * can't push the buttons off the edge of a narrow column.
 */
const BUBBLE_WIDTH = 'max-w-[85%] md:max-w-[calc(100%-76px)]';

interface Props {
  message: ChatMessage;
  isSelf: boolean;
  myUserId: string | undefined;
  /** Roster used to re-parse mention spans for highlighting. */
  mentionTargets: MentionTarget[];
  /** True when this message pings the local user. */
  pingsMe: boolean;
  /** True while this message is flashing after a jump from a reply quote. */
  highlighted: boolean;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  onJumpToQuoted: (messageId: string) => void;
  onMentionUser: (username: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onDeleteForEveryone: (messageId: string) => void;
  registerEl: (id: string, el: HTMLDivElement | null) => void;
}

/** Message text with @mentions picked out from the plain runs around them. */
function MessageBody({
  text,
  targets,
  myUserId,
  isSelf,
}: {
  text: string;
  targets: MentionTarget[];
  myUserId: string | undefined;
  isSelf: boolean;
}) {
  const segments = useMemo(() => parseMessageSegments(text, targets), [text, targets]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'text' ? (
          <AppleEmojiText key={`seg-${i}`} text={segment.text} size={14} />
        ) : (
          <span
            key={`seg-${i}`}
            className={`font-semibold rounded px-0.5 ${
              isSelf
                ? 'bg-primary-foreground/15'
                : segment.userId === myUserId || segment.userId === MENTION_EVERYONE
                  ? 'text-[var(--status-warning)] bg-[var(--status-warning-bg)]'
                  : 'text-primary'
            }`}
          >
            {segment.text}
          </span>
        )
      )}
    </>
  );
}

export default function ChatMessageRow({
  message,
  isSelf,
  myUserId,
  mentionTargets,
  pingsMe,
  highlighted,
  onReply,
  onReact,
  onJumpToQuoted,
  onMentionUser,
  onDeleteForMe,
  onDeleteForEveryone,
  registerEl,
}: Props) {
  const [dragX, setDragX] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  /** Arms the second tap on "Delete for everyone", which cannot be undone. */
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  /** True while the nested emoji picker owns the pointer. See AnchoredPopover. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const deleted = message.deleted === true;

  // Live gesture bookkeeping. A ref, not state: it changes on every touchmove
  // and none of it belongs on screen.
  const gesture = useRef<{
    x: number;
    y: number;
    /** Set once the finger has committed to a horizontal swipe. */
    swiping: boolean;
    /** Set once we've buzzed for crossing the trigger, so it buzzes once. */
    buzzed: boolean;
    dragX: number;
  } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  useEffect(() => cancelLongPress, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setConfirmingWipe(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    gesture.current = {
      x: touch.clientX,
      y: touch.clientY,
      swiping: false,
      buzzed: false,
      dragX: 0,
    };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      // A hold opens the actions panel, so the swipe is off for this touch.
      gesture.current = null;
      setDragX(0);
      setPanelOpen(true);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const start = gesture.current;
    if (!start) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (!start.swiping) {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      cancelLongPress();
      // Vertical wins: hand the touch back to the scroller and stay out of it.
      if (Math.abs(dx) <= Math.abs(dy) || dx > 0) {
        gesture.current = null;
        setDragX(0);
        return;
      }
      start.swiping = true;
    }

    // Leftward only, and rubber-banded at the far end so it can't run away.
    const next = Math.max(dx, -SWIPE_MAX_PX);
    start.dragX = Math.min(0, next);
    if (!start.buzzed && start.dragX <= -SWIPE_TRIGGER_PX) {
      start.buzzed = true;
      navigator.vibrate?.(10);
    }
    setDragX(start.dragX);
  }, []);

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    const start = gesture.current;
    gesture.current = null;
    setDragX(0);
    if (start?.swiping && start.dragX <= -SWIPE_TRIGGER_PX && !deleted) onReply(message);
  }, [message, onReply, deleted]);

  const react = useCallback(
    (emoji: string) => {
      onReact(message.id, emoji);
      closePanel();
    },
    [message.id, onReact, closePanel]
  );

  const reactions = useMemo(
    () => Object.entries(message.reactions ?? {}).filter(([, users]) => users.length > 0),
    [message.reactions]
  );

  // 0 to 1 across the swipe, so the reply icon fades and grows with the pull.
  const swipeProgress = Math.min(1, Math.abs(dragX) / SWIPE_TRIGGER_PX);
  const quote = message.replyTo;
  const menuItemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] font-medium transition-colors';

  return (
    <div
      ref={(el) => {
        registerEl(message.id, el);
      }}
      className="relative w-full"
      // Lets the browser keep vertical scrolling for itself while we take the
      // horizontal axis. Without it the swipe stutters against native scrolling.
      style={{ touchAction: 'pan-y' }}
    >
      {/* Revealed from under the message as it slides left. */}
      {dragX < 0 && (
        <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none">
          <span
            className={`flex items-center justify-center h-7 w-7 rounded-full ${
              swipeProgress >= 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
            style={{ opacity: swipeProgress, transform: `scale(${0.7 + swipeProgress * 0.3})` }}
          >
            <CornerUpLeft size={13} />
          </span>
        </div>
      )}

      <div
        ref={wrapperRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className={`flex w-full min-w-0 flex-col gap-0.5 ${isSelf ? 'items-end' : 'items-start'}`}
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragX ? undefined : 'transform 180ms ease-out',
        }}
      >
        {!isSelf && (
          <button
            type="button"
            onClick={() => onMentionUser(message.username)}
            title={`Mention ${message.username}`}
            className="max-w-full truncate text-[10px] text-muted-foreground font-medium px-1 hover:text-primary transition-colors"
          >
            {message.username}
          </button>
        )}

        {/* Quote of whatever this replies to. */}
        {quote && !deleted && (
          <button
            type="button"
            onClick={() => onJumpToQuoted(quote.id)}
            className={`flex max-w-[85%] min-w-0 items-stretch gap-1.5 text-left rounded-lg overflow-hidden bg-muted/60 hover:bg-muted transition-colors ${
              isSelf ? 'rounded-br-sm' : 'rounded-bl-sm'
            }`}
          >
            <span className="w-0.5 shrink-0 bg-primary" />
            <span className="min-w-0 py-1 pr-2">
              <span className="block text-[10px] font-semibold text-primary truncate">
                {quote.userId === myUserId ? 'You' : quote.username}
              </span>
              <span className="block text-[10px] text-muted-foreground truncate">
                <AppleEmojiText text={quote.message} size={11} />
              </span>
            </span>
          </button>
        )}

        {/* Full width, so the bubble's percentage cap has something real to
            resolve against. Alignment comes from the reversal, not from
            letting this row shrink to its contents. */}
        <div
          className={`group relative flex w-full min-w-0 items-end gap-1 ${
            isSelf ? 'flex-row-reverse' : ''
          }`}
        >
          <div
            ref={bubbleRef}
            className={`min-w-0 ${BUBBLE_WIDTH} px-3 py-2 rounded-2xl text-xs leading-relaxed break-words transition-shadow ${
              deleted
                ? 'bg-muted/40 text-muted-foreground italic ' +
                  (isSelf ? 'rounded-br-sm' : 'rounded-bl-sm')
                : isSelf
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : pingsMe
                    ? 'bg-[var(--status-warning-bg)] text-foreground rounded-bl-sm ring-1 ring-[var(--status-warning)]/40'
                    : 'bg-muted text-foreground rounded-bl-sm'
            } ${highlighted ? 'ring-2 ring-primary' : ''}`}
          >
            {deleted ? (
              <span className="flex items-center gap-1.5">
                <Trash2 size={11} className="shrink-0" />
                {isSelf ? 'You deleted this message' : 'This message was deleted'}
              </span>
            ) : (
              <MessageBody
                text={message.message}
                targets={mentionTargets}
                myUserId={myUserId}
                isSelf={isSelf}
              />
            )}
          </div>

          {/* Pointer-device affordances. Touch gets the swipe and the hold. */}
          <div className="hidden md:flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
            {!deleted && (
              <>
                <button
                  type="button"
                  onClick={() => setPanelOpen((open) => !open)}
                  aria-label="React to message"
                  className="p-1 rounded-lg text-muted-foreground hover:text-primary transition-colors"
                >
                  <SmilePlus size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onReply(message)}
                  aria-label="Reply to message"
                  className="p-1 rounded-lg text-muted-foreground hover:text-primary transition-colors"
                >
                  <CornerUpLeft size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-label="More actions"
              aria-expanded={panelOpen}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreVertical size={13} />
            </button>
          </div>

          {/* Portaled and viewport-clamped, so it lands on whichever side has
              room instead of running off the edge of a narrow column. */}
          <AnchoredPopover
            anchorRef={bubbleRef}
            open={panelOpen}
            onClose={closePanel}
            align={isSelf ? 'end' : 'start'}
            holdOpen={pickerOpen}
            className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden fade-in-up"
          >
            {!deleted && (
              <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={`quick-${emoji}`}
                    type="button"
                    onClick={() => react(emoji)}
                    className="p-1 rounded-full hover:bg-muted transition-all duration-100 active:scale-90"
                    aria-label={`React ${emoji}`}
                  >
                    <AppleEmojiText text={emoji} size={18} />
                  </button>
                ))}
                <EmojiPickerButton
                  onEmojiSelect={react}
                  onOpenChange={setPickerOpen}
                  ariaLabel="More reactions"
                  icon={<Plus size={14} />}
                  buttonClassName="p-1 rounded-full text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                />
              </div>
            )}

            <div className="py-1 min-w-[168px]">
              {!deleted && (
                <button
                  type="button"
                  onClick={() => {
                    onReply(message);
                    closePanel();
                  }}
                  className={`${menuItemClass} text-foreground hover:bg-muted`}
                >
                  <CornerUpLeft size={13} className="shrink-0 text-muted-foreground" />
                  Reply
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onDeleteForMe(message.id);
                  closePanel();
                }}
                className={`${menuItemClass} text-foreground hover:bg-muted`}
              >
                <Trash2 size={13} className="shrink-0 text-muted-foreground" />
                Delete for me
              </button>
              {isSelf && !deleted && (
                <button
                  type="button"
                  onClick={() => {
                    // Arms first, fires second: this one reaches every screen in
                    // the room and cannot be taken back.
                    if (!confirmingWipe) {
                      setConfirmingWipe(true);
                      return;
                    }
                    onDeleteForEveryone(message.id);
                    closePanel();
                  }}
                  className={`${menuItemClass} ${
                    confirmingWipe
                      ? 'text-[var(--status-error)] bg-[var(--status-error-bg)]'
                      : 'text-[var(--status-error)] hover:bg-[var(--status-error-bg)]'
                  }`}
                >
                  <Users size={13} className="shrink-0" />
                  {confirmingWipe ? 'Tap again to confirm' : 'Delete for everyone'}
                </button>
              )}
            </div>
          </AnchoredPopover>
        </div>

        {/* Reaction chips, tucked under the bubble's edge. */}
        {reactions.length > 0 && !deleted && (
          <div className={`flex w-full flex-wrap gap-1 -mt-1 px-1 ${isSelf ? 'justify-end' : ''}`}>
            {reactions.map(([emoji, userIds]) => {
              const mine = myUserId !== undefined && userIds.includes(myUserId);
              return (
                <button
                  key={`reaction-${emoji}`}
                  type="button"
                  onClick={() => onReact(message.id, emoji)}
                  title={mine ? 'Remove your reaction' : 'React'}
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-all duration-150 active:scale-95 ${
                    mine
                      ? 'border-primary bg-primary/15'
                      : 'border-border bg-card hover:border-muted-foreground'
                  }`}
                >
                  <AppleEmojiText text={emoji} size={12} />
                  {userIds.length > 1 && (
                    <span className="text-[9px] font-semibold text-muted-foreground font-mono-data">
                      {userIds.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <span className="text-[9px] text-muted-foreground px-1 font-mono-data">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </div>
  );
}
