/**
 * Platform adapter contract — one implementation per streaming platform
 * (project rule). The adapter's only job is platform-specific knowledge:
 * where the <video> element lives and how the site signals SPA navigation.
 * All sync logic lives in the shared engine (player.ts) and operates on the
 * plain HTMLVideoElement the adapter hands over.
 */

export interface PlatformAdapter {
  /** Human-readable platform name, e.g. "YouTube". Shown in the room UI. */
  platform: string;
  /** Locate the main video element on the current page, if any. */
  findVideo(): HTMLVideoElement | null;
  /**
   * Register a callback for the platform's SPA navigation event, so the
   * engine can re-locate the video when the user changes pages without a
   * full reload.
   */
  onNavigation(callback: () => void): void;
}
