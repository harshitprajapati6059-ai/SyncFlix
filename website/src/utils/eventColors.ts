/**
 * Maps SyncEvent types to semantic display colors and labels.
 */
import type { SyncEventType } from '@/types/room';

export interface EventMeta {
  label: string;
  colorClass: string;
  dotClass: string;
}

export function getEventMeta(type: SyncEventType): EventMeta {
  switch (type) {
    case 'JOIN_ROOM':
    case 'USER_CONNECTED':
      return {
        label: type === 'JOIN_ROOM' ? 'Joined' : 'Connected',
        colorClass: 'text-[var(--status-synced)]',
        dotClass: 'bg-[var(--status-synced)]',
      };
    case 'LEAVE_ROOM':
    case 'USER_DISCONNECTED':
      return {
        label: type === 'LEAVE_ROOM' ? 'Left' : 'Disconnected',
        colorClass: 'text-[var(--status-error)]',
        dotClass: 'bg-[var(--status-error)]',
      };
    case 'PLAY':
      return {
        label: 'Play',
        colorClass: 'text-[var(--status-synced)]',
        dotClass: 'bg-[var(--status-synced)]',
      };
    case 'PAUSE':
      return {
        label: 'Pause',
        colorClass: 'text-[var(--status-warning)]',
        dotClass: 'bg-[var(--status-warning)]',
      };
    case 'SEEK':
      return {
        label: 'Seek',
        colorClass: 'text-[var(--status-info)]',
        dotClass: 'bg-[var(--status-info)]',
      };
    case 'POSITION_UPDATE':
      return {
        label: 'Position',
        colorClass: 'text-muted-foreground',
        dotClass: 'bg-muted-foreground',
      };
    case 'PLAYBACK_SPEED':
      return {
        label: 'Speed',
        colorClass: 'text-[var(--status-info)]',
        dotClass: 'bg-[var(--status-info)]',
      };
    case 'HEARTBEAT':
      return {
        label: 'Heartbeat',
        colorClass: 'text-muted-foreground',
        dotClass: 'bg-muted-foreground',
      };
    case 'PLATFORM_CHANGED':
      return {
        label: 'Platform',
        colorClass: 'text-[var(--status-host)]',
        dotClass: 'bg-[var(--status-host)]',
      };
    default:
      return { label: type, colorClass: 'text-muted-foreground', dotClass: 'bg-muted-foreground' };
  }
}
