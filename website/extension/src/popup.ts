/**
 * Popup — read-only status display. The website is the control surface;
 * the popup only answers "is the extension seeing a video right now?".
 */

import { gsap } from 'gsap';

import type { ExtensionStatePayload } from './messages';

function render(state: ExtensionStatePayload | undefined): void {
  const card = document.getElementById('statusCard')!;
  const status = document.getElementById('status')!;
  const platform = document.getElementById('platform')!;
  const version = document.getElementById('version')!;
  const roomTabs = document.getElementById('roomTabs')!;
  const playerTabs = document.getElementById('playerTabs')!;

  if (!state) {
    status.textContent = 'unavailable';
    intro();
    return;
  }
  status.textContent = state.status === 'connected' ? 'connected' : 'waiting for video';
  card.className = `status-card anim ${state.status}`;
  platform.textContent = state.platform ?? '—';
  version.textContent = state.version;

  // The two halves of the chain, so a machine that "doesn't sync" can be
  // diagnosed here instead of by guesswork: a room tab with no player tab (or
  // vice versa) pinpoints which side never connected.
  roomTabs.textContent = state.roomTabs > 0 ? `${state.roomTabs} connected` : 'none open';
  roomTabs.className = `node-value ${state.roomTabs > 0 ? 'connected' : 'waiting'}`;
  playerTabs.textContent = state.playerTabs > 0 ? `${state.playerTabs} connected` : 'none open';
  playerTabs.className = `node-value ${state.playerTabs > 0 ? 'connected' : 'waiting'}`;

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

  intro();
}

// Entrance choreography — runs once, after the first render has real values so
// nothing visibly re-flows mid-animation. The popup document dies when it
// closes, so no teardown is needed.
let played = false;
function intro(): void {
  if (played) return;
  played = true;
  // No clearProps: it would also wipe the inline display:none that render()
  // puts on the hidden "open video" row.
  gsap.from('.anim', {
    opacity: 0,
    y: 7,
    duration: 0.32,
    stagger: 0.055,
    ease: 'power2.out',
  });
}

chrome.runtime.sendMessage({ type: 'GET_STATE' }, render);
