import AsyncStorage from '@react-native-async-storage/async-storage';

export type EmergencyBaseMode = 'current' | 'myArea';

export type MyArea = {
  lat: number;
  lon: number;
  prefName: string | null;
  muniName: string | null;
  muniCode: string | null;
  updatedAt: string;
};

export type EmergencyState = {
  baseMode: EmergencyBaseMode;
  myArea: MyArea | null;
  myAreaHasWarnings: boolean | null;
  updatedAt: string | null;
};

const STORAGE_KEY = 'hinanavi_emergency_state_v1';

const DEFAULT_STATE: EmergencyState = {
  baseMode: 'current',
  myArea: null,
  myAreaHasWarnings: null,
  updatedAt: null,
};

export async function getEmergencyState(): Promise<EmergencyState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<EmergencyState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      myArea: parsed.myArea ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveEmergencyState(state: EmergencyState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function updateEmergencyState(
  updater: (state: EmergencyState) => EmergencyState
): Promise<EmergencyState> {
  const current = await getEmergencyState();
  const next = updater(current);
  await saveEmergencyState(next);
  return next;
}
