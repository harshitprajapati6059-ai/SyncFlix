'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: number;
  className?: string;
}

export default function CopyButton({ value, label, size = 14, className = '' }: CopyButtonProps) {
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
      className={`btn-ghost p-1.5 rounded-lg ${className}`}
      aria-label={`Copy ${label ?? 'value'}`}
      title={`Copy ${label ?? ''}`}
    >
      {copied ? (
        <Check size={size} className="text-[var(--status-synced)]" />
      ) : (
        <Copy size={size} className="text-muted-foreground" />
      )}
    </button>
  );
}
