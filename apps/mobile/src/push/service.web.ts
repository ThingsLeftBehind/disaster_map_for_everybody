type LocationCoords = { lat: number; lon: number };

export async function enableBackgroundAlerts(): Promise<{ ok: true } | { ok: false; reason: string }> {
  return { ok: false, reason: 'unsupported' };
}

export async function disableBackgroundAlerts(): Promise<void> {
  return;
}

export async function getBackgroundStatus(): Promise<{ enabled: boolean; started: boolean }> {
  return { enabled: false, started: false };
}

export async function handleLocationUpdate(_coords: LocationCoords, _source: 'background' | 'foreground') {
  return;
}

export async function syncSubscriptions(_coords: LocationCoords | null): Promise<void> {
  return;
}

export async function ensurePushToken(_existing: string | null): Promise<string | null> {
  return null;
}

export async function unregisterDevice(): Promise<void> {
  return;
}

export async function loadLastKnownLocation(): Promise<LocationCoords | null> {
  return null;
}
