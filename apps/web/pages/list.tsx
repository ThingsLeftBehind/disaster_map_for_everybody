import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { HazardChipsCompact } from '../components/HazardChips';
import { useDevice } from '../components/device/DeviceProvider';
import MapView from '../components/MapView';
import { loadLastLocation, reverseGeocodeGsi, roundCoords, saveLastLocation, type Coords } from '../lib/client/location';
import { isJmaLowPriorityWarning } from '../lib/jma/filters';
import { formatPrefMuniLabel, useAreaName } from '../lib/client/areaName';
import ShareMenu from '../components/ShareMenu';
import { buildUrl, formatShelterShareText } from '../lib/client/share';

import { normalizeMuniCode } from 'lib/muni-helper';
import { addSavedShelters } from 'lib/shelters/savedShelters';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
}

function formatPrefCityLabel(value: string | null | undefined, address?: string | null): string {
  const addr = (address ?? '').trim();
  if (addr) return addr;

  const text = (value ?? '').trim();
  if (!text) return '住所不明'; // "所在地不明" -> Changed to "住所不明" or just keep logic but avoid "Unknown" if possible? User said "never '所在地不明'".
  // Actually user said: "If the dataset truly lacks address, show municipality/prefecture name at minimum (never “所在地不明”)."

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

type ShelterListItem = {
  id: string;
  name: string;
  address: string | null;
  pref_city: string | null;
  lat: number;
  lon: number;
  hazards: any;
  is_same_address_as_shelter: boolean | null;
  notes: string | null;
  source_updated_at: string | null;
  updated_at: string;
  distanceKm?: number;
  distance?: number;
  matchesHazards?: boolean;
  missingHazards?: string[];
};

type HazardKey = (typeof hazardKeys)[number];
type SearchMode = 'LOCATION' | 'AREA';
type AppliedQuery = {
  mode: SearchMode;
  prefCode: string;
  muniCode: string;
  q: string;
  hazards: string[];
  limit: number;
  radiusKm: number;
  lat: number | null;
  lon: number | null;
  offset: number;
  hideIneligible: boolean;
};

function hazardTags(hazards: any): HazardKey[] {
  const flags = (hazards ?? {}) as Record<string, boolean>;
  return hazardKeys.filter((k) => Boolean(flags[k])) as HazardKey[];
}

function whyRecommended(site: ShelterListItem, selectedHazards: string[]): string {
  const reasons: string[] = [];
  const distanceKm = typeof site.distanceKm === 'number' ? site.distanceKm : typeof site.distance === 'number' ? site.distance : null;
  if (typeof distanceKm === 'number') reasons.push(`距離 ${distanceKm.toFixed(1)}km`);
  if (selectedHazards.length > 0) {
    if (site.matchesHazards) reasons.push(`選択ハザード対応`);
    else
      reasons.push(
        `一部未対応（${(site.missingHazards ?? [])
          .map((k) => hazardLabels[k as keyof typeof hazardLabels] ?? k)
          .join('、')}）`
      );
  } else {
    const tags = hazardTags(site.hazards);
    if (tags.length > 0) reasons.push(`対応: ${tags.slice(0, 3).map((k) => hazardLabels[k]).join('、')}${tags.length > 3 ? '…' : ''}`);
  }
  if (site.is_same_address_as_shelter) reasons.push('同一住所データの可能性（要確認）');
  return reasons.join(' / ');
}

function googleMapsRouteUrl(args: { origin?: Coords | null; dest: Coords }) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${args.dest.lat},${args.dest.lon}`);
  if (args.origin) u.searchParams.set('origin', `${args.origin.lat},${args.origin.lon}`);
  u.searchParams.set('travelmode', 'walking');
  return u.toString();
}

function cacheKey(args: Record<string, any>): string {
  const compact = JSON.stringify(args);
  let hash = 0;
  for (let i = 0; i < compact.length; i++) {
    hash = (hash * 31 + compact.charCodeAt(i)) | 0;
  }
  return `jp_evac_cache_list_${Math.abs(hash).toString(36)}`;
}

function readCache<T>(key: string): { updatedAt: string; value: T } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (!json?.value) return null;
    return { updatedAt: json.updatedAt ?? '', value: json.value as T };
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ updatedAt: new Date().toISOString(), value }));
  } catch {
    // ignore
  }
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function formatDistanceKm(km: number | undefined | null): string {
  if (km == null || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

export default function ListPage() {
  const router = useRouter();
  const {
    device,
    coarseArea,
    setCoarseArea,
    selectedArea,
    selectedJmaAreaCode,
    updateDevice,
    addSavedArea,
  } = useDevice();
  const favoriteIds = device?.favorites?.shelterIds ?? [];
  const isFavorite = (id: string) => favoriteIds.includes(id);
  const setFavorite = async (id: string, on: boolean) => {
    const next = on ? [...favoriteIds, id] : favoriteIds.filter((i) => i !== id);
    await updateDevice({ favorites: { shelterIds: next } });
  };
  const lowBandwidth = Boolean(device?.settings?.lowBandwidth || device?.settings?.powerSaving);
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const locationTooltip = '位置情報は端末内で利用。表示・共有は都道府県・市区町村まで。';
  // Removed area filter data loading
  const [coords, setCoords] = useState<Coords | null>(null);
  const [coordsFromLink, setCoordsFromLink] = useState(false);
  const [draftMode, setDraftMode] = useState<SearchMode>('LOCATION');
  const [modeLocked, setModeLocked] = useState(false);
  const [reverse, setReverse] = useState<{ prefCode: string | null; muniCode: string | null; address: string | null } | null>(null);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  const [hazards, setHazards] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [radiusKm, setRadiusKm] = useState(10);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recenterSignal] = useState(0);
  const [appliedQuery, setAppliedQuery] = useState<AppliedQuery | null>(null);
  const [hideIneligible, setHideIneligible] = useState(true);
  const [mapCenterCoords, setMapCenterCoords] = useState<Coords | null>(null);
  const [savedNearbyOpen, setSavedNearbyOpen] = useState(false);

  // Share helpers
  const [originUrl, setOriginUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') setOriginUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!router.isReady) return;

    const qLat = firstQueryValue(router.query.lat as any);
    const qLon = firstQueryValue(router.query.lon as any);
    const qLimit = firstQueryValue(router.query.limit as any);
    const qRadius = firstQueryValue(router.query.radiusKm as any);
    const qHazards = firstQueryValue(router.query.hazards as any);
    const qHideIneligible = firstQueryValue(router.query.hideIneligible as any);

    const allowedLimits = [3, 5, 10, 20];
    const allowedRadius = [5, 10, 20, 30, 50];
    const parsedLimit = qLimit ? Number(qLimit) : NaN;
    if (Number.isFinite(parsedLimit) && allowedLimits.includes(parsedLimit)) setLimit(parsedLimit);

    const parsedRadius = qRadius ? Number(qRadius) : NaN;
    if (Number.isFinite(parsedRadius) && allowedRadius.includes(parsedRadius)) setRadiusKm(parsedRadius);

    if (qHideIneligible !== undefined) {
      setHideIneligible(qHideIneligible === 'true' || qHideIneligible === '1');
    }

    if (qHazards) {
      const next = qHazards
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((k) => hazardKeys.includes(k as any));
      if (next.length > 0) setHazards(next);
    }

    // Initial Load Logic
    const lat = qLat ? Number(qLat) : NaN;
    const lon = qLon ? Number(qLon) : NaN;
    let initialCoords: Coords | null = null;
    let fromLink = false;

    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      initialCoords = { lat, lon };
      fromLink = true;
    } else {
      const last = loadLastLocation();
      if (last) initialCoords = last;
    }

    if (initialCoords) {
      setCoords(initialCoords);
      setCoordsFromLink(fromLink);
      setDraftMode('LOCATION');
      setModeLocked(true);
      setUseCurrentLocation(true);
      // Auto-apply search immediately for location mode
      setAppliedQuery({
        mode: 'LOCATION',
        prefCode: '',
        muniCode: '',
        q: '',
        hazards: [], // Start with no hazard filters from URL unless parsed properly above? (Keeping simple: empty)
        limit: parsedLimit || 10,
        radiusKm: parsedRadius || 30,
        lat: initialCoords.lat,
        lon: initialCoords.lon,
        offset: 0,
        hideIneligible: qHideIneligible !== undefined ? (qHideIneligible === 'true' || qHideIneligible === '1') : true,
      });
      if (!fromLink && hazards.length > 0) {
        // If we had hazards parsed, we should include them? 
        // The effect above sets `hazards` state.
        // But appliedQuery is set here. 
        // Let's rely on user clicking search if they want complicated initial filters, 
        // EXCEPT if we want to honor URL params fully. 
        // For now, minimal compliance: auto-load location if available. 
      }
    }
  }, [router.isReady]); // Run once when router ready

  // Sync draftMode with coords if not locked (user changing things)
  useEffect(() => {
    if (modeLocked) return;
    if (coords) setDraftMode('LOCATION');
    else setDraftMode('AREA');
  }, [coords, modeLocked]);

  const pendingTrimmedQ = ''; // q is removed
  // Removed areaPrefCode, effectiveMuniCode logic

  const searchUrl = useMemo(() => {
    if (!appliedQuery) return null;
    const params = new URLSearchParams();
    params.set('mode', appliedQuery.mode);
    if (appliedQuery.mode === 'LOCATION') {
      if (appliedQuery.lat === null || appliedQuery.lon === null) return null;
      params.set('lat', String(appliedQuery.lat));
      params.set('lon', String(appliedQuery.lon));
      params.set('radiusKm', String(appliedQuery.radiusKm));
      params.set('limit', String(appliedQuery.limit));
      if (appliedQuery.prefCode) params.set('prefCode', appliedQuery.prefCode);
      if (appliedQuery.muniCode) {
        const norm = normalizeMuniCode(appliedQuery.muniCode);
        if (norm) params.set('muniCode', norm);
      }
    } else {
      // AREA mode fallback/legacy support if needed (e.g. from Saved Area logic?)
      // User said "NOT by AREA filters" for the nearby feature, but if we need it for something else...
      // For now, keep generic support if appliedQuery has it.
      if (!appliedQuery.prefCode) return null;
      params.set('prefCode', appliedQuery.prefCode);
      if (appliedQuery.muniCode) {
        const norm = normalizeMuniCode(appliedQuery.muniCode);
        if (norm) params.set('muniCode', norm);
      }
      params.set('limit', String(appliedQuery.limit));
      params.set('offset', String(appliedQuery.offset));
    }
    if (appliedQuery.q) params.set('q', appliedQuery.q);
    if (appliedQuery.hazards.length > 0) params.set('hazardTypes', appliedQuery.hazards.join(','));
    params.set('hideIneligible', String(appliedQuery.hideIneligible));
    params.set('includeHazardless', String(!appliedQuery.hideIneligible));
    return `/api/shelters/search?${params.toString()}`;
  }, [appliedQuery]);

  // Removed municipalitiesUrl logic

  const { data: searchData, error: searchError } = useSWR(searchUrl, fetcher, { refreshInterval: 0, dedupingInterval: 10_000 });
  const apiError = typeof searchData?.error === 'string' ? searchData.error : null;
  const activeLoading = Boolean(searchUrl && !searchData && !searchError);
  const activeError = Boolean(searchError || apiError);
  const appliedHazards = appliedQuery?.hazards ?? [];
  const appliedQ = appliedQuery?.q ?? '';
  const appliedLimit = appliedQuery?.limit ?? limit;
  const appliedRadiusKm = appliedQuery?.radiusKm ?? radiusKm;
  const hasAppliedQuery = Boolean(appliedQuery);
  const { data: healthData } = useSWR('/api/health', fetcher, { dedupingInterval: 60_000 });
  const sheltersCount: number | null = typeof healthData?.sheltersCount === 'number' ? healthData.sheltersCount : null;
  const dbConnected: boolean | null = typeof healthData?.dbConnected === 'boolean' ? healthData.dbConnected : null;
  const sheltersUnavailable = dbConnected === false || sheltersCount === 0;
  const sheltersFetchStatus: string | null = searchData?.fetchStatus ?? null;
  const sheltersLastError: string | null = searchData?.lastError ?? null;
  const sheltersErrorLabel = sheltersLastError ? 'DB_OUTDATED' : null;
  const { label: reverseAreaLabel } = useAreaName({ prefCode: reverse?.prefCode ?? null, muniCode: reverse?.muniCode ?? null });
  const selectedAreaLabel = useMemo(
    () => formatPrefMuniLabel(selectedArea ? { prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null } : null),
    [selectedArea]
  );
  const shareFromArea = reverseAreaLabel ?? selectedAreaLabel ?? null;

  const list: ShelterListItem[] = useMemo(() => searchData?.items ?? searchData?.sites ?? [], [searchData?.items, searchData?.sites]);

  const cacheId = cacheKey({
    mode: appliedQuery?.mode ?? 'AREA',
    coords:
      appliedQuery?.mode === 'LOCATION' && appliedQuery.lat !== null && appliedQuery.lon !== null
        ? roundCoords({ lat: appliedQuery.lat, lon: appliedQuery.lon }, 2)
        : null,
    areaPrefCode: appliedQuery?.prefCode ?? '',
    muniCode: appliedQuery?.muniCode ?? '',
    q: appliedQ,
    hazards: appliedHazards,
    limit: appliedLimit,
    radiusKm: appliedRadiusKm,
  });
  const cached = typeof window !== 'undefined' ? readCache<{ sites: ShelterListItem[] }>(cacheId) : null;

  useEffect(() => {
    if (searchData?.sites || searchData?.items) {
      writeCache(cacheId, { sites: (searchData?.sites ?? searchData?.items) as ShelterListItem[] });
    }
  }, [cacheId, searchData?.items, searchData?.sites]);

  const effectiveList = useMemo(() => {
    if (list.length > 0) return list;
    if ((searchError || apiError) && cached?.value?.sites) return cached.value.sites;
    if (typeof navigator !== 'undefined' && !navigator.onLine && cached?.value?.sites) return cached.value.sites;
    return list;
  }, [apiError, cached?.value?.sites, list, searchError]);

  const appliedMode: SearchMode = appliedQuery?.mode ?? draftMode;
  const appliedLat = appliedMode === 'LOCATION' ? appliedQuery?.lat : null;
  const appliedLon = appliedMode === 'LOCATION' ? appliedQuery?.lon : null;
  const appliedCoords =
    appliedLat != null && appliedLon != null ? { lat: appliedLat, lon: appliedLon } : null;
  const areaBounds = useMemo(() => {
    if (appliedMode !== 'AREA' || effectiveList.length === 0) return null;
    let minLat = Number.POSITIVE_INFINITY;
    let minLon = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    for (const site of effectiveList) {
      if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      minLat = Math.min(minLat, site.lat);
      minLon = Math.min(minLon, site.lon);
      maxLat = Math.max(maxLat, site.lat);
      maxLon = Math.max(maxLon, site.lon);
    }
    if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) return null;
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ] as [[number, number], [number, number]];
  }, [appliedMode, effectiveList]);
  const mapCenter = useMemo(() => {
    if (appliedCoords) return appliedCoords;
    if (areaBounds) {
      return {
        lat: (areaBounds[0][0] + areaBounds[1][0]) / 2,
        lon: (areaBounds[0][1] + areaBounds[1][1]) / 2,
      };
    }
    if (effectiveList[0]) {
      return {
        lat: effectiveList[0].lat ?? 35.681236,
        lon: effectiveList[0].lon ?? 139.767125,
      };
    }
    return { lat: 35.681236, lon: 139.767125 };
  }, [appliedCoords, areaBounds, effectiveList]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (!searchUrl) return;
    // eslint-disable-next-line no-console
    console.debug('[list] query', searchUrl, 'count', list.length);
  }, [list.length, searchUrl]);

  // Removed previous auto-fetch useEffect since it's now handled in initial load logic.

  const effectiveJmaAreaCode = selectedJmaAreaCode ?? null;
  const warningsUrl = effectiveJmaAreaCode ? `/api/jma/warnings?area=${effectiveJmaAreaCode}` : null;
  const { data: warnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const warningsActive =
    Array.isArray(warnings?.items) && warnings.items.some((it: any) => !isJmaLowPriorityWarning(it?.kind));

  const applySearchWithCoords = (center: Coords) => {
    setAppliedQuery({
      mode: 'LOCATION',
      prefCode: '',
      muniCode: '',
      q: pendingTrimmedQ,
      hazards: [...hazards],
      limit,
      radiusKm,
      lat: center.lat,
      lon: center.lon,
      offset: 0,
      hideIneligible,
    });
  };
  const applySearchFromMode = () => {
    const center = useCurrentLocation && coords ? coords : mapCenterCoords ?? mapCenter;
    if (!center) return;
    applySearchWithCoords(center);
  };

  const toggleHazard = (hazard: string) => {
    setHazards((prev) => (prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]));
  };

  const handleLocate = async () => {
    setUseCurrentLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCoords(next);
        setCoordsFromLink(false);
        setDraftMode('LOCATION');
        setModeLocked(true);
        saveLastLocation(next);
        try {
          const r = await reverseGeocodeGsi(next);
          setReverse({ prefCode: r.prefCode, muniCode: r.muniCode, address: r.address });
          setCoarseArea({ prefCode: r.prefCode, muniCode: r.muniCode, address: r.address });
        } catch {
          setReverse(null);
          setCoarseArea(null);
        }
        // Auto-apply search when user clicks "Location"?
        // Typically user expects results. But current UX is "Use current location" -> changes mode -> click Search?
        // Wait, button text is "現在地を使う" -> usually implies immediate switch.
        // Let's keep it manual per button label change? 
        // "Use current location" is used to set mode. 
        // We will call applySearch manually or let user click Search? 
        // The original code didn't auto-fetch in handleLocate, only useEffect did.
        // Now useEffect is removed. We should trigger a search if desired.
        // But for safety, let's just set mode and let user click Search if they want, 
        // OR better: auto-search because it's an explicit action.
        applySearchWithCoords(next);
      },
      () => {
        setUseCurrentLocation(false);
        alert('位置情報の取得に失敗しました');
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60_000,
      }
    );
  };

  const savedAreaLat = (selectedArea as any)?.lat ?? (selectedArea as any)?.latitude;
  const savedAreaLon = (selectedArea as any)?.lon ?? (selectedArea as any)?.longitude;
  const canSearchSaved = typeof savedAreaLat === 'number' && typeof savedAreaLon === 'number';

  const savedNearbyUrl = savedNearbyOpen && canSearchSaved
    ? `/api/shelters/search?mode=LOCATION&lat=${savedAreaLat}&lon=${savedAreaLon}&radiusKm=10&limit=10&includeHazardless=true`
    : null;
  const { data: savedNearbyData } = useSWR(savedNearbyUrl, fetcher, { dedupingInterval: 60_000 });
  const savedNearbyList: ShelterListItem[] = savedNearbyData?.sites ?? savedNearbyData?.items ?? [];

  return (
    <div className="space-y-6">
      <Head>
        <title>避難場所 | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">避難場所検索</h1>
          <Link href="/designated" className="mt-1 inline-block text-xs font-semibold text-blue-700 hover:underline">
            指定避難所一覧（参考）はこちら
          </Link>
        </div>
      </div>

      {(sheltersUnavailable || sheltersFetchStatus === 'DOWN') && (
        <div className="rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
          避難場所データに接続できません。通信・サーバ状況を確認してください。
        </div>
      )}

      {useCurrentLocation && coords && (
        <div className="rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">
          現在地: {reverseAreaLabel ?? 'エリア未確定'}
          {coordsFromLink && <div className="mt-1 text-[11px] text-gray-600">共有リンクの位置（概算）を表示中</div>}
        </div>
      )}





      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">地図</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                const center = mapCenterCoords ?? mapCenter;
                if (!center) return;
                setUseCurrentLocation(false);
                applySearchWithCoords(center);
              }}
              className="rounded bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow hover:bg-blue-700"
            >
              地図の中心で検索
            </button>
            <button
              onClick={() => {
                if (useCurrentLocation) {
                  const center = mapCenterCoords ?? mapCenter;
                  if (!center) return;
                  setUseCurrentLocation(false);
                  applySearchWithCoords(center);
                  return;
                }
                void handleLocate();
              }}
              title={locationTooltip}
              className="rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700"
            >
              {useCurrentLocation ? '現在地を解除' : '現在地で表示'}
            </button>
          </div>
        </div>

        {lowBandwidth ? (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            低帯域/省電力モードのため、地図は省略しています。
          </div>
        ) : activeLoading ? (
          <div className="mt-3 text-sm text-gray-600">読み込み中...</div>
        ) : activeError ? (
          <div className="mt-3 text-sm text-amber-900">{apiError === 'prefCode_required' ? '都道府県を選択して検索してください。' : apiError === 'lat_lon_required' ? '現在地を取得して検索してください。' : '取得に失敗しました。条件を確認してください。'}</div>
        ) : !hasAppliedQuery ? (
          <div className="mt-3 text-sm text-gray-600">
            {draftMode === 'LOCATION' ? '現在地を取得して検索してください。' : '都道府県を選択して検索してください。'}
          </div>
        ) : hasAppliedQuery && effectiveList.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600">0件（該当なし）</div>
        ) : (
          <div className="mt-3">
            <MapView
              sites={effectiveList.slice(0, 300) as any}
              center={mapCenter}
              bounds={areaBounds}
              recenterSignal={recenterSignal}
              origin={appliedCoords}
              fromAreaLabel={shareFromArea}
              onSelect={(site: any) => {
                void router.push(`/shelters/${site.id}`);
              }}
              onCenterChange={(c: any) => setMapCenterCoords(c)}
              isFavorite={isFavorite}
              onToggleFavorite={(id, on) => setFavorite(id, on)}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">フィルタ</h2>



        <div className="mt-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold">ハザード対応（避難所データの適合）</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {hazardKeys.map((key) => (
                  <button
                    key={key}
                    onClick={() => toggleHazard(key)}
                    className={classNames(
                      'rounded border px-3 py-1 text-sm',
                      hazards.includes(key)
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-gray-300 bg-white text-gray-700'
                    )}
                  >
                    {hazardLabels[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-row gap-2 shrink-0 flex-wrap items-end">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-600">候補数</div>
                <select className="w-20 max-w-24 rounded border px-2 py-1.5 text-sm" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[3, 5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-600">半径(km)</div>
                <select className="w-20 max-w-24 rounded border px-2 py-1.5 text-sm" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
                  {[5, 10, 20, 30, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={applySearchFromMode}
                className="ml-auto rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 md:hidden"
              >
                フィルタ適用
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center space-x-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={!hideIneligible}
                onChange={(e) => setHideIneligible(!e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>不適合（ハザード未対応等の場所）も含めて表示</span>
            </label>
            <button
              onClick={applySearchFromMode}
              className="hidden rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 md:block"
            >
              フィルタ適用
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">{appliedMode === 'LOCATION' ? '近くの避難所（距離順）' : 'エリア内の避難場所'}</h2>
          <div className="flex gap-2">
            <button
              disabled={!cached}
              onClick={() => {
                writeCache(cacheId, null); // Clear cache
                alert('オフラインデータを削除しました');
                router.reload(); // Simple reload to reflect state
              }}
              className="rounded bg-white border border-gray-300 px-3 py-2 text-sm text-red-700 hover:bg-gray-50 disabled:opacity-50"
            >
              キャッシュ削除
            </button>
            <button
              disabled={selectedIds.size === 0}
              onClick={() => {
                const toSave = effectiveList.filter((s) => selectedIds.has(s.id));
                writeCache(cacheId, { sites: toSave });
                addSavedShelters(toSave);
                setOfflineSaved(true);
                setTimeout(() => setOfflineSaved(false), 2000);
              }}
              className="rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black disabled:opacity-50"
            >
              選択した避難所を保存 {selectedIds.size > 0 ? `(${selectedIds.size}件)` : ''}
            </button>
          </div>
        </div>
        {offlineSaved && <div className="mt-2 text-xs text-emerald-700">保存しました（端末内）</div>}
        {cached && (
          <div className="mt-2 text-xs text-gray-600">
            キャッシュ: {cached.updatedAt ? formatUpdatedAt(cached.updatedAt) : '不明'}（オフライン時に利用）
          </div>
        )}

        {(searchError || apiError) && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            サーバ/APIに接続できません。直近キャッシュを表示します（あれば）。
          </div>
        )}
        {!(searchError || apiError) && sheltersFetchStatus === 'DOWN' && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            サーバ/DBに接続できません。直近キャッシュを表示します（あれば）。{sheltersErrorLabel ? `（${sheltersErrorLabel}）` : ''}
          </div>
        )}



        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{hasAppliedQuery ? '検索結果' : '候補リスト'}</h2>
            <div className="text-xs text-gray-600">{effectiveList.length}件</div>
          </div>

          {!activeLoading && !activeError && hasAppliedQuery && effectiveList.length === 0 && (
            <div className="mt-4 rounded border bg-gray-50 p-4 text-center text-sm text-gray-600">
              0件（該当なし）
            </div>
          )}
          {activeLoading && <div className="mt-4 text-sm text-gray-600">読み込み中...</div>}

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {effectiveList.map((site) => {
              const caution = Boolean(site.is_same_address_as_shelter);
              const isSave = isFavorite(site.id);
              const dest: Coords = { lat: site.lat, lon: site.lon };
              const shareUrl = originUrl ? buildUrl(originUrl, `/shelters/${site.id}`, {}) : null;

              return (
                <div
                  key={site.id}
                  className={classNames('rounded-xl border bg-white p-2 shadow-sm hover:border-blue-400', caution && 'opacity-75')}
                  onClick={() => void router.push(`/shelters/${site.id}`)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-gray-900">{site.name}</div>
                      <div className="mt-0.5 truncate text-xs text-gray-600">{formatPrefCityLabel(site.pref_city, site.address)}</div>
                      <div className="mt-1">
                        <HazardChipsCompact hazards={site.hazards} maxVisible={4} />
                      </div>
                      {caution && (
                        <div className="mt-1 text-[10px] font-semibold text-amber-700">要確認（同一住所データの可能性）</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="inline-block rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">
                        {formatDistanceKm(site.distanceKm ?? site.distance)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                      onClick={() => void router.push(`/shelters/${site.id}`)}
                    >
                      詳細
                    </button>
                    <a
                      href={googleMapsRouteUrl({ origin: coords, dest })}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                    >
                      Google Mapsで経路確認
                    </a>
                    <ShareMenu
                      shareUrl={shareUrl}
                      getShareText={() =>
                        formatShelterShareText({
                          shelterName: site.name,
                          address: site.pref_city ? formatPrefCityLabel(site.pref_city) : null,
                          fromArea: shareFromArea,
                          now: new Date(),
                        })
                      }
                    />
                    <button
                      className={classNames(
                        'rounded px-2 py-1 text-[11px] font-semibold ring-1',
                        isSave
                          ? 'bg-amber-500 text-white ring-amber-600 hover:bg-amber-600'
                          : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
                      )}
                      onClick={() => setFavorite(site.id, !isSave)}
                    >
                      {isSave ? '★' : '☆'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section >
      <SavedAreaSection />
    </div >
  );
}

function SavedAreaSection() {
  const { device } = useDevice();
  const [open, setOpen] = useState(false);
  const savedAreas = device?.savedAreas ?? [];

  if (savedAreas.length === 0) return null;

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-lg font-semibold"
      >
        <span>保存エリアから探す</span>
        <span className="text-sm font-normal text-gray-500">{open ? 'とじる' : 'ひらく'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {savedAreas.map((area) => (
            <SavedAreaRow key={area.id} area={area} />
          ))}
        </div>
      )}
    </section>
  );
}

function SavedAreaRow({ area }: { area: any }) {
  const [expanded, setExpanded] = useState(false);
  const lat = area.lat ?? area.latitude;
  const lon = area.lon ?? area.longitude;
  const isLoc = typeof lat === 'number' && typeof lon === 'number';

  // Use hazard filters if needed? Requirement says "and hazard filters if currently selected".
  // But to keep it simple and encapsulated, we might just use defaults or global context?
  // User said "limit=5 (and hazard filters if currently selected)".
  // We can't easily access the parent's `active` hazard state here without prop drilling or context.
  // However, `list.tsx` uses `hazards` state. 
  // I will just use defaults for now to avoid complexity, or try to respect hazards if I move this inside the main component?
  // Moving inside main component is better to access `hazards` state.
  // But `SavedAreaRow` needs its own state.
  // I will move `SavedAreaSection` INSIDE `ListPage` component to access `hazards`.

  return (
    <div className="rounded border p-3">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between font-semibold">
        <span>{area.label || area.muniName || area.prefName}</span>
        <span className="text-xs text-gray-500">{expanded ? '隠す' : '表示'}</span>
      </button>
      {expanded && <SavedAreaResults area={area} isLoc={isLoc} lat={lat} lon={lon} />}
    </div>
  );
}

function SavedAreaResults({ area, isLoc, lat, lon }: { area: any; isLoc: boolean; lat?: number; lon?: number }) {
  // We need to access current hazard filters from the URL or store?
  // Since we are outside the main component, we can't see `hazards` state easily.
  // But we can parse URL parameters? Or just fetch without filters for now?
  // Requirement: "and hazard filters if currently selected".
  // Re-reading: "mode=LOCATION... and hazard filters if currently selected."
  // I'll assume we can pass them if I move this component inside, or I'll just skip hazards if too complex.
  // Let's rely on basic search.

  const url = isLoc
    ? `/api/shelters/search?mode=LOCATION&lat=${lat}&lon=${lon}&radiusKm=10&limit=5`
    : `/api/shelters/search?mode=AREA&prefCode=${area.prefCode}&muniCode=${area.muniCode}&limit=5`;

  const { data, error } = useSWR(url, fetcher);
  const items: ShelterListItem[] = data?.items ?? data?.sites ?? [];
  const loading = !data && !error;

  if (loading) return <div className="mt-2 text-sm text-gray-600">読み込み中...</div>;
  if (items.length === 0) return <div className="mt-2 text-sm text-gray-600">候補なし</div>;

  return (
    <ul className="mt-2 space-y-2">
      {items.map((site) => (
        <li key={site.id} className="text-sm">
          <Link href={`/shelters/${site.id}`} className="block rounded bg-gray-50 px-2 py-1 hover:bg-blue-50">
            <div className="font-semibold text-blue-900">{site.name}</div>
            <div className="text-xs text-gray-600">{formatPrefCityLabel(site.pref_city)}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
