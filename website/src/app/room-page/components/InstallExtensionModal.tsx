'use client';

import React, { useEffect } from 'react';
import { X, Download, FolderOpen, Puzzle, ToggleRight, RefreshCw, Globe } from 'lucide-react';

interface InstallExtensionModalProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    icon: Download,
    title: 'Download the extension',
    body: 'Click the download button below. You will get a small zip file called syncflix-extension.zip.',
  },
  {
    icon: FolderOpen,
    title: 'Unzip the file',
    body: 'Right click the zip file and choose "Extract All". Remember where the folder ends up, you will need it in a moment.',
  },
  {
    icon: Globe,
    title: 'Open your extensions page',
    body: 'Type chrome://extensions in the address bar and press Enter. On Brave it is brave://extensions, on Edge it is edge://extensions.',
  },
  {
    icon: ToggleRight,
    title: 'Turn on Developer mode',
    body: 'Look for the "Developer mode" switch in the top right corner of the page and turn it on.',
  },
  {
    icon: Puzzle,
    title: 'Load the extension',
    body: 'Click the "Load unpacked" button that appears, then pick the folder you unzipped in step 2. The SyncFlix icon should show up in your toolbar.',
  },
  {
    icon: RefreshCw,
    title: 'Come back and refresh',
    body: 'Return to this room and refresh the page. The banner at the bottom should now say "Waiting for extension" or "Extension connected". Open your video in another tab and you are ready to watch together.',
  },
];

export default function InstallExtensionModal({ open, onClose }: InstallExtensionModalProps) {
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
      aria-labelledby="install-extension-title"
    >
      <div
        className="card w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <Puzzle size={15} className="text-primary" />
            </div>
            <h2 id="install-extension-title" className="text-sm font-semibold text-foreground">
              How to install the extension
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
            The extension is what keeps your video in sync with everyone else. It takes about a
            minute to set up. Each person in the room installs it once, in their own browser.
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
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/50 rounded-lg px-3 py-2.5">
            Tip: extensions are installed per browser. If you switch from Chrome to Brave or use
            another computer, repeat these steps there too.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="btn-ghost px-3 py-2 text-xs text-muted-foreground">
            Close
          </button>
          <a
            href="/downloads/syncflix-extension.zip"
            download
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Download size={13} />
            Download extension
          </a>
        </div>
      </div>
    </div>
  );
}
