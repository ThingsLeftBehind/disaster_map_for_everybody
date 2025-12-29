import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import { latLngToCell } from 'h3-js';

import { fetchJson } from '@/src/api/client';
import { getLastKnownLocation, getPushState, setLastKnownLocation, updateCells, updatePushState } from './state';
import { ensureNotificationChannel, getExpoPushTokenSafe, requestPushPermissions } from './notifications';

const BACKGROUND_LOCATION_TASK = 'hinanavi-background-location';
const CELL_RESOLUTION = 5;
const SYNC_DISTANCE_KM = 2;
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

type LocationCoords = { lat: number; lon: number };

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  const latest = locations[locations.length - 1];
  if (!latest?.coords) return;
  await handleLocationUpdate(
    { lat: latest.coords.latitude, lon: latest.coords.longitude },
    'background'
  );
});

export async function enableBackgroundAlerts(): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureNotificationChannel();
  const pushGranted = await requestPushPermissions();
  if (!pushGranted) return { ok: false, reason: 'push-permission' };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { ok: false, reason: 'location-foreground' };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return { ok: false, reason: 'location-background' };

  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 2000,
      timeInterval: SYNC_INTERVAL_MS,
      deferredUpdatesInterval: SYNC_INTERVAL_MS,
      showsBackgroundLocationIndicator: true,
      foregroundService: Platform.OS === 'android'
        ? {
            notificationTitle: 'HinaNavi',
            notificationBody: '災害情報の更新中',
          }
        : undefined,
    });
  }

  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  if (current?.coords) {
    await handleLocationUpdate(
      { lat: current.coords.latitude, lon: current.coords.longitude },
      'foreground'
    );
  } else {
    await syncSubscriptions(null);
  }

  await updatePushState((state) => ({ ...state, enabled: true }));
  return { ok: true };
}

export async function disableBackgroundAlerts(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await unregisterDevice();
  await updatePushState((state) => ({
    ...state,
    enabled: false,
    cells: [],
    lastSyncAt: null,
    lastSyncLocation: null,
  }));
}

export async function getBackgroundStatus(): Promise<{ enabled: boolean; started: boolean }> {
  const state = await getPushState();
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  return { enabled: state.enabled, started };
}

export async function handleLocationUpdate(coords: LocationCoords, source: 'background' | 'foreground') {
  await setLastKnownLocation(coords);
  const cellId = latLngToCell(coords.lat, coords.lon, CELL_RESOLUTION);
  const prefCode = await reverseGeocodePrefCode(coords);
  await updateCells(cellId, prefCode);

  const shouldSync = await shouldSyncSubscriptions(coords);
  if (shouldSync || source === 'foreground') {
    await syncSubscriptions(coords);
  }
}

export async function syncSubscriptions(coords: LocationCoords | null): Promise<void> {
  const state = await getPushState();
  const token = await ensurePushToken(state.expoPushToken);
  if (!token) return;

  const cells = state.cells.map((cell) => ({
    cellId: cell.cellId,
    prefCode: cell.prefCode ?? null,
    lastSeenAt: cell.lastSeenAt,
  }));

  if (cells.length === 0 && coords) {
    const cellId = latLngToCell(coords.lat, coords.lon, CELL_RESOLUTION);
    const prefCode = await reverseGeocodePrefCode(coords);
    cells.push({ cellId, prefCode, lastSeenAt: new Date().toISOString() });
  }
  if (cells.length === 0) return;

  const locale =
    typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : 'unknown';
  const payload = {
    deviceId: state.deviceId,
    expoPushToken: token,
    subscribedCells: cells.slice(0, 12),
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown',
    locale,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  };

  try {
    await fetchJson('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await updatePushState((prev) => ({
      ...prev,
      expoPushToken: token,
      lastSyncAt: new Date().toISOString(),
      lastSyncLocation: coords
        ? { lat: coords.lat, lon: coords.lon, updatedAt: new Date().toISOString() }
        : prev.lastSyncLocation,
    }));
  } catch {
    return;
  }
}

export async function ensurePushToken(existing: string | null): Promise<string | null> {
  if (existing) return existing;
  const token = await getExpoPushTokenSafe();
  if (!token) return null;
  await updatePushState((state) => ({ ...state, expoPushToken: token }));
  return token;
}

export async function unregisterDevice(): Promise<void> {
  const state = await getPushState();
  if (!state.deviceId) return;
  await fetchJson('/api/push/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: state.deviceId }),
  }).catch(() => null);
}

export async function loadLastKnownLocation(): Promise<LocationCoords | null> {
  const last = await getLastKnownLocation();
  if (!last) return null;
  return { lat: last.lat, lon: last.lon };
}

async function shouldSyncSubscriptions(coords: LocationCoords): Promise<boolean> {
  const state = await getPushState();
  if (!state.lastSyncAt || !state.lastSyncLocation) return true;
  const lastSync = Date.parse(state.lastSyncAt);
  if (!Number.isFinite(lastSync) || Date.now() - lastSync >= SYNC_INTERVAL_MS) return true;
  const distance = distanceKm(coords, state.lastSyncLocation);
  return distance >= SYNC_DISTANCE_KM;
}

async function reverseGeocodePrefCode(coords: LocationCoords): Promise<string | null> {
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
      coords.lon
    )}&lat=${encodeURIComponent(coords.lat)}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const json = await response.json();
    const muniRaw = json?.results?.muniCd ?? null;
    const digits = typeof muniRaw === 'string' ? muniRaw.replace(/\D/g, '') : '';
    if (!digits) return null;
    const prefCode = digits.length >= 2 ? digits.slice(0, 2) : null;
    return prefCode && /^\d{2}$/.test(prefCode) ? prefCode : null;
  } catch {
    return null;
  }
}

function distanceKm(a: LocationCoords, b: LocationCoords): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
