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
  /**
   * True if this adapter owns the given hostname. Host knowledge belongs to the
   * adapter, so adding a platform means adding one file plus a manifest entry —
   * the engine never learns any platform's domains.
   */
  matches(hostname: string): boolean;
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
  /**
   * Platform-specific seek override. Some players (Netflix) break when the
   * <video> element's currentTime is written directly and must be seeked
   * through their own player API instead. When absent, the engine seeks the
   * element directly. The override MUST still cause normal seeking/seeked
   * events on the element — the engine's echo suppression relies on them.
   */
  seek?(seconds: number): void;
  /**
   * Platform-specific play/pause overrides, for players that keep their own
   * playback state machine (Netflix). Calling play()/pause() on the element
   * behind such a player's back makes it revert the change a beat later, which
   * the engine sees as a user action and broadcasts — a pause/play storm.
   * When absent, the engine drives the element directly.
   */
  play?(): void;
  pause?(): void;
  /**
   * False when the platform ignores or resets <video>.playbackRate, so the
   * engine's drift nudges would never converge. Defaults to true.
   */
  canNudgeRate?: boolean;
  /**
   * True while the platform is playing an ad. Ads run on the same <video>
   * element but a different timeline, so positions measured during one are
   * meaningless to the room: the engine stops both reporting and applying until
   * content resumes. Omit on ad-free platforms.
   */
  isAdPlaying?(): boolean;
}
