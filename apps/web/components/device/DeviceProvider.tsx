import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { decodeTransferCode, encodeTransferCode } from '../../lib/client/transfer';
import { loadSavedShelters, subscribeSavedShelters } from 'lib/shelters/savedShelters';

type DeviceState = {
  deviceId: string;
  settings: {
    powerSaving: boolean;
    lowBandwidth: boolean;
    selectedAreaId: string | null;
    includePreciseShareLocation: boolean;
  };
  savedAreas: Array<{
    id: string;
    label?: string | null;
    prefCode: string;
    prefName: string;
    muniCode?: string | null;
    muniName?: string | null;
    jmaAreaCode?: string | null;
    addedAt: string;
  }>;
  favorites: { shelterIds: string[] };
  recent: { shelterIds: string[] };
  checkins: Array<{
    id: string;
    status: string;
    shelterId?: string | null;
    updatedAt: string;
    lat?: number | null;
    lon?: number | null;
    precision?: 'COARSE' | 'PRECISE';
    comment?: string | null;
    active?: boolean;
    archivedAt?: string | null;
  }>;
  updatedAt?: string;
};

type DeviceContextValue = {
  deviceId: string | null;
  device: DeviceState | null;
  online: boolean;
  coarseArea: { prefCode: string | null; muniCode: string | null; address: string | null } | null;
  setCoarseArea: (area: { prefCode: string | null; muniCode: string | null; address: string | null } | null) => void;
  selectedArea: DeviceState['savedAreas'][number] | null;
  selectedJmaAreaCode: string | null;
  currentJmaAreaCode: string | null;
  updateDevice: (patch: Partial<DeviceState>) => Promise<void>;
  addSavedArea: (area: Omit<DeviceState['savedAreas'][number], 'id' | 'addedAt'>) => Promise<void>;
  removeSavedArea: (id: string) => Promise<void>;
  setSelectedAreaId: (id: string | null) => Promise<void>;
  setSettings: (patch: Partial<DeviceState['settings']>) => Promise<void>;
  checkin: (args: {
    status: string;
    coords: { lat: number; lon: number };
    precision: 'COARSE' | 'PRECISE';
    comment?: string | null;
    shelterId?: string | null;
  }) => Promise<void>;
  exportTransferCode: () => Promise<string | null>;
  importTransferCode: (code: string) => Promise<boolean>;
  exportTransferCodeLocal: () => Promise<string | null>;
  importTransferCodeLocal: (code: string) => Promise<boolean>;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

const LS_KEY = 'jp_evac_device_state_v1';
const LS_AREA = 'jp_evac_coarse_area_v1';
const LS_PENDING_CHECKINS = 'jp_evac_pending_checkins_v1';
const LS_LAST_CHECKIN = 'jp_evac_last_checkin_v1';
const MIN_CHECKIN_INTERVAL_MS = 15_000;

type PendingCheckin = {
  status: string;
  shelterId: string | null;
  updatedAt: string;
  lat: number;
  lon: number;
  precision: 'COARSE' | 'PRECISE';
  comment: string | null;
};

function readPendingCheckins(): PendingCheckin[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_PENDING_CHECKINS);
    if (!raw) return [];
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    return json
      .filter((v) => v && typeof v === 'object')
      .map((v): PendingCheckin => ({
        status: typeof (v as any).status === 'string' ? (v as any).status : '',
        shelterId: typeof (v as any).shelterId === 'string' ? (v as any).shelterId : null,
        updatedAt: typeof (v as any).updatedAt === 'string' ? (v as any).updatedAt : '',
        lat: typeof (v as any).lat === 'number' ? (v as any).lat : NaN,
        lon: typeof (v as any).lon === 'number' ? (v as any).lon : NaN,
        precision: (v as any).precision === 'PRECISE' ? 'PRECISE' : 'COARSE',
        comment: typeof (v as any).comment === 'string' ? (v as any).comment : null,
      }))
      .filter((v) => Boolean(v.status && v.updatedAt && Number.isFinite(v.lat) && Number.isFinite(v.lon)))
      .slice(0, 50);
  } catch {
    return [];
  }
}

function writePendingCheckins(next: PendingCheckin[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_PENDING_CHECKINS, JSON.stringify(next.slice(0, 50)));
  } catch {
    // ignore
  }
}

