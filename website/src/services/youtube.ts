/**
 * YouTube IFrame Player API — URL parsing and one-time script loading.
 *
 * This is the extension-free playback path: where the extension drives a real
 * youtube.com tab from the outside, this embeds a player we own directly in the
 * room page. It is the only way to run a synced watch party on a phone, since
 * no mobile browser worth targeting supports extensions.
 *
 * Netflix has no equivalent — its player cannot be embedded off-site, so the
 * in-page path is YouTube-only by construction.
 */

/** YouTube video ids are exactly 11 chars of URL-safe base64. */
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

const asId = (candidate: string | null | undefined): string | null =>
  candidate && VIDEO_ID.test(candidate) ? candidate : null;

/**
 * Pull a video id out of anything a user might paste: a watch URL, a youtu.be
 * short link, a /shorts, /embed or /live path, or a bare id.
 * Returns null for input that isn't a YouTube video.
 */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const bare = asId(raw);
  if (bare) return bare;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') return asId(url.pathname.slice(1).split('/')[0]);
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;

  const v = asId(url.searchParams.get('v'));
  if (v) return v;

  const path = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
  return path ? asId(path[1]) : null;
}

/** Canonical watch URL, for the "open the host's video" link and event stamps. */
export const youTubeWatchUrl = (videoId: string): string =>
  `https://www.youtube.com/watch?v=${videoId}`;

// ─── IFrame API loader ───────────────────────────────────────────────────────

/**
 * Minimal typings for the slice of the IFrame API we use. Hand-written rather
 * than pulling in @types/youtube for one component.
 */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { target: YTPlayer; data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Inject https://www.youtube.com/iframe_api once per document and resolve when
 * it's ready. Memoized: every player instance shares the one script tag, and
 * the API's single global `onYouTubeIframeAPIReady` callback is only claimed
 * once (chaining any previously-registered one rather than clobbering it).
 */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('YouTube IFrame API is browser-only'));
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded without a Player'));
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // let a later mount retry
      reject(new Error('Failed to load the YouTube IFrame API'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}
