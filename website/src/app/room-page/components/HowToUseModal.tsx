'use client';

import React, { useEffect } from 'react';
import { X, Puzzle, Hash, MonitorPlay, Play, BookOpen } from 'lucide-react';

interface HowToUseModalProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    icon: Puzzle,
    title: 'Check the extension says "Connected"',
    body: 'Click the SyncFlix icon in your browser toolbar. It should say "Connected" and name the platform it found. If it says "Waiting for video", open your video in a tab, or refresh the tab that already has it.',
  },
  {
    icon: Hash,
    title: 'Make sure everyone is in the same room',
    body: 'Everyone needs to join with the same room code. Copy the code from the top of this page and send it to your friends. If someone is in a different room, nothing you do will reach them.',
  },
  {
    icon: MonitorPlay,
    title: 'Make sure everyone has the same video open',
    body: 'Each person opens the exact same video in their own tab. Same YouTube video, same Netflix episode, same Prime Video title. If you are on different videos, sync stays off on purpose, so nothing messes with your playback.',
  },
  {
    icon: Play,
    title: 'Press play, and it just works',
    body: 'Once all three things above are true, you are in sync. Play, pause and seek follow the host for everyone, and anyone who falls behind is caught up automatically.',
  },
];

export default function HowToUseModal({ open, onClose }: HowToUseModalProps) {
  // Close on Escape and keep the page behind from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-to-use-title"
    >
      <div
        className="card w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <BookOpen size={15} className="text-primary" />
            </div>
            <h2 id="how-to-use-title" className="text-sm font-semibold text-foreground">
              How to use SyncFlix
            </h2>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 sm:px-6 py-4 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sync needs three things to be true at the same time, for every person in the room. Go
            through this quick checklist and you are all set.
          </p>

          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-muted text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <step.icon size={12} className="text-muted-foreground shrink-0" />
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/50 rounded-lg px-3 py-2.5">
            Tip: not sure you are watching the same video as the host? Click the SyncFlix icon in
            your toolbar. If the host is watching something else, you will see an &quot;Open
            host&apos;s video&quot; button that takes you right to it.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
