import { Seo } from '../components/Seo';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { useDevice } from '../components/device/DeviceProvider';
import ShareMenu from '../components/ShareMenu';
import { loadLastLocation, reverseGeocodeGsi, saveLastLocation, type Coords } from '../lib/client/location';
import { buildUrl, formatShelterShareText } from '../lib/client/share';
import { formatPrefMuniLabel, useAreaName } from '../lib/client/areaName';
import { DEFAULT_MAIN_LIMIT, MAP_DEFAULT_ZOOM } from '../lib/constants';
import { getAllSavedShelters, removeShelterFromStorage, saveShelterToStorage, type SavedShelter } from '../lib/client/shelterStorage';
import { toDisplayFetchStatus } from '../lib/ui/fetchStatusLabel';

const MapView = dynamic(() => import('../components/MapView'), {
  ssr: false,
  loading: () => <div className="flex h-80 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-600">地図を読み込み中...</div>,
});

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type NearbySite = {
  id: string;
  pref_city: string | null;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  hazards: any;
  is_same_address_as_shelter: boolean | null;
  notes: string | null;
  source_updated_at: string | null;
  updated_at: string;
  distanceKm?: number;
  distance?: number;
};

type SavedPlaceSummary = {
  id: string;
  placeType: string;
  placeTypeLabel: string;
  label: string;
  addressMemo?: string | null;
  address?: string | null;
  radiusKm: number;
};



function formatAt(iso: string | null | undefined): string {
  if (!iso) return '未更新';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '未更新';
  return new Date(t).toLocaleString();
}

function sanitizeUiError(value: unknown, code = 'DB_OUTDATED'): string {
  return value ? code : 'なし';
}

function formatDistanceKm(distance?: number): string {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return '距離不明';
  if (distance < 1) return `${Math.round(distance * 1000)}m`;
  if (distance < 10) return `${distance.toFixed(1)}km`;
  return `${distance.toFixed(0)}km`;
}

function formatPrefCityLabel(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '所在地不明';
  const m = text.match(/^(.*?[都道府県])(.*)$/);
  if (!m) {
    const muniMatch = text.match(/^(.*?[市区町村])/);
    return muniMatch?.[1]?.trim() || text;
  }
  const pref = m[1];
  const rest = (m[2] || '').trim();
  if (!rest) return pref;
  const muniMatch = rest.match(/^(.*?[市区町村])/);
  const muni = muniMatch?.[1]?.trim() ?? '';
  if (muni) return `${pref} ${muni}`.trim();
  return `${pref} ${rest}`.trim();
}

