import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hinanavi_push_state_v1';
const MAX_CELLS = 12;

export type PushCell = {
  cellId: string;
  prefCode: string | null;
  lastSeenAt: string;
};

export type LastLocation = {
  lat: number;
  lon: number;
  updatedAt: string;
};

export type PushState = {
  deviceId: string;
  expoPushToken: string | null;
  enabled: boolean;
  cells: PushCell[];
  lastSyncAt: string | null;
  lastSyncLocation: LastLocation | null;
  lastLocation: LastLocation | null;
};

const emptyState: PushState = {
  deviceId: '',
  expoPushToken: null,
  enabled: false,
  cells: [],
  lastSyncAt: null,
  lastSyncLocation: null,
  lastLocation: null,
};

function createDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2);
  return `m_${Date.now().toString(36)}_${rand()}${rand()}`.slice(0, 64);
}

export async function getPushState(): Promise<PushState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return ensureDeviceId({ ...emptyState });
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PushState>;
    const state: PushState = {
      ...emptyState,
      ...parsed,
      cells: Array.isArray(parsed.cells) ? parsed.cells : [],
    };
    return ensureDeviceId(state);
  } catch {
    return ensureDeviceId({ ...emptyState });
  }
}

export async function savePushState(state: PushState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function updatePushState(updater: (state: PushState) => PushState): Promise<PushState> {
  const current = await getPushState();
  const next = updater(current);
  await savePushState(next);
  return next;
}

export async function getLastKnownLocation(): Promise<LastLocation | null> {
  const state = await getPushState();
  return state.lastLocation ?? null;
}

export async function setLastKnownLocation(coords: { lat: number; lon: number }): Promise<PushState> {
  const updatedAt = new Date().toISOString();
  return updatePushState((state) => ({
    ...state,
    lastLocation: { lat: coords.lat, lon: coords.lon, updatedAt },
  }));
}

export async function updateCells(cellId: string, prefCode: string | null): Promise<PushState> {
  const now = new Date().toISOString();
  return updatePushState((state) => {
    const existing = state.cells.find((cell) => cell.cellId === cellId);
    const nextCell: PushCell = {
      cellId,
      prefCode: prefCode ?? existing?.prefCode ?? null,
      lastSeenAt: now,
    };
    const remaining = state.cells.filter((cell) => cell.cellId !== cellId);
    const nextCells = [nextCell, ...remaining].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1)).slice(0, MAX_CELLS);
    return { ...state, cells: nextCells };
  });
}

export async function clearPushState(): Promise<PushState> {
  const reset = ensureDeviceId({ ...emptyState });
  await savePushState(reset);
  return reset;
}

function ensureDeviceId(state: PushState): PushState {
  if (state.deviceId) return state;
  return { ...state, deviceId: createDeviceId() };
}
