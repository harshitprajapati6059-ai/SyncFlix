/**
 * Popup — read-only status display. The website is the control surface;
 * the popup only answers "is the extension seeing a video right now?".
 */

import type { ExtensionStatePayload } from './messages';

function render(state: ExtensionStatePayload | undefined): void {
  const status = document.getElementById('status')!;
  const platform = document.getElementById('platform')!;
  const version = document.getElementById('version')!;

  if (!state) {
    status.textContent = 'unavailable';
    return;
  }
  status.textContent = state.status === 'connected' ? 'connected' : 'waiting for video';
  status.className = state.status;
  platform.textContent = state.platform ?? '—';
  version.textContent = state.version;
}

chrome.runtime.sendMessage({ type: 'GET_STATE' }, render);
