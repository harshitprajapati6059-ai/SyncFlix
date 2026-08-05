'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: number;
  className?: string;
  /** Swapped in for the default copy glyph — e.g. a link icon for invite URLs. */
  icon?: LucideIcon;
  /** Optional inline text. Callers own its responsive visibility. */
  children?: React.ReactNode;
  title?: string;
}

export default function CopyButton({
  value,
  label,
  size = 14,
  className = '',
  icon: Icon = Copy,
  children,
  title,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  // Clear the pending reset if we unmount inside the 2s "copied" window.
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label ? `${label} copied` : 'Copied to clipboard');
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy — please copy manually');
    }
  };

  return (
    <button
      onClick={handleCopy}
      // Nothing to put on the clipboard until the value resolves (room code
      // loading, invite URL waiting on the browser origin).
      disabled={!value}
      className={`btn-ghost ${children ? 'px-2.5 py-1.5' : 'p-1.5'} rounded-lg ${className}`}
      aria-label={`Copy ${label ?? 'value'}`}
      title={title ?? `Copy ${label ?? ''}`}
    >
      {copied ? (
        <Check size={size} className="text-[var(--status-synced)]" />
      ) : (
        // Icon-only sits on its own, so it carries the muted tone itself; the
        // labelled variant inherits the button's color (incl. its hover state).
        <Icon size={size} className={children ? '' : 'text-muted-foreground'} />
      )}
      {children}
    </button>
  );
}
