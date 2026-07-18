/**
 * Platform adapter contract — one implementation per streaming platform
 * (project rule). The adapter's only job is platform-specific knowledge:
 * where the <video> element lives and how the site signals SPA navigation.
 * All sync logic lives in the shared engine (player.ts) and operates on the
 * plain HTMLVideoElement the adapter hands over.
 */

/** Identity of the content currently loaded in the player. */
export interface VideoInfo {
  /** Stable per-video id (e.g. the YouTube `v` param), null if unknown. */
  videoId: string | null;
  /** Canonical shareable URL for that video, null if unknown. */
  videoUrl: string | null;
}

export interface PlatformAdapter {
  /** Human-readable platform name, e.g. "YouTube". Shown in the room UI. */
  platform: string;
  /** Locate the main video element on the current page, if any. */
  findVideo(): HTMLVideoElement | null;
  /**
   * Identify the video currently loaded. Sync events are stamped with this so
   * peers watching a different video (or none) can refuse to apply them.
   */
  getVideoInfo(): VideoInfo;
  /**
   * Register a callback for the platform's SPA navigation event, so the
   * engine can re-locate the video when the user changes pages without a
   * full reload.
   */
  onNavigation(callback: () => void): void;
}
