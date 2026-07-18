/**
 * Popup — read-only status display. The website is the control surface;
 * the popup only answers "is the extension seeing a video right now?".
 */

import type { ExtensionStatePayload } from './messages';

function render(state: ExtensionStatePayload | undefined): void {
  const status = document.getElementById('status')!;
  const platform = document.getElementById('platform')!;
  const version = document.getElementById('version')!;
  const roomTabs = document.getElementById('roomTabs')!;
  const playerTabs = document.getElementById('playerTabs')!;

  if (!state) {
    status.textContent = 'unavailable';
    return;
  }
  status.textContent = state.status === 'connected' ? 'connected' : 'waiting for video';
  status.className = state.status;
  platform.textContent = state.platform ?? '—';
  version.textContent = state.version;

  // The two halves of the chain, so a machine that "doesn't sync" can be
  // diagnosed here instead of by guesswork: a room tab with no player tab (or
  // vice versa) pinpoints which side never connected.
  roomTabs.textContent = state.roomTabs > 0 ? `${state.roomTabs} connected` : 'none open';
  roomTabs.className = state.roomTabs > 0 ? 'connected' : 'waiting';
  playerTabs.textContent = state.playerTabs > 0 ? `${state.playerTabs} connected` : 'none open';
  playerTabs.className = state.playerTabs > 0 ? 'connected' : 'waiting';

  // "Open video" — jump this machine to the room host's video. Shown whenever
  // the page has reported one and we're not already watching it.
  const openRow = document.getElementById('openVideoRow')!;
  const openLink = document.getElementById('openVideo') as HTMLAnchorElement;
  const alreadyOnIt = state.hostVideoUrl !== null && state.videoUrl === state.hostVideoUrl;
  if (state.hostVideoUrl && !alreadyOnIt) {
    openRow.style.display = '';
    openLink.onclick = (e) => {
      e.preventDefault();
      void chrome.tabs.create({ url: state.hostVideoUrl! });
    };
  } else {
    openRow.style.display = 'none';
  }
}

chrome.runtime.sendMessage({ type: 'GET_STATE' }, render);
