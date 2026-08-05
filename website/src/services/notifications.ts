'use client';

/**
 * Desktop chat notifications: the Web Notification API, wrapped so the rest of
 * the app never has to branch on browser support or permission state.
 *
 * Two separate gates have to be open before anything is shown: the browser's
 * permission, and the user's own toggle in the chat header. Permission alone
 * isn't enough, because it is granted once and then remembered forever, across every
 * room, which is far too sticky a decision to also mean "keep interrupting me".
 *
 * Notifications are only ever raised while the tab is in the background. With
 * the tab in front there is already an in-app toast, and firing both produces
 * the same message twice on screen.
 */

export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

const PREF_KEY = 'syncflix_desktop_notifications';

/**
 * One tag for every chat notification, so a burst of messages replaces itself
 * in the notification centre instead of stacking up a wall of them.
 */
const CHAT_TAG = 'syncflix-chat';

export function notificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') {
    return Notification.permission as NotificationPermissionState;
  }
  try {
    return (await Notification.requestPermission()) as NotificationPermissionState;
  } catch {
    // Safari's callback-only signature rejects the promise form on old versions.
    return notificationPermission();
  }
}

/** The user's toggle. Defaults to on, so granting permission is the only opt-in. */
export function desktopNotificationsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(PREF_KEY) !== 'false';
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREF_KEY, String(enabled));
}

/**
 * Raises a chat notification, if permission and the user's toggle both allow it.
 * Clicking it brings the room tab back to the front.
 */
export function showChatNotification(title: string, body: string): void {
  if (notificationPermission() !== 'granted' || !desktopNotificationsEnabled()) return;
  try {
    const notification = new Notification(title, {
      body,
      tag: CHAT_TAG,
      icon: '/icon.png',
      // Replacing the previous notification shouldn't re-alert; the point of the
      // shared tag is to keep the shelf tidy, not to buzz once per message.
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some browsers (notably Android Chrome) only allow notifications through a
    // service worker registration. Nothing to fall back to; the in-app toast
    // and the unread badge still cover it.
  }
}
