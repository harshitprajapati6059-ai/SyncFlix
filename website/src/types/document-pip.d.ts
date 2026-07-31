/**
 * Minimal ambient types for the Document Picture-in-Picture API.
 * Not yet in TypeScript's DOM lib — supported in Chrome/Edge 116+.
 * https://developer.chrome.com/docs/web-platform/document-picture-in-picture
 */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
  addEventListener(type: 'enter', listener: (event: Event) => void): void;
  removeEventListener(type: 'enter', listener: (event: Event) => void): void;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}
