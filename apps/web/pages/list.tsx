import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { useDevice } from '../components/device/DeviceProvider';
import MapView from '../components/MapView';
import { loadLastLocation, reverseGeocodeGsi, roundCoords, saveLastLocation, type Coords } from '../lib/client/location';
import { isJmaLowPriorityWarning } from '../lib/jma/filters';
import { formatPrefMuniLabel, useAreaName } from '../lib/client/areaName';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
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

export default function ListPage() {
  const router = useRouter();
  const { device, selectedArea, selectedJmaAreaCode, setSelectedAreaId, setCoarseArea } = useDevice();
  const lowBandwidth = Boolean(device?.settings?.lowBandwidth || device?.settings?.powerSaving);
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const locationTooltip = '位置情報は端末内で利用。表示・共有は都道府県・市区町村まで。';
  const { data: prefecturesData } = useSWR('/api/ref/municipalities', fetcher, { dedupingInterval: 60_000 });
  const prefectures: Array<{ prefCode: string; prefName: string }> = prefecturesData?.prefectures ?? [];
  const [tempPrefCode, setTempPrefCode] = useState<string>('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [coordsFromLink, setCoordsFromLink] = useState(false);
  const [mode, setMode] = useState<SearchMode>('AREA');
  const [modeLocked, setModeLocked] = useState(false);
  const [reverse, setReverse] = useState<{ prefCode: string | null; muniCode: string | null; address: string | null } | null>(null);
  const [hazards, setHazards] = useState<string[]>([]);
  const [limit, setLimit] = useState(20);
  const [radiusKm, setRadiusKm] = useState(30);
  const [muniCode, setMuniCode] = useState('');
  const [q, setQ] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [recenterSignal] = useState(0);
  const [muniText, setMuniText] = useState('');
  const [appliedQuery, setAppliedQuery] = useState<AppliedQuery | null>(null);

  useEffect(() => {
    if (!router.isReady) return;

    const qLat = firstQueryValue(router.query.lat as any);
    const qLon = firstQueryValue(router.query.lon as any);
    const qLimit = firstQueryValue(router.query.limit as any);
    const qRadius = firstQueryValue(router.query.radiusKm as any);
    const qHazards = firstQueryValue(router.query.hazards as any);

    const allowedLimits = [3, 5, 10, 20];
    const allowedRadius = [5, 10, 20, 30, 50];
    const parsedLimit = qLimit ? Number(qLimit) : NaN;
    if (Number.isFinite(parsedLimit) && allowedLimits.includes(parsedLimit)) setLimit(parsedLimit);

    const parsedRadius = qRadius ? Number(qRadius) : NaN;
    if (Number.isFinite(parsedRadius) && allowedRadius.includes(parsedRadius)) setRadiusKm(parsedRadius);

    if (qHazards) {
      const next = qHazards
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((k) => hazardKeys.includes(k as any));
      if (next.length > 0) setHazards(next);
    }

    const lat = qLat ? Number(qLat) : NaN;
    const lon = qLon ? Number(qLon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      setCoords({ lat, lon });
      setCoordsFromLink(true);
      return;
    }

    const last = loadLastLocation();
    if (last) setCoords(last);
  }, [router.isReady, router.query.hazards, router.query.lat, router.query.limit, router.query.lon, router.query.radiusKm]);

  useEffect(() => {
    if (modeLocked) return;
    if (coords) setMode('LOCATION');
    else setMode('AREA');
  }, [coords, modeLocked]);

  const pendingTrimmedQ = q.trim();
  const areaPrefCode = selectedArea?.prefCode ?? tempPrefCode ?? '';
  const effectiveMuniCode = selectedArea?.muniCode ?? muniCode;
  useEffect(() => {
    if (!areaPrefCode) {
      setMuniCode('');
      setMuniText('');
    }
  }, [areaPrefCode]);

  useEffect(() => {
    if (!selectedArea) return;
    setTempPrefCode('');
    setMuniCode(selectedArea.muniCode ?? '');
    setMuniText(selectedArea.muniName ?? '');
  }, [selectedArea]);

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
      if (appliedQuery.muniCode) params.set('muniCode', appliedQuery.muniCode);
    } else {
      if (!appliedQuery.prefCode) return null;
      params.set('prefCode', appliedQuery.prefCode);
      if (appliedQuery.muniCode) params.set('muniCode', appliedQuery.muniCode);
      params.set('limit', String(appliedQuery.limit));
      params.set('offset', String(appliedQuery.offset));
    }
    if (appliedQuery.q) params.set('q', appliedQuery.q);
    if (appliedQuery.hazards.length > 0) params.set('hazardTypes', appliedQuery.hazards.join(','));
    return `/api/shelters/search?${params.toString()}`;
  }, [appliedQuery]);

  const municipalitiesUrl = areaPrefCode ? `/api/ref/municipalities?prefCode=${areaPrefCode}` : null;
  const { data: municipalitiesData } = useSWR(municipalitiesUrl, fetcher, { dedupingInterval: 60_000 });
  const municipalities: Array<{ muniCode: string; muniName: string }> = municipalitiesData?.municipalities ?? [];

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
  const sheltersErrorLabel = sheltersLastError ? 'DB_DEGRADED' : null;
  const { label: reverseAreaLabel } = useAreaName({ prefCode: reverse?.prefCode ?? null, muniCode: reverse?.muniCode ?? null });
  const selectedAreaLabel = useMemo(
    () => formatPrefMuniLabel(selectedArea ? { prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null } : null),
    [selectedArea]
  );
  const shareFromArea = reverseAreaLabel ?? selectedAreaLabel ?? null;

  const list: ShelterListItem[] = useMemo(() => searchData?.sites ?? searchData?.items ?? [], [searchData?.items, searchData?.sites]);

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

  const appliedMode: SearchMode = appliedQuery?.mode ?? mode;
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

  const effectiveJmaAreaCode = selectedJmaAreaCode ?? (tempPrefCode ? `${tempPrefCode}0000` : null);
  const warningsUrl = effectiveJmaAreaCode ? `/api/jma/warnings?area=${effectiveJmaAreaCode}` : null;
  const { data: warnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const warningsActive =
    Array.isArray(warnings?.items) && warnings.items.some((it: any) => !isJmaLowPriorityWarning(it?.kind));

  const disableLocationMode = () => {
    setCoords(null);
    setCoordsFromLink(false);
    setReverse(null);
    setMode('AREA');
    setModeLocked(true);
  };

  const applySearch = () => {
    if (mode === 'LOCATION') {
      if (!coords) {
        alert('現在地を取得してください');
        return;
      }
      setAppliedQuery({
        mode: 'LOCATION',
        prefCode: areaPrefCode,
        muniCode: effectiveMuniCode ?? '',
        q: pendingTrimmedQ,
        hazards: [...hazards],
        limit,
        radiusKm,
        lat: coords.lat,
        lon: coords.lon,
        offset: 0,
      });
      return;
    }
    if (!areaPrefCode) {
      alert('都道府県を選択してください');
      return;
    }
    setAppliedQuery({
      mode: 'AREA',
      prefCode: areaPrefCode,
      muniCode: effectiveMuniCode ?? '',
      q: pendingTrimmedQ,
      hazards: [...hazards],
      limit,
      radiusKm,
      lat: null,
      lon: null,
      offset: 0,
    });
  };

  const toggleHazard = (hazard: string) => {
    setHazards((prev) => (prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]));
  };

  const handleLocate = async () => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCoords(next);
        setCoordsFromLink(false);
        setMode('LOCATION');
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
      },
      () => {
        alert('位置情報の取得に失敗しました');
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60_000,
      }
    );
  };

  return (
    <div className="space-y-6">
      <Head>
        <title>避難場所 | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">避難場所（一覧）</h1>
          <Link href="/designated" className="mt-1 inline-block text-xs font-semibold text-blue-700 hover:underline">
            指定避難所（参考）はこちら
          </Link>
        </div>
      </div>

      <section className={classNames('rounded-lg border p-4', warningsActive ? 'bg-red-50 border-red-200' : 'bg-white')}>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className={classNames('font-semibold', warningsActive ? 'text-red-900' : 'text-gray-900')}>
              {warningsActive ? '災害モード（警報・注意報あり）' : '通常モード'}
            </div>
            <div className="text-xs text-gray-600">
              対象エリア:{' '}
              {selectedAreaLabel ?? '未選択'} / 警報情報:{' '}
              {warnings?.updatedAt ? `最終更新 ${formatUpdatedAt(warnings.updatedAt)}` : '未取得'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                if (mode === 'LOCATION') {
                  disableLocationMode();
                  return;
                }
                await handleLocate();
              }}
              title={locationTooltip}
              className="rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700"
            >
              {mode === 'LOCATION' ? '現在地を解除' : '現在地を使う'}
            </button>
          </div>
        </div>

        {(sheltersUnavailable || sheltersFetchStatus === 'DOWN') && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            避難場所データに接続できません。通信・サーバ状況を確認してください。
          </div>
        )}

        {mode === 'LOCATION' && coords && (
          <div className="mt-3 rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">
            現在地: {reverseAreaLabel ?? 'エリア未確定'}
            {coordsFromLink && <div className="mt-1 text-[11px] text-gray-600">共有リンクの位置（概算）を表示中</div>}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">地図</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/hazard" className="rounded bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50">
              ハザード地図へ
            </Link>
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
            {mode === 'LOCATION' ? '現在地を取得して検索してください。' : '都道府県を選択して検索してください。'}
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
            />
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">フィルタ</h2>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-sm font-semibold">都道府県</div>
            {(device?.savedAreas ?? []).length > 0 ? (
              <>
                <select
                  className="w-full rounded border px-3 py-2"
                  value={selectedArea?.id ?? ''}
                  onChange={(e) => {
                    setSelectedAreaId(e.target.value || null);
                    setMode('AREA');
                    setModeLocked(true);
                    setCoords(null);
                    setCoordsFromLink(false);
                    setReverse(null);
                  }}
                >
                  {(device?.savedAreas ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label ? `${a.label} / ` : ''}
                      {a.prefName}
                      {a.muniName ? ` ${a.muniName}` : ''}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500">
                  <Link href="/main" className="text-blue-600 hover:underline">
                    保存したマイエリア（最大5ヶ所）
                  </Link>{' '}
                  を編集できます
                </div>
              </>
            ) : (
              <>
                <select
                  className="w-full rounded border px-3 py-2"
                  value={tempPrefCode}
                  onChange={(e) => {
                    setTempPrefCode(e.target.value);
                    setMuniCode('');
                    setMuniText('');
                    setMode('AREA');
                    setModeLocked(true);
                    setCoords(null);
                    setCoordsFromLink(false);
                    setReverse(null);
                  }}
                >
                  <option value="">選択してください</option>
                  {prefectures.map((p) => (
                    <option key={p.prefCode} value={p.prefCode}>
                      {p.prefName}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500">
                  <Link href="/main" className="text-blue-600 hover:underline">
                    メイン
                  </Link>{' '}
                  からマイエリアを追加できます（最大5ヶ所）。
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">市区町村</div>
            <>
              <input
                className={classNames('w-full rounded border px-3 py-2', !areaPrefCode && 'bg-gray-100 text-gray-500')}
                list="muni-list"
                placeholder={areaPrefCode ? '市区町村を入力（候補から選択）' : '都道府県を先に選択'}
                value={muniText}
                disabled={!areaPrefCode}
                onChange={(e) => {
                  const next = e.target.value;
                  setMuniText(next);
                  const hit = municipalities.find((m) => m.muniName === next) ?? null;
                  setMuniCode(hit?.muniCode ?? '');
                  if (mode !== 'AREA') {
                    setMode('AREA');
                    setModeLocked(true);
                    setCoords(null);
                    setCoordsFromLink(false);
                    setReverse(null);
                  }
                }}
              />
              <datalist id="muni-list">
                {municipalities.map((m) => (
                  <option key={m.muniCode} value={m.muniName} />
                ))}
              </datalist>
              {(muniText || muniCode) && (
                <button
                  className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-800 hover:bg-gray-200"
                  onClick={() => {
                    setMuniText('');
                    setMuniCode('');
                  }}
                >
                  市区町村をクリア
                </button>
              )}
            </>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">検索</div>
            <input
              className="w-full rounded border px-3 py-2"
              placeholder="施設名"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="mt-4">
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
          <div className="mt-2 text-xs text-gray-600">
            ※ここは「避難所が対応する災害種別」の絞り込みです。地図ハザードレイヤーは /hazard で別途表示（デフォルトOFF）。
          </div>
          <div className="mt-3">
            <button onClick={applySearch} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              検索
            </button>
          </div>
        </div>

        {mode === 'LOCATION' && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <div className="text-sm font-semibold">候補数（災害モード）</div>
              <select className="w-full rounded border px-3 py-2" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {[3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold">探索半径（km）</div>
              <select className="w-full rounded border px-3 py-2" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
                {[5, 10, 20, 30, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">{appliedMode === 'LOCATION' ? '近くの候補（距離順）' : 'エリア内の避難場所'}</h2>
          <button
            onClick={() => {
              writeCache(cacheId, { sites: effectiveList });
              setOfflineSaved(true);
              setTimeout(() => setOfflineSaved(false), 2000);
            }}
            className="rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black"
          >
            この一覧をオフライン保存
          </button>
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

        {mode === 'AREA' && !areaPrefCode && <div className="mt-3 text-sm text-gray-600">保存エリアを追加してください（/main）。</div>}

        <div className="mt-4 space-y-2">
          {activeLoading && <div className="text-sm text-gray-600">読み込み中...</div>}
          {!activeLoading && !activeError && hasAppliedQuery && effectiveList.length === 0 && (
            <div className="text-sm text-gray-600">0件（該当なし）</div>
          )}
          {effectiveList.map((site) => {
            const flags = (site.hazards ?? {}) as Record<string, boolean>;
            const missing = appliedHazards.filter((h) => !flags?.[h]);
            const matches = appliedHazards.length === 0 ? true : missing.length === 0;
            const eligible = appliedMode === 'LOCATION' ? (site.matchesHazards ?? matches) : matches;

            return (
              <Link
                key={site.id}
                href={{
                  pathname: `/shelters/${site.id}`,
                  query: appliedCoords ? { lat: appliedCoords.lat, lon: appliedCoords.lon } : {},
                }}
                className={classNames(
                  'block rounded border px-4 py-3 hover:border-blue-400 hover:bg-blue-50',
                  !eligible && 'opacity-60'
                )}
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-semibold">{site.name}</div>
                    <div className="text-xs text-gray-600">{formatPrefCityLabel(site.pref_city)}</div>
                    <div className="text-xs text-gray-500">更新: {formatUpdatedAt(site.source_updated_at ?? site.updated_at)}</div>
                  </div>
                  {typeof (site.distanceKm ?? site.distance) === 'number' && (
                    <div className="text-sm font-semibold text-gray-800">{(site.distanceKm ?? site.distance)!.toFixed(1)} km</div>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {hazardKeys
                    .filter((k) => Boolean((site.hazards as any)?.[k]))
                    .map((k) => (
                      <span key={k} className="rounded bg-emerald-100 px-2 py-1 text-[10px] text-emerald-800">
                        {hazardLabels[k]}
                      </span>
                    ))}
                  {hazardKeys.filter((k) => Boolean((site.hazards as any)?.[k])).length === 0 && (
                    <span className="text-[10px] text-gray-600">対応ハザード: 不明</span>
                  )}
                </div>

                <div className="mt-2 text-xs text-gray-700">{whyRecommended(site, appliedHazards)}</div>

                {!eligible && appliedHazards.length > 0 && (
                  <div className="mt-1 text-xs text-red-700">
                    不適合: {missing.map((k) => hazardLabels[k as keyof typeof hazardLabels] ?? k).join('、')}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">通常時の選び方（参考）</div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>高齢者・要配慮者: バリアフリー/受入体制は自治体情報を確認（本データで不明な場合あり）。</li>
          <li>災害種別: 洪水/土砂/津波など想定災害に対応しているか確認。</li>
          <li>混雑: 本アプリの投票は参考情報です。現地判断と公式情報を優先してください。</li>
        </ul>
      </section>

    </div>
  );
}