function readLastCheckin(): { status: string; at: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_LAST_CHECKIN);
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object') return null;
    const status = typeof (json as any).status === 'string' ? (json as any).status : null;
    const at = typeof (json as any).at === 'number' ? (json as any).at : null;
    if (!status || !at) return null;
    return { status, at };
  } catch {
    return null;
  }
}

function writeLastCheckin(value: { status: string; at: number }): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_LAST_CHECKIN, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

function prefToJmaArea(prefCode: string): string {
  return `${prefCode}0000`;
}

function roundNumber(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function roundLatLon(coords: { lat: number; lon: number }, decimals: number): { lat: number; lon: number } {
  return { lat: roundNumber(coords.lat, decimals), lon: roundNumber(coords.lon, decimals) };
}

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem('jp_evac_device_id');
  if (existing) return existing;
  const id = nanoid(16);
  localStorage.setItem('jp_evac_device_id', id);
  return id;
}

async function safeFetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postCheckinJson(url: string, init: RequestInit): Promise<{ ok: true } | { ok: false; retryable: boolean; errorCode?: string | null }> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return { ok: true };
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const errorCode = typeof payload?.errorCode === 'string' ? payload.errorCode : null;
    const retryable = errorCode !== 'DUPLICATE' && errorCode !== 'RATE_LIMITED';
    return { ok: false, retryable, errorCode };
  } catch {
    return { ok: false, retryable: true };
  }
}

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [coarseArea, setCoarseAreaState] = useState<{ prefCode: string | null; muniCode: string | null; address: string | null } | null>(null);
  const flushingPendingCheckinsRef = useRef(false);
  const inflightCheckinRef = useRef<AbortController | null>(null);
  const pendingCheckinRef = useRef<PendingCheckin | null>(null);
  const pendingCheckinTimerRef = useRef<number | null>(null);
  const lastCheckinRef = useRef<{ status: string; at: number } | null>(readLastCheckin());

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);



  useEffect(() => {
    return () => {
      if (pendingCheckinTimerRef.current) window.clearTimeout(pendingCheckinTimerRef.current);
      if (inflightCheckinRef.current) inflightCheckinRef.current.abort();
    };
  }, []);

  useEffect(() => {
    try {
      const id = getOrCreateDeviceId();
      setDeviceId(id);
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as DeviceState;
        if (parsed?.deviceId === id) setDevice(parsed);
      }

      const area = localStorage.getItem(LS_AREA);
      if (area) {
        const parsedArea = JSON.parse(area);
        if (parsedArea && typeof parsedArea === 'object') {
          setCoarseAreaState({
            prefCode: typeof parsedArea.prefCode === 'string' ? parsedArea.prefCode : null,
            muniCode: typeof parsedArea.muniCode === 'string' ? parsedArea.muniCode : null,
            address: typeof parsedArea.address === 'string' ? parsedArea.address : null,
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const persistLocal = useCallback((next: DeviceState) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const syncFromServer = useCallback(async () => {
    if (!deviceId || !online) return;
    try {
      const data = await safeFetchJson(`/api/store/device?deviceId=${encodeURIComponent(deviceId)}`);
      const serverDevice = data?.device as DeviceState | undefined;
      if (!serverDevice) return;
      setDevice((current) => {
        const merged = current ? { ...serverDevice, ...current, settings: { ...serverDevice.settings, ...current.settings } } : serverDevice;
        persistLocal(merged);
        return merged;
      });
    } catch {
      // ignore
    }
  }, [deviceId, online, persistLocal]);

  useEffect(() => {
    void syncFromServer();
  }, [syncFromServer]);

  const lastSyncTimeRef = useRef<number>(0);
  const syncCooldownUntilRef = useRef<number>(0);
  const hasInitialSyncRef = useRef<boolean>(false);

  const syncToServer = useCallback(
    async (next: DeviceState, force: boolean = false) => {
      if (!online) return;
      const now = Date.now();

      // Check cooldown (e.g. from previous 429)
      if (now < syncCooldownUntilRef.current) {
        // console.log('DeviceProvider: Sync suppressed by cooldown');
        return;
      }

      // If not forced, check basic throttling (e.g. max once per 10s unless critical?)
      // We want to avoid spamming on every small state change if they happen rapidly.
      // But we do want to save. Let's rely on the fact that `device` update triggers this.
      // We'll add a small debounce in the effect, but here we just check global frequency.
      if (!force && now - lastSyncTimeRef.current < 2000) {
        return;
      }

      try {
        const res = await fetch('/api/store/device', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deviceId: next.deviceId,
            settings: next.settings,
            savedAreas: next.savedAreas,
            favorites: next.favorites,
            recent: next.recent,
          }),
        });

        if (res.status === 429) {
          console.warn('DeviceProvider: 429 Rate Limited. Backing off for 60s.');
          syncCooldownUntilRef.current = now + 60_000;
          return;
        }

        if (!res.ok) {
          // On other errors, back off briefly (10s)
          syncCooldownUntilRef.current = now + 10_000;
          return;
        }

        // Success
        lastSyncTimeRef.current = now;
        syncCooldownUntilRef.current = 0; // Clear cooldown on success
      } catch (e) {
        // Network error? Back off 10s
        syncCooldownUntilRef.current = now + 10_000;
      }
    },
    [online]
  );

  // REMOVED: Redundant useEffect that triggered syncToServer on every device state change.
  // This was causing potential infinite loops or double-posting.
  // Verification: updateDevice() already calls syncToServer() explicitly.
  // Initial sync from server is handled by syncFromServer().
  // If external updates (like subscribeSavedShelters) occur, we should decide if we want to sync them.
  // For now, we rely on user actions via updateDevice to persist.
  // If truly needed, we would need a sophisticated debounce that doesn't trigger on server-echoed data.


  const updateDevice = useCallback(
    async (patch: Partial<DeviceState>) => {
      if (!deviceId) return;
      setDevice((current) => {
        const base: DeviceState =
          current ??
          ({
            deviceId,
            settings: { powerSaving: false, lowBandwidth: false, selectedAreaId: null, includePreciseShareLocation: false },
            savedAreas: [],
            favorites: { shelterIds: [] },
            recent: { shelterIds: [] },
            checkins: [],
          } as DeviceState);

        const next: DeviceState = {
          ...base,
          ...patch,
          settings: { ...base.settings, ...(patch as any).settings },
          updatedAt: nowIso(),
        };
        persistLocal(next);
        void syncToServer(next);
        return next;
      });
    },
    [deviceId, persistLocal, syncToServer]
  );

  useEffect(() => {
    return subscribeSavedShelters(() => {
      const latestIds = loadSavedShelters();
      void updateDevice({
        favorites: { shelterIds: latestIds },
      });
    });
  }, [updateDevice]);

  const addSavedArea = useCallback(
    async (area: Omit<DeviceState['savedAreas'][number], 'id' | 'addedAt'>) => {
      if (!deviceId) return;
      await updateDevice({
        savedAreas: (device?.savedAreas ?? [])
          .concat([{ ...area, id: nanoid(10), addedAt: nowIso(), jmaAreaCode: area.jmaAreaCode ?? prefToJmaArea(area.prefCode) }])
          .slice(0, 5),
      } as any);
    },
    [device?.savedAreas, deviceId, updateDevice]
  );

  const removeSavedArea = useCallback(
    async (id: string) => {
      const nextAreas = (device?.savedAreas ?? []).filter((a) => a.id !== id);
      const selected = device?.settings?.selectedAreaId === id ? null : device?.settings?.selectedAreaId ?? null;
      await updateDevice({ savedAreas: nextAreas, settings: { selectedAreaId: selected } as any } as any);
    },
    [device?.savedAreas, device?.settings?.selectedAreaId, updateDevice]
  );

  const setSelectedAreaId = useCallback(
    async (id: string | null) => {
      await updateDevice({ settings: { selectedAreaId: id } as any } as any);
    },
    [updateDevice]
  );

  const setSettings = useCallback(
    async (patch: Partial<DeviceState['settings']>) => {
      await updateDevice({ settings: patch as any } as any);
    },
    [updateDevice]
  );

  const checkin = useCallback(
    async (args: { status: string; coords: { lat: number; lon: number }; precision: 'COARSE' | 'PRECISE'; comment?: string | null; shelterId?: string | null }) => {
      if (!deviceId) return;
      const at = nowIso();
      const coords = args.precision === 'PRECISE' ? args.coords : roundLatLon(args.coords, 2);
      const comment = typeof args.comment === 'string' && args.comment.trim() ? args.comment.trim().slice(0, 120) : null;

      setDevice((current) => {
        if (!current) return current;
        const existing = current.checkins ?? [];
        const anyExplicitActive = existing.some((c: any) => c && typeof c === 'object' && typeof (c as any).active === 'boolean');
        const normalized = existing.map((c: any, idx: number) => {
          const active = anyExplicitActive ? (c as any).active === true : idx === 0;
          return { ...c, active, archivedAt: active ? null : (c as any).archivedAt ?? (c as any).updatedAt ?? null };
        });
        const archived = normalized.map((c: any) => (c.active ? { ...c, active: false, archivedAt: at } : c));

        const next: DeviceState = {
          ...current,
          checkins: [
            { id: nanoid(10), status: args.status, shelterId: args.shelterId ?? null, updatedAt: at, lat: coords.lat, lon: coords.lon, precision: args.precision, comment, active: true, archivedAt: null },
            ...archived,
          ].slice(0, 50),
          updatedAt: at,
        };
        persistLocal(next);
        return next;
      });
      const pendingPayload: PendingCheckin = {
        status: args.status,
        shelterId: args.shelterId ?? null,
        updatedAt: at,
        lat: coords.lat,
        lon: coords.lon,
        precision: args.precision,
        comment,
      };
      const enqueuePayload = (payload: PendingCheckin) => {
        const existing = readPendingCheckins();
        writePendingCheckins([payload, ...existing].slice(0, 50));
      };
      const postCheckin = async (payload: PendingCheckin) => {
        if (!online) {
          enqueuePayload(payload);
          return;
        }
        if (inflightCheckinRef.current) inflightCheckinRef.current.abort();
        const controller = new AbortController();
        inflightCheckinRef.current = controller;
        try {
          const result = await postCheckinJson('/api/store/checkin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              deviceId,
              status: payload.status,
              shelterId: payload.shelterId ?? null,
              lat: payload.lat,
              lon: payload.lon,
              precision: payload.precision,
              comment: payload.comment,
            }),
            signal: controller.signal,
          });
          if (result.ok) {
            const last = { status: payload.status, at: Date.now() };
            lastCheckinRef.current = last;
            writeLastCheckin(last);
            return;
          }
          if (!result.retryable) {
            const last = { status: payload.status, at: Date.now() };
            lastCheckinRef.current = last;
            writeLastCheckin(last);
            return;
          }
          if (!controller.signal.aborted) enqueuePayload(payload);
        } catch {
          if (!controller.signal.aborted) enqueuePayload(payload);
        } finally {
          if (inflightCheckinRef.current === controller) inflightCheckinRef.current = null;
        }
      };

      const now = Date.now();
      const last = lastCheckinRef.current ?? readLastCheckin();
      if (last) lastCheckinRef.current = last;
      const elapsed = last ? now - last.at : Number.POSITIVE_INFINITY;
      const statusUnchanged = last?.status === args.status;

      if (statusUnchanged && elapsed < MIN_CHECKIN_INTERVAL_MS) return;
      if (elapsed < MIN_CHECKIN_INTERVAL_MS) {
        pendingCheckinRef.current = pendingPayload;
        if (pendingCheckinTimerRef.current) window.clearTimeout(pendingCheckinTimerRef.current);
        pendingCheckinTimerRef.current = window.setTimeout(() => {
          pendingCheckinTimerRef.current = null;
          const pending = pendingCheckinRef.current;
          pendingCheckinRef.current = null;
          if (!pending) return;
          void postCheckin(pending);
        }, Math.max(MIN_CHECKIN_INTERVAL_MS - elapsed, 1000));
        return;
      }

      await postCheckin(pendingPayload);
    },
    [deviceId, online, persistLocal]
  );

  const flushPendingCheckins = useCallback(async () => {
    if (!deviceId || !online) return;
    if (flushingPendingCheckinsRef.current) return;
    flushingPendingCheckinsRef.current = true;
    try {
      const pending = readPendingCheckins();
      if (pending.length === 0) return;

      const remaining: PendingCheckin[] = [];
      for (const p of pending) {
        const result = await postCheckinJson('/api/store/checkin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            status: p.status,
            shelterId: p.shelterId ?? null,
            lat: p.lat,
            lon: p.lon,
            precision: p.precision,
            comment: p.comment,
          }),
        });
        if (result.ok) continue;
        if (!result.retryable) {
          const last = { status: p.status, at: Date.now() };
          lastCheckinRef.current = last;
          writeLastCheckin(last);
          continue;
        }
        remaining.push(p);
      }
      writePendingCheckins(remaining);
    } finally {
      flushingPendingCheckinsRef.current = false;
    }
  }, [deviceId, online]);

  useEffect(() => {
    if (!online || !deviceId) return;
    void flushPendingCheckins();
  }, [deviceId, flushPendingCheckins, online]);

  const exportTransferCode = useCallback(async (): Promise<string | null> => {
    if (!deviceId || !online) return null;
    try {
      const data = await safeFetchJson('/api/store/transfer/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      return typeof data?.code === 'string' ? data.code : null;
    } catch {
      return null;
    }
  }, [deviceId, online]);

  const importTransferCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!deviceId) return false;
      try {
        const data = await safeFetchJson('/api/store/transfer/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId, code }),
        });
        const serverDevice = data?.device as DeviceState | undefined;
        if (serverDevice) {
          setDevice(serverDevice);
          persistLocal(serverDevice);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    },
    [deviceId, persistLocal]
  );

  const exportTransferCodeLocal = useCallback(async (): Promise<string | null> => {
    if (!device) return null;
    try {
      return await encodeTransferCode({ v: 1, savedAreas: device.savedAreas, favorites: device.favorites, settings: device.settings });
    } catch {
      return null;
    }
  }, [device]);

  const importTransferCodeLocal = useCallback(
    async (code: string): Promise<boolean> => {
      const decoded = await decodeTransferCode(code);
      if (!decoded.ok) return false;
      const payload = decoded.payload ?? {};
      if (payload.v !== 1) return false;
      const savedAreas = Array.isArray(payload.savedAreas) ? payload.savedAreas : [];
      const favorites = payload.favorites && typeof payload.favorites === 'object' ? payload.favorites : null;
      const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : null;

      await updateDevice({
        savedAreas,
        favorites: favorites ? { shelterIds: Array.isArray(favorites.shelterIds) ? favorites.shelterIds : [] } : undefined,
        settings: settings ? settings : undefined,
      } as any);
      return true;
    },
    [updateDevice]
  );

  const selectedArea = useMemo(() => {
    if (!device?.settings?.selectedAreaId) return device?.savedAreas?.[0] ?? null;
    return device.savedAreas.find((a) => a.id === device.settings.selectedAreaId) ?? device.savedAreas?.[0] ?? null;
  }, [device?.savedAreas, device?.settings?.selectedAreaId]);

  const selectedJmaAreaCode = useMemo(() => {
    if (!selectedArea) return null;
    return selectedArea.jmaAreaCode ?? prefToJmaArea(selectedArea.prefCode);
  }, [selectedArea]);

  const currentJmaAreaCode = useMemo(() => {
    const prefCode = coarseArea?.prefCode;
    if (!prefCode || !/^\d{2}$/.test(prefCode)) return null;
    return prefToJmaArea(prefCode);
  }, [coarseArea?.prefCode]);

  const setCoarseArea = useCallback((area: { prefCode: string | null; muniCode: string | null; address: string | null } | null) => {
    setCoarseAreaState(area);
    try {
      if (!area) localStorage.removeItem(LS_AREA);
      else localStorage.setItem(LS_AREA, JSON.stringify(area));
    } catch {
      // ignore
    }
  }, []);

  const value: DeviceContextValue = useMemo(
    () => ({
      deviceId,
      device,
      online,
      coarseArea,
      setCoarseArea,
      selectedArea,
      selectedJmaAreaCode,
      currentJmaAreaCode,
      updateDevice,
      addSavedArea,
      removeSavedArea,
      setSelectedAreaId,
      setSettings,
      checkin,
      exportTransferCode,
      importTransferCode,
      exportTransferCodeLocal,
      importTransferCodeLocal,
    }),
    [
      addSavedArea,
      coarseArea,
      currentJmaAreaCode,
      device,
      deviceId,
      exportTransferCode,
      exportTransferCodeLocal,
      importTransferCode,
      importTransferCodeLocal,
      online,
      removeSavedArea,
      selectedArea,
      selectedJmaAreaCode,
      setCoarseArea,
      setSelectedAreaId,
      setSettings,
      updateDevice,
      checkin,
    ]
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) {
    return {
      deviceId: null,
      device: null,
      online: true,
      coarseArea: null,
      setCoarseArea: () => undefined,
      selectedArea: null,
      selectedJmaAreaCode: null,
      currentJmaAreaCode: null,
      updateDevice: async () => undefined,
      addSavedArea: async () => undefined,
      removeSavedArea: async () => undefined,
      setSelectedAreaId: async () => undefined,
      setSettings: async () => undefined,
      checkin: async () => undefined,
      exportTransferCode: async () => null,
      importTransferCode: async () => false,
      exportTransferCodeLocal: async () => null,
      importTransferCodeLocal: async () => false,
    };
  }
  return ctx;
}
