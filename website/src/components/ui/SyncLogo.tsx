import React from 'react';

interface SyncLogoProps {
  size?: number;
  className?: string;
}

/**
 * SyncFlix logo mark — two offset play triangles representing sync.
 * Pure SVG, no external assets required.
 */
export default function SyncLogo({ size = 40, className = '' }: SyncLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="SyncFlix logo"
      role="img"
    >
      {/* Left triangle — primary */}
      <polygon points="4,8 4,32 22,20" fill="var(--primary)" opacity="1" />
      {/* Right triangle — ghost/echo */}
      <polygon points="14,8 14,32 32,20" fill="var(--primary)" opacity="0.35" />
      {/* Sync connector arc */}
      <path
        d="M22 20 Q27 17 32 20"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}
