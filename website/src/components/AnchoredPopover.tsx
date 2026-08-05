'use client';

/**
 * A panel pinned to an anchor element, positioned against the viewport.
 *
 * Chat lives in a narrow, clipped, scrolling column, which rules out the
 * obvious `absolute bottom-full` approach: a panel wider than its own message
 * runs straight off the side of the screen, and one near the top of the list
 * gets cut off by the scroller. So the panel is portaled to <body>, measured
 * once it exists, and then clamped into the viewport:
 *
 *   - horizontally: it prefers the requested alignment and slides back inside
 *     the margin if that would overhang either edge
 *   - vertically:   above the anchor when there is room, below when there isn't
 *
 * It re-measures on scroll and resize, so a panel stays glued to its message
 * while the conversation moves underneath it.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Closest the panel is allowed to get to any viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Breathing room between the anchor and the panel. */
const ANCHOR_GAP = 6;

export type PopoverAlign = 'start' | 'center' | 'end';

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Which anchor edge the panel lines up with before clamping. */
  align?: PopoverAlign;
  /**
   * Suppresses the outside-click close. Needed while a nested portal (the emoji
   * picker) is open: its panel is not a DOM descendant of ours, so a click
   * inside it reads as "outside", and unmounting on mousedown would destroy the
   * picker before its click ever landed.
   */
  holdOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  align = 'start',
  holdOpen = false,
  className = '',
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  // Portals need a DOM to land in, which the server render doesn't have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

      let left =
        align === 'end'
          ? a.right - p.width
          : align === 'center'
            ? a.left + a.width / 2 - p.width / 2
            : a.left;
      // The clamp is the whole point: whichever side the space is on, the panel
      // ends up on screen rather than half off it.
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - p.width - VIEWPORT_MARGIN));

      const above = a.top - ANCHOR_GAP - p.height;
      const below = a.bottom + ANCHOR_GAP;
      let top = above >= VIEWPORT_MARGIN ? above : below;
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - p.height - VIEWPORT_MARGIN));

      // Reusing the previous object when nothing moved is what keeps this from
      // looping: a fresh object every pass would re-render, and a re-render is
      // one of the things that re-measures.
      setPosition((prev) =>
        prev && prev.top === top && prev.left === left ? prev : { top, left }
      );
    };

    place();
    // The panel resizes when its own contents change (the delete item swapping
    // to its confirm label, say), and it has to be re-placed when it does.
    const panel = panelRef.current;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (panel && observer) observer.observe(panel);
    window.addEventListener('resize', place);
    // Capture phase, so the chat list's own scrolling is seen too.
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (holdOpen) return;
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, holdOpen, onClose, anchorRef]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-50 ${className}`}
      style={{
        // Parked off-screen for the frame it takes to measure, so it is never
        // seen at the wrong place first.
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        opacity: position ? 1 : 0,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