function googleMapsRouteUrl(args: { origin?: Coords | null; dest: Coords }) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${args.dest.lat},${args.dest.lon}`);
  if (args.origin) u.searchParams.set('origin', `${args.origin.lat},${args.origin.lon}`);
  u.searchParams.set('travelmode', 'walking');
  return u.toString();
}

function splitTitle(title: string): { short: string; area: string | null } {
  const t = (title ?? '').trim();
  const m = t.match(/^(.*?)[(（]([^()（）]+)[)）]/);
  if (m) return { short: m[1].trim() || t, area: m[2].trim() || null };
  return { short: t, area: null };
}

type CheckinStatus = 'SAFE' | 'INJURED' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED';
type SafetyPinsWindow = '24h' | '3d';
type CheckinEntry = {
  id: string;
  status: string;
  shelterId?: string | null;
  updatedAt: string;
  lat?: number | null;
  lon?: number | null;
  precision?: 'COARSE' | 'PRECISE';
  comment?: string | null;
  messagePublic?: boolean;
  expiresAt?: string | null;
  active?: boolean;
  archivedAt?: string | null;
};

const CHECKIN_STATUS_OPTIONS: Array<{ key: CheckinStatus; label: string; cls: string }> = [
  { key: 'SAFE', label: '無事', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { key: 'INJURED', label: '負傷', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  { key: 'ISOLATED', label: '孤立', cls: 'border-red-300 bg-red-50 text-red-900' },
  { key: 'EVACUATING', label: '避難中', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
  { key: 'COMPLETED', label: '避難完了', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
];

function getActiveCheckin(checkins: CheckinEntry[] | undefined): CheckinEntry | null {
  const list = Array.isArray(checkins) ? checkins : [];
  if (list.length === 0) return null;
  const hasExplicitActive = list.some((c) => typeof c?.active === 'boolean');
  if (hasExplicitActive) return list.find((c) => c?.active === true) ?? null;
  return list[0] ?? null;
}

function clearPendingSafetyPinQueue(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('jp_evac_pending_checkins_v1');
    localStorage.removeItem('jp_evac_last_checkin_v1');
  } catch {
    // ignore local storage failures
  }
}


export default function MainPage() {
  const router = useRouter();
  const { device, deviceId, updateDevice, coarseArea, setCoarseArea } = useDevice();
  const lowBandwidth = Boolean(device?.settings?.lowBandwidth || device?.settings?.powerSaving);
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });
  const savedAreaLabel = useMemo(() => {
    const selected = device?.settings?.selectedAreaId
      ? device?.savedAreas?.find((a) => a.id === device.settings.selectedAreaId)
      : device?.savedAreas?.[0];
    return formatPrefMuniLabel(selected ? { prefName: selected.prefName, muniName: selected.muniName ?? null } : null);
  }, [device?.savedAreas, device?.settings?.selectedAreaId]);
  const shareFromArea = coarseAreaLabel ?? savedAreaLabel ?? null;
  const locationTooltip = '位置情報は端末内で利用。表示・共有は都道府県・市区町村まで。';

  const [origin, setOrigin] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOrigin(window.location.origin);
  }, []);

  const [coords, setCoords] = useState<Coords | null>(null);
  const [coordsAccuracyM, setCoordsAccuracyM] = useState<number | null>(null);
  const [center, setCenter] = useState<Coords>({ lat: 35.681236, lon: 139.767125 });
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const last = loadLastLocation();
      if (last) {
        setCoords(last);
        setCenter(last);
        setCoordsAccuracyM(null);
      }
    } catch {
      // ignore
    }
  }, []);

  const requestLocation = () => {
    setLocError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
        setCoords(next);
        setCoordsAccuracyM(accuracy);
        setCenter(next);
        setRecenterSignal((v) => v + 1);
        saveLastLocation(next);
        try {
          const r = await reverseGeocodeGsi(next);
          setCoarseArea({ prefCode: r.prefCode, muniCode: r.muniCode, address: r.address });
        } catch {
          setCoarseArea(null);
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocError('位置情報の取得に失敗しました');
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60_000,
      }
    );
  };

  const nearbyLimit = useMemo(() => {
    const raw = Array.isArray(router.query.limit) ? router.query.limit[0] : router.query.limit;
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAIN_LIMIT;
    return Math.min(Math.floor(parsed), 50);
  }, [router.query.limit]);

  const nearbyCoords = coords ?? center;
  const nearbyUrl = nearbyCoords
    ? `/api/shelters/nearby?lat=${nearbyCoords.lat}&lon=${nearbyCoords.lon}&limit=${nearbyLimit}&radiusKm=30&hideIneligible=false&hazardTypes=`
    : null;
  const { data: nearbyData } = useSWR(nearbyUrl, fetcher, { dedupingInterval: 10_000, refreshInterval: 0 });
  const sites: NearbySite[] = nearbyData?.sites ?? [];
  const topNearby = useMemo(() => sites.slice(0, nearbyLimit), [nearbyLimit, sites]);
  const devDiagnostics = nearbyData?.devDiagnostics ?? null;

  const { data: healthData } = useSWR('/api/health', fetcher, { dedupingInterval: 60_000 });
  const sheltersCount: number | null = typeof healthData?.sheltersCount === 'number' ? healthData.sheltersCount : null;
  const dbConnected: boolean | null = typeof healthData?.dbConnected === 'boolean' ? healthData.dbConnected : null;
  const sheltersUnavailable = dbConnected === false || sheltersCount === 0;

  const isDev = process.env.NODE_ENV === 'development';
  const debugEnabled = isDev && String(router.query.debug ?? '') === '1';
  const showDevDataCard = Boolean(debugEnabled && coords);

  const firstDistanceKm = useMemo(() => {
    const first = sites[0] as any;
    const v =
      typeof first?.distanceKm === 'number'
        ? first.distanceKm
        : typeof first?.distance === 'number'
          ? first.distance
          : null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, [sites]);

  const favoriteIds = (device?.favorites?.shelterIds ?? []).slice(0, 5);
  const favoritesUrl = favoriteIds.length > 0 ? `/api/shelters/batch?ids=${encodeURIComponent(favoriteIds.join(','))}` : null;
  const {
    data: favoritesData,
    error: favoritesError,
    mutate: mutateFavorites,
    isLoading: favoritesLoading,
  } = useSWR(favoritesUrl, fetcher, { dedupingInterval: 60_000, keepPreviousData: true });
  const savedPlacesUrl = deviceId ? `/api/watch-regions?deviceId=${encodeURIComponent(deviceId)}` : null;
  const {
    data: savedPlacesData,
    error: savedPlacesError,
    isLoading: savedPlacesLoading,
  } = useSWR(savedPlacesUrl, fetcher, { dedupingInterval: 30_000, keepPreviousData: true });
  const savedPlaces: SavedPlaceSummary[] = Array.isArray(savedPlacesData?.regions) ? savedPlacesData.regions : [];
  const savedPlacesUnavailable = Boolean(savedPlacesError || savedPlacesData?.ok === false);
  const [localSavedShelters, setLocalSavedShelters] = useState<SavedShelter[]>([]);
  useEffect(() => {
    setLocalSavedShelters(getAllSavedShelters());
  }, []);

  const favoriteSitesById = useMemo(() => {
    const rows: NearbySite[] = favoritesData?.sites ?? favoritesData?.items ?? [];
    const map = new Map<string, NearbySite>();

    // 1. Populate from local storage first (offline support)
    for (const s of localSavedShelters) {
      map.set(s.id, s as NearbySite);
    }

    // 2. Override with API data if available (online)
    for (const s of rows) {
      map.set(s.id, s);
    }

    // 3. Ensure nearby sites are also used if they match favorite IDs
    for (const site of sites) {
      if (favoriteIds.includes(site.id)) map.set(site.id, site);
    }
    return map;
  }, [favoritesData, localSavedShelters, favoriteIds, sites]);

  const [toast, setToast] = useState<string | null>(null);
  const [nearbyOpenSignal, setNearbyOpenSignal] = useState(0);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const isFavorite = (id: string) => favoriteIds.includes(id);
  const setFavorite = (id: string, next: boolean, siteData?: NearbySite) => {
    const current = device?.favorites?.shelterIds ?? [];
    const already = current.includes(id);
    if (next && !already && current.length >= 5) {
      setToast('保存は最大5件です');
      return;
    }

    // Offline Storage Logic
    if (next && siteData) {
      saveShelterToStorage({
        id: siteData.id,
        name: siteData.name,
        address: siteData.address,
        pref_city: siteData.pref_city,
        lat: siteData.lat,
        lon: siteData.lon,
        hazards: siteData.hazards,
        updatedAt: new Date().toISOString(),
        is_same_address_as_shelter: Boolean(siteData.is_same_address_as_shelter),
        source_updated_at: siteData.source_updated_at,
        updated_at: siteData.updated_at,
      });
      setLocalSavedShelters(getAllSavedShelters());
    } else if (!next) {
      removeShelterFromStorage(id);
      setLocalSavedShelters(getAllSavedShelters());
    }

    const updated = next ? [id, ...current] : current.filter((s) => s !== id);
    void updateDevice({ favorites: { shelterIds: Array.from(new Set(updated)).slice(0, 5) } as any } as any);
    void mutateFavorites();
  };

  const [showSafetyPins, setShowSafetyPins] = useState(false);
  const [safetyPinsWindow, setSafetyPinsWindow] = useState<SafetyPinsWindow>('24h');
  const [safetyPinsStatus, setSafetyPinsStatus] = useState<string>('');
  useEffect(() => {
    if (!showSafetyPins) {
      setSafetyPinsStatus('');
      setSafetyPinsWindow('24h');
    }
  }, [showSafetyPins]);

  const safetyPinsUrl =
    showSafetyPins && !lowBandwidth
      ? `/api/store/checkins?window=${safetyPinsWindow}&status=${encodeURIComponent(safetyPinsStatus)}`
      : null;
  const { data: safetyPinsData, mutate: mutateSafetyPins } = useSWR(safetyPinsUrl, fetcher, {
    refreshInterval: showSafetyPins ? refreshMs : 0,
    dedupingInterval: 10_000,
  });
  const safetyPins: any[] = safetyPinsData?.pins ?? [];
  const safetyPinsPolicy: { reportCautionThreshold: number; reportHideThreshold: number } | null = safetyPinsData?.moderationPolicy ?? null;

  const { data: nationalUrgent } = useSWR('/api/jma/urgent', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const nationalItems: Array<{ id: string; title: string; updated: string | null }> = nationalUrgent?.items ?? [];

  const myActiveCheckin = getActiveCheckin(device?.checkins as CheckinEntry[] | undefined);
  const [myCheckinStatus, setMyCheckinStatus] = useState<CheckinStatus | null>(null);
  const [myCheckinComment, setMyCheckinComment] = useState('');
  const [myCheckinMessagePublic, setMyCheckinMessagePublic] = useState(false);
  const [checkinFormTouched, setCheckinFormTouched] = useState(false);
  const [safetyPinBusy, setSafetyPinBusy] = useState(false);
  const [safetyPinFeedback, setSafetyPinFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (checkinFormTouched) return;
    if (!myActiveCheckin) {
      setMyCheckinStatus(null);
      setMyCheckinComment('');
      setMyCheckinMessagePublic(false);
      return;
    }
    const normalizedStatus = CHECKIN_STATUS_OPTIONS.some((opt) => opt.key === myActiveCheckin.status)
      ? (myActiveCheckin.status as CheckinStatus)
      : null;
    setMyCheckinStatus(normalizedStatus);
    setMyCheckinComment(typeof myActiveCheckin.comment === 'string' ? myActiveCheckin.comment : '');
    setMyCheckinMessagePublic(Boolean(myActiveCheckin.messagePublic));
  }, [
    checkinFormTouched,
    myActiveCheckin?.comment,
    myActiveCheckin?.id,
    myActiveCheckin?.messagePublic,
    myActiveCheckin?.status,
    myActiveCheckin?.updatedAt,
  ]);

  const saveSafetyPin = async () => {
    setSafetyPinFeedback(null);
    if (!coords) {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を保存できませんでした' });
      return;
    }
    if (!deviceId) {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を保存できませんでした' });
      return;
    }
    if (!myCheckinStatus) {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を保存できませんでした' });
      return;
    }
    if ((myCheckinComment ?? '').trim().length > 140) {
      setSafetyPinFeedback({ kind: 'error', text: 'コメントは140文字以内で入力してください。' });
      return;
    }

    setSafetyPinBusy(true);
    try {
      clearPendingSafetyPinQueue();
      const res = await fetch('/api/store/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          status: myCheckinStatus,
          shelterId: null,
          lat: coords.lat,
          lon: coords.lon,
          locationAccuracyM: coordsAccuracyM,
          messagePublic: myCheckinMessagePublic,
          precision: 'COARSE',
          comment: myCheckinComment.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.ok === false || !payload?.device) {
        setSafetyPinFeedback({ kind: 'error', text: '安否情報を保存できませんでした' });
        return;
      }

      await updateDevice({ checkins: payload.device.checkins } as any);
      clearPendingSafetyPinQueue();
      setShowSafetyPins(true);
      if (showSafetyPins) await mutateSafetyPins();
      setCheckinFormTouched(false);
      const message = myActiveCheckin ? '安否を更新しました' : '安否を保存しました';
      setSafetyPinFeedback({ kind: 'success', text: message });
      setToast(message);
    } catch {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を保存できませんでした' });
    } finally {
      setSafetyPinBusy(false);
    }
  };

  const deleteSafetyPin = async () => {
    setSafetyPinFeedback(null);
    if (!deviceId) {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を削除できませんでした' });
      return;
    }
    if (!myActiveCheckin) {
      setSafetyPinFeedback({ kind: 'info', text: '安否ピンを削除しました' });
      return;
    }

    setSafetyPinBusy(true);
    try {
      clearPendingSafetyPinQueue();
      const res = await fetch('/api/store/checkin', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.ok === false || !payload?.device) {
        setSafetyPinFeedback({ kind: 'error', text: '安否情報を削除できませんでした' });
        return;
      }

      await updateDevice({ checkins: payload.device.checkins } as any);
      clearPendingSafetyPinQueue();
      if (showSafetyPins) await mutateSafetyPins();
      setMyCheckinStatus(null);
      setMyCheckinComment('');
      setMyCheckinMessagePublic(false);
      setCheckinFormTouched(false);
      setSafetyPinFeedback({ kind: 'success', text: '安否ピンを削除しました' });
      setToast('安否ピンを削除しました');
    } catch {
      setSafetyPinFeedback({ kind: 'error', text: '安否情報を削除できませんでした' });
    } finally {
      setSafetyPinBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Seo
        title="メイン"
        description="避難ナビ（HinaNavi）のメイン画面。現在地周辺の避難所を地図で確認し、距離順の一覧やハザード対応の目安を把握できます。警報・注意報や地震情報への導線も備え、災害時の行動判断を支援します。"
      />

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-row flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">いま避難先を探す</h1>
            <button
              disabled={locating}
              onClick={requestLocation}
              className="min-h-[44px] rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              title={locationTooltip}
            >
            現在地を取得
          </button>
        </div>

        {locError && <div className="mt-2 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">{locError}</div>}
        {(sheltersUnavailable || (coords && nearbyData?.fetchStatus === 'DOWN')) && (
          <div className="mt-2 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            避難場所データに接続できません。通信・サーバ状況を確認してください。
          </div>
        )}

        <div className="mt-4">
          {lowBandwidth ? (
            <div className="flex h-80 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-600">
              低帯域/省電力モードのため、地図は省略しています。
            </div>
          ) : (
            <MapView
              sites={sites as any}
              center={center}
              initialZoom={Math.min(MAP_DEFAULT_ZOOM + 2, 17)}
              recenterSignal={recenterSignal}
              origin={coords}
              fromAreaLabel={shareFromArea}
              onCenterChange={(next) =>
                setCenter((prev) => {
                  if (Math.abs(prev.lat - next.lat) < 1e-6 && Math.abs(prev.lon - next.lon) < 1e-6) return prev;
                  return next;
                })
              }
              onSelect={(site: any) => {
                void router.push(`/shelters/${site.id}`);
              }}
              isFavorite={isFavorite}
              onToggleFavorite={(id, on) => {
                const siteData = sites.find((s) => s.id === id) as NearbySite | undefined;
                setFavorite(id, on, siteData);
              }}
              onMarkerClick={() => {
                setNearbyOpenSignal((prev) => prev + 1);
              }}
              checkinPins={showSafetyPins ? (safetyPins as any) : null}
              checkinModerationPolicy={safetyPinsPolicy}
              onReportCheckin={async (pinId) => {
                if (!deviceId) return alert('deviceIdが未設定です');
                const reason = prompt('通報理由（任意）') ?? '';
                const res = await fetch('/api/store/checkins/report', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ deviceId, pinId, reason: reason || null }),
                });
                if (!res.ok) {
                  const j = await res.json().catch(() => null);
                  alert(j?.error ?? '通報できませんでした');
                  return;
                }
                setToast('通報しました');
                await mutateSafetyPins();
              }}
            />
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200">
              <input
                type="checkbox"
                checked={showSafetyPins}
                onChange={(e) => setShowSafetyPins(e.target.checked)}
                disabled={lowBandwidth}
              />
              <span className="font-semibold">みんなの安否ピン</span>
            </label>
            {showSafetyPins && (
              <div className="inline-flex rounded-xl border bg-white p-1 text-sm">
                <button
                  className={classNames(
                    'min-h-[36px] rounded-lg px-3 py-1.5 font-semibold',
                    safetyPinsWindow === '24h' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  )}
                  onClick={() => setSafetyPinsWindow('24h')}
                >
                  24時間
                </button>
                <button
                  className={classNames(
                    'min-h-[36px] rounded-lg px-3 py-1.5 font-semibold',
                    safetyPinsWindow === '3d' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                  )}
                  onClick={() => setSafetyPinsWindow('3d')}
                >
                  3日以内
                </button>
              </div>
            )}
            {showSafetyPins && (
              <select
                className="min-h-[44px] rounded-xl border bg-white px-3 py-2 text-sm"
                value={safetyPinsStatus}
                onChange={(e) => setSafetyPinsStatus(e.target.value)}
              >
                <option value="">状態: すべて</option>
                <option value="SAFE">無事</option>
                <option value="INJURED">負傷</option>
                <option value="ISOLATED">孤立</option>
                <option value="EVACUATING">避難中</option>
                <option value="COMPLETED">避難完了</option>
              </select>
            )}
          </div>
          <div className="text-xs text-gray-500">
          </div>
        </div>
        {showSafetyPins && safetyPinsData?.fetchStatus === 'DOWN' && (
          <div className="mt-2 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">安否情報を取得できませんでした</div>
        )}
        {showSafetyPins && (
          <div className="mt-2 rounded-xl border bg-gray-50 px-3 py-2 text-xs text-gray-700">
            共有ピン: {safetyPins.length}件 / 表示: {safetyPinsWindow === '24h' ? '24時間' : '3日以内'} / 更新: {formatAt(safetyPinsData?.updatedAt)}
          </div>
        )}


        <div className="mt-5 border-t pt-5">
          <NearbySheltersSection
            coords={coords}
            sites={sites}
            topNearby={topNearby}
            origin={origin}
            shareFromArea={shareFromArea}
            formatDistanceKm={formatDistanceKm}
            isFavorite={isFavorite}
            setFavorite={setFavorite}
            openSignal={nearbyOpenSignal}
          />
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-bold text-gray-900">自分の安否ピン</div>
              <div className="mt-1 text-xs text-gray-600">
                {myActiveCheckin
                  ? `現在の状態: ${CHECKIN_STATUS_OPTIONS.find((opt) => opt.key === myActiveCheckin.status)?.label ?? myActiveCheckin.status}`
                  : 'まだ安否ピンは保存されていません。'}
              </div>
              {myActiveCheckin && (
                <>
                  <div className="mt-1 text-xs text-gray-600">位置: {shareFromArea ?? 'おおよその位置情報あり'}</div>
                  <div className="mt-1 text-xs text-gray-600">更新: {formatAt(myActiveCheckin.updatedAt)}</div>
                  <div className="mt-1 text-xs text-gray-600">
                    有効期限: {typeof myActiveCheckin.expiresAt === 'string' ? formatAt(myActiveCheckin.expiresAt) : '72時間以内'}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-4">
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
              <div>位置はおおよその範囲で表示されます。正確な位置は公開されません。</div>
              <div className="mt-1">個人情報・電話番号・詳しい住所は書かないでください。</div>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-700">状態を選ぶ</div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                {CHECKIN_STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.key}
                    className={classNames(
                      'rounded-lg border px-2 py-2 text-sm font-bold ring-1 transition-all hover:brightness-95',
                      myCheckinStatus === s.key ? s.cls : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50',
                      myCheckinStatus === s.key ? 'ring-2 ring-offset-1 ring-blue-500 shadow-md transform scale-105' : 'ring-transparent opacity-80 hover:opacity-100'
                    )}
                    onClick={() => {
                      setMyCheckinStatus(s.key);
                      setCheckinFormTouched(true);
                      setSafetyPinFeedback(null);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs font-semibold text-gray-700">コメント（任意）</div>
              <input
                className="mt-1 min-h-[44px] w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="必要な支援や周辺状況を簡潔に入力"
                maxLength={140}
                value={myCheckinComment}
                onChange={(e) => {
                  setMyCheckinComment(e.target.value);
                  setCheckinFormTouched(true);
                  setSafetyPinFeedback(null);
                }}
              />
              <div className="mt-1 text-xs text-gray-500">{myCheckinComment.length} / 140</div>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={myCheckinMessagePublic}
                  onChange={(e) => {
                    setMyCheckinMessagePublic(e.target.checked);
                    setCheckinFormTouched(true);
                    setSafetyPinFeedback(null);
                  }}
                />
                コメントを公開する
              </label>
            </div>

            {safetyPinFeedback && (
              <div
                className={classNames(
                  'rounded-xl border px-3 py-2 text-sm',
                  safetyPinFeedback.kind === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : safetyPinFeedback.kind === 'error'
                      ? 'bg-red-50 text-red-900 border-red-200'
                      : 'bg-gray-50 text-gray-800 border-gray-200'
                )}
              >
                {safetyPinFeedback.text}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t pt-3 md:flex-row">
              <button
                className="min-h-[48px] flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-extrabold text-white shadow hover:bg-black disabled:opacity-60"
                disabled={safetyPinBusy}
                onClick={saveSafetyPin}
              >
                {safetyPinBusy ? '保存中...' : myActiveCheckin ? '安否を更新する' : '安否を保存する'}
              </button>
              <button
                className="min-h-[48px] rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
                disabled={safetyPinBusy || !myActiveCheckin}
                onClick={deleteSafetyPin}
              >
                安否ピンを削除する
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-blue-50/60 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-gray-900">登録済みの場所</div>
              <div className="mt-1 text-xs text-gray-600">自宅・学校・職場など、よく確認する場所を登録できます。</div>
            </div>
            <div className="flex gap-2">
              <Link href="/watch" className="inline-flex min-h-[44px] items-center rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-blue-100 hover:bg-blue-50">
                すべて見る
              </Link>
              <Link href="/watch" className="inline-flex min-h-[44px] items-center rounded-xl bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800">
                場所を追加
              </Link>
            </div>
          </div>
          {savedPlacesLoading && <div className="mt-3 text-xs text-gray-600">読み込み中...</div>}
          {savedPlacesUnavailable && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">登録済みの場所を取得できませんでした。</div>}
          {!savedPlacesLoading && !savedPlacesUnavailable && savedPlaces.length === 0 && (
            <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-600">まだ登録されていません。</div>
          )}
          {savedPlaces.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {savedPlaces.slice(0, 3).map((place) => (
                <div key={place.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-blue-100">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800">{place.placeTypeLabel}</span>
                    <span className="min-w-0 truncate text-sm font-bold text-gray-900">{place.label}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-600">{place.addressMemo ?? place.address ?? `半径 ${place.radiusKm}km`}</div>
                </div>
              ))}
            </div>
          )}
        </div>



        {showDevDataCard && (
          <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-2 text-xs text-gray-800">
            <div className="font-semibold">データ接続（dev）</div>
            <div className="mt-1">
              nearby: {toDisplayFetchStatus(nearbyData?.fetchStatus)} / 件数: {sites.length} / 先頭距離: {firstDistanceKm !== null ? `${firstDistanceKm.toFixed(2)}km` : '不明'} / 更新:{' '}
              {formatAt(nearbyData?.updatedAt)} / err: {sanitizeUiError(nearbyData?.lastError)}
            </div>
            <div className="mt-1">
              minDistanceKm(50件): {devDiagnostics?.minDistanceKm !== null && devDiagnostics?.minDistanceKm !== undefined ? devDiagnostics.minDistanceKm.toFixed(2) : '不明'} /
              within1Km: {devDiagnostics?.countWithin1Km ?? '?'} / within5Km: {devDiagnostics?.countWithin5Km ?? '?'}
            </div>
            <div className="mt-1">
              health: dbConnected={String(Boolean(healthData?.dbConnected))} / sheltersCount={String(healthData?.sheltersCount ?? '?')} /
              nearbySampleCount={String(healthData?.nearbySampleCount ?? '?')} / err: {sanitizeUiError(healthData?.lastError)}
            </div>
          </div>
        )}

      </section>

      <section className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-bold">保存した避難場所（最大5件）</h2>
        {favoriteIds.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">よく使う避難場所を保存できます。</div>
        ) : (
          <>
            {(favoritesError || favoritesData?.fetchStatus === 'DOWN') && (
              <div className="mt-2 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
                保存した避難場所の読み込みに失敗しました。
              </div>
            )}

            {!favoritesError && favoritesUrl && favoritesLoading && favoriteSitesById.size === 0 && (
              <div className="mt-2 text-sm text-gray-600">読み込み中...</div>
            )}

            <div className="mt-3 space-y-2">
              {favoriteIds.map((id) => {
                const site = favoriteSitesById.get(id);
                return (
                  <div key={id} className="flex items-center justify-between gap-2 rounded-xl border bg-gray-50 px-3 py-2">
                    <button className="min-h-[44px] min-w-0 text-left" onClick={() => void router.push(`/shelters/${id}`)}>
                      <div className="truncate font-semibold">{site?.name ?? '避難場所'}</div>
                      <div className="truncate text-xs text-gray-600">{site?.address ?? formatPrefCityLabel(site?.pref_city)}</div>
                    </button>
                    <button
                      onClick={() => setFavorite(id, false)}
                      className="min-h-[44px] rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
                    >
                      削除
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {nationalItems.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-red-900">全国で重大な警報が出ています</h2>
              <div className="mt-1 text-sm text-red-800">内容は地域により異なります。必ず公式情報も確認してください。</div>
            </div>
            <button
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              onClick={() => void router.push('/alerts')}
            >
              詳細（警報）
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {nationalItems.slice(0, 3).map((it) => {
              const { short, area } = splitTitle(it.title);
              return (
                <div key={it.id} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-red-100">
                  <div className="font-semibold">{short}</div>
                  <div className="mt-1 text-xs text-gray-700">{area ? `対象: ${area}` : '対象: 情報内に記載なし'}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}


      {toast && <div className="rounded-xl border bg-gray-900 px-4 py-3 text-sm font-semibold text-white">{toast}</div>}
    </div>
  );
}

function NearbySheltersSection({
  coords,
  sites,
  topNearby,
  origin,
  shareFromArea,
  formatDistanceKm,
  isFavorite,
  setFavorite,
  openSignal,
}: {
  coords: Coords | null;
  sites: any[];
  topNearby: any[];
  origin: any;
  shareFromArea: string | null;
  formatDistanceKm: (d?: number) => string;
  isFavorite: (id: string) => boolean;
  setFavorite: (id: string, next: boolean, site?: any) => void;
  openSignal?: number;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setIsOpen(true);
  }, [openSignal]);

  return (
    <div>
      <button
        className="flex w-full items-center justify-between rounded-xl border border-gray-300 bg-white p-3 hover:bg-gray-50"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">近くの避難場所（タップで開閉）</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">
            {coords ? `${sites.length}件` : '未取得'}
          </span>
          <div className={classNames("text-gray-400 transition-transform", isOpen ? "rotate-90" : "rotate-0")}>
            ▶
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {!coords && (
            <div className="rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
              まず「現在地を取得」を押してください。
            </div>
          )}

          {coords && topNearby.length === 0 && <div className="text-sm text-gray-600">近くの避難場所が見つかりませんでした。</div>}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {topNearby.map((site) => {
              const caution = Boolean(site.is_same_address_as_shelter);
              const dest = { lat: site.lat, lon: site.lon };
              const shareUrl = origin ? buildUrl(origin, `/shelters/${site.id}`, {}) : null;

              return (
                <div
                  key={site.id}
                  className={classNames('rounded-xl border bg-white p-2 shadow-sm hover:border-gray-400', caution && 'opacity-75')}
                  onClick={() => void router.push(`/shelters/${site.id}`)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">{site.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-gray-700">{site.address ?? '所在地不明'}</div>
                      {caution && (
                        <div className="mt-0.5 text-[10px] font-semibold text-amber-800 break-words">
                          {site.is_same_address_as_shelter ? '同一住所データの可能性（要確認）' : ''}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <div className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-900">
                        {formatDistanceKm(site.distanceKm ?? site.distance)}
                      </div>
                      <button
                        className={classNames(
                          'rounded px-1.5 py-1 text-xs font-bold ring-1',
                          isFavorite(site.id)
                            ? 'bg-amber-500 text-white ring-amber-600 hover:bg-amber-600'
                            : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFavorite(site.id, !isFavorite(site.id), site);
                        }}
                        title={isFavorite(site.id) ? '保存を解除' : '保存'}
                      >
                        {isFavorite(site.id) ? '★' : '☆'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                    <div className="flex flex-wrap gap-1">
                      {hazardKeys
                        .filter((k) => Boolean((site.hazards as any)?.[k]))
                        .slice(0, 2)
                        .map((k) => (
                          <span
                            key={k}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200 whitespace-nowrap"
                          >
                            {hazardLabels[k]}
                          </span>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="inline-flex min-h-[36px] items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                        onClick={() => void router.push(`/shelters/${site.id}`)}
                      >
                        詳細
                      </button>
                      <a
                        href={googleMapsRouteUrl({ origin: coords, dest })}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[36px] items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                      >
                        経路
                      </a>
                      <ShareMenu
                        shareUrl={shareUrl}
                        getShareText={() =>
                          formatShelterShareText({
                            shelterName: site.name,
                            address: site.address ?? null,
                            fromArea: shareFromArea,
                            now: new Date(),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
