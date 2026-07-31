'use client';

import React, { useMemo } from 'react';
import { Emoji, EmojiStyle } from 'emoji-picker-react';
import emojiRegexFn from 'emoji-regex';

// Emoji sequence -> unified codepoint id never changes at runtime, so it's
// safe to cache process-wide instead of recomputing per render/instance.
const unifiedCache = new Map<string, string>();

function toUnified(sequence: string): string {
  const cached = unifiedCache.get(sequence);
  if (cached) return cached;
  const unified = Array.from(sequence)
    .map((char) => char.codePointAt(0)!.toString(16))
    .join('-');
  unifiedCache.set(sequence, unified);
  return unified;
}

type Segment = { text: string } | { unified: string };

// Same text -> same segments every time; cache per distinct message body so
// re-renders triggered by unrelated state (e.g. typing in the chat input)
// don't re-scan and rebuild every previously-sent message's emoji again.
const segmentsCache = new Map<string, Segment[]>();

function segmentText(text: string): Segment[] {
  const cached = segmentsCache.get(text);
  if (cached) return cached;

  const segments: Segment[] = [];
  const regex = emojiRegexFn();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ unified: toUnified(match[0]) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  segmentsCache.set(text, segments);
  return segments;
}

/**
 * Renders arbitrary text, swapping any emoji it contains for Apple-style
 * emoji images (sourced by the same CDN emoji-picker-react uses), so emoji
 * look the same (Apple's set) across every OS/browser instead of the
 * platform's native emoji font.
 */
export const AppleEmojiText = React.memo(function AppleEmojiText({
  text,
  size = 16,
  className,
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  const nodes = useMemo(
    () =>
      segmentText(text).map((segment, i) =>
        'text' in segment ? (
          segment.text
        ) : (
          <span
            key={`apple-emoji-${i}`}
            className="inline-flex shrink-0 align-[-0.2em]"
            style={{ width: size, height: size }}
          >
            <Emoji unified={segment.unified} emojiStyle={EmojiStyle.APPLE} size={size} />
          </span>
        )
      ),
    [text, size]
  );

  return <span className={className}>{nodes}</span>;
});
