'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Smile } from 'lucide-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { EmojiStyle, Theme } from 'emoji-picker-react';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

const VIEWPORT_MARGIN = 8;
const GAP = 8;
const MAX_WIDTH = 320;
const MAX_HEIGHT = 380;
const MIN_HEIGHT = 160;

type PanelRect = { top: number; left: number; width: number; height: number };

/**
 * Emoji button. Opens an Apple-style emoji panel (same Apple emoji artwork
 * used everywhere else via AppleEmojiText) and hands the picked emoji back.
 * The panel is portaled to <body> and positioned against the viewport (not the
 * chat panel's clipped/narrow container) so it always fits and never gets cut
 * off, on any screen size.
 *
 * Used twice in chat: composing a message, and picking a reaction beyond the
 * quick row, hence the overridable trigger.
 */
export default function EmojiPickerButton({
  onEmojiSelect,
  icon,
  ariaLabel = 'Add emoji',
  buttonClassName,
  onOpenChange,
}: {
  onEmojiSelect: (emoji: string) => void;
  /** Trigger contents. Defaults to the composer's smiley. */
  icon?: React.ReactNode;
  ariaLabel?: string;
  /** Replaces the default trigger styling outright when supplied. */
  buttonClassName?: string;
  /**
   * Fires as the panel opens and closes. A surrounding popover needs this: the
   * panel is portaled to <body>, so clicks inside it look like outside clicks
   * and would otherwise tear that popover (and this button) down mid-click.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);
  const [rect, setRect] = useState<PanelRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    const width = Math.min(MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);

    let left = btnRect.right - width;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - width - VIEWPORT_MARGIN));

    const desiredHeight = Math.min(MAX_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2);
    const spaceAbove = btnRect.top - GAP - VIEWPORT_MARGIN;
    const spaceBelow = viewportHeight - btnRect.bottom - GAP - VIEWPORT_MARGIN;

    let top: number;
    let height: number;
    if (spaceAbove >= desiredHeight || spaceAbove >= spaceBelow) {
      height = Math.max(MIN_HEIGHT, Math.min(desiredHeight, spaceAbove));
      top = btnRect.top - GAP - height;
    } else {
      height = Math.max(MIN_HEIGHT, Math.min(desiredHeight, spaceBelow));
      top = btnRect.bottom + GAP;
    }
    top = Math.max(VIEWPORT_MARGIN, top);

    setRect({ top, left, width, height });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleEmojiClick = (data: EmojiClickData) => {
    onEmojiSelect(data.emoji);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={
          buttonClassName ??
          `shrink-0 p-1 rounded-lg transition-all duration-150 active:scale-95 ${
            open ? 'text-primary' : 'text-muted-foreground hover:text-primary'
          }`
        }
        aria-label={ariaLabel}
      >
        {icon ?? <Smile size={15} />}
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 shadow-2xl rounded-xl overflow-hidden border border-border"
            style={
              {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                '--epr-bg-color': 'var(--card)',
                '--epr-category-label-bg-color': 'var(--card)',
                '--epr-picker-border-color': 'var(--border)',
                '--epr-text-color': 'var(--foreground)',
                '--epr-search-input-bg-color': 'var(--input)',
                '--epr-hover-bg-color': 'var(--muted)',
                '--epr-focus-bg-color': 'var(--muted)',
                '--epr-highlight-color': 'var(--primary)',
                '--epr-search-border-color': 'var(--ring)',
              } as React.CSSProperties
            }
          >
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              emojiStyle={EmojiStyle.APPLE}
              theme={Theme.DARK}
              lazyLoadEmojis
              searchDisabled={false}
              skinTonesDisabled
              previewConfig={{ showPreview: false }}
              width="100%"
              height="100%"
            />
          </div>,
          document.body
        )}
    </>
  );
}
