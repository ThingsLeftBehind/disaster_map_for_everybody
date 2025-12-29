export async function ensureNotificationChannel(): Promise<void> {
  return;
}

export async function requestPushPermissions(): Promise<boolean> {
  return false;
}

export async function getExpoPushTokenSafe(): Promise<string | null> {
  return null;
}

export function registerNotificationListeners(_onTap: () => void): () => void {
  return () => {};
}
