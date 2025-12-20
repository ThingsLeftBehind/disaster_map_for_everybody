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
import { buildLineShareUrl, buildUrl, formatShelterListShareText } from '../lib/client/share';
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
  const [reverse, setReverse] = useState<{ prefCode: string | null; muniCode: string | null; address: string | null } | null>(null);
  const [hazards, setHazards] = useState<string[]>([]);
  const [limit, setLimit] = useState(20);
  const [radiusKm, setRadiusKm] = useState(30);
  const [hideIneligible, setHideIneligible] = useState(false);
  const [muniCode, setMuniCode] = useState('');
  const [q, setQ] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [muniText, setMuniText] = useState('');

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

  const nearbyUrl = coords
    ? `/api/shelters/nearby?lat=${coords.lat}&lon=${coords.lon}&limit=${limit}&radiusKm=${radiusKm}&hideIneligible=${hideIneligible ? 'true' : 'false'}&hazardTypes=${hazards.join(',')}`
    : null;

  const areaPrefCode = selectedArea?.prefCode ?? tempPrefCode ?? '';
  const areaUrl = !coords && areaPrefCode ? `/api/shelters/search?prefCode=${areaPrefCode}&muniCode=${muniCode || ''}&q=${encodeURIComponent(q)}&limit=50&offset=0` : null;

  const municipalitiesUrl = areaPrefCode ? `/api/ref/municipalities?prefCode=${areaPrefCode}` : null;
  const { data: municipalitiesData } = useSWR(municipalitiesUrl, fetcher, { dedupingInterval: 60_000 });
  const municipalities: Array<{ muniCode: string; muniName: string }> = municipalitiesData?.municipalities ?? [];
  const selectedMuniName = useMemo(() => municipalities.find((m) => m.muniCode === muniCode)?.muniName ?? null, [muniCode, municipalities]);

  const { data: nearbyData, error: nearbyError } = useSWR(nearbyUrl, fetcher, { refreshInterval: 0, dedupingInterval: 10_000 });
  const { data: areaData, error: areaError } = useSWR(areaUrl, fetcher, { refreshInterval: 0, dedupingInterval: 10_000 });
  const { data: healthData } = useSWR('/api/health', fetcher, { dedupingInterval: 60_000 });
  const sheltersCount: number | null = typeof healthData?.sheltersCount === 'number' ? healthData.sheltersCount : null;
  const dbConnected: boolean | null = typeof healthData?.dbConnected === 'boolean' ? healthData.dbConnected : null;
  const sheltersUnavailable = dbConnected === false || sheltersCount === 0;
  const usedMuniFallback: boolean = Boolean(areaData?.usedMuniFallback);
  const sheltersFetchStatus: string | null = coords ? (nearbyData?.fetchStatus ?? null) : (areaData?.fetchStatus ?? null);
  const sheltersLastError: string | null = coords ? (nearbyData?.lastError ?? null) : (areaData?.lastError ?? null);
  const sheltersErrorLabel = sheltersLastError ? 'DB_DEGRADED' : null;
  const { label: reverseAreaLabel } = useAreaName({ prefCode: reverse?.prefCode ?? null, muniCode: reverse?.muniCode ?? null });
  const selectedAreaLabel = useMemo(
    () => formatPrefMuniLabel(selectedArea ? { prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null } : null),
    [selectedArea]
  );
  const shareFromArea = reverseAreaLabel ?? selectedAreaLabel ?? null;

  const list: ShelterListItem[] = useMemo(() => {
    if (coords) return nearbyData?.sites ?? [];
    return areaData?.sites ?? [];
  }, [areaData?.sites, coords, nearbyData?.sites]);

  const cacheId = cacheKey({ mode: coords ? 'nearby' : 'area', coords: coords ? roundCoords(coords, 2) : null, areaPrefCode, muniCode, q, hazards, limit, radiusKm, hideIneligible });
  const cached = typeof window !== 'undefined' ? readCache<{ sites: ShelterListItem[] }>(cacheId) : null;

  useEffect(() => {
    if (coords && nearbyData?.sites) writeCache(cacheId, { sites: nearbyData.sites });
    if (!coords && areaData?.sites) writeCache(cacheId, { sites: areaData.sites });
  }, [areaData?.sites, cacheId, coords, nearbyData?.sites]);

  const effectiveList = useMemo(() => {
    if (list.length > 0) return list;
    if ((nearbyError || areaError) && cached?.value?.sites) return cached.value.sites;
    if (typeof navigator !== 'undefined' && !navigator.onLine && cached?.value?.sites) return cached.value.sites;
    return list;
  }, [areaError, cached?.value?.sites, list, nearbyError]);

  const effectiveJmaAreaCode = selectedJmaAreaCode ?? (tempPrefCode ? `${tempPrefCode}0000` : null);
  const warningsUrl = effectiveJmaAreaCode ? `/api/jma/warnings?area=${effectiveJmaAreaCode}` : null;
  const { data: warnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const warningsActive =
    Array.isArray(warnings?.items) && warnings.items.some((it: any) => !isJmaLowPriorityWarning(it?.kind));

  const disableLocationMode = () => {
    if (!coords) return;
    setCoords(null);
    setCoordsFromLink(false);
    setReverse(null);
  };

  const toggleHazard = (hazard: string) => {
    disableLocationMode();
    setHazards((prev) => (prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]));
  };

  const handleLocate = async () => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCoords(next);
        setRecenterSignal((v) => v + 1);
        setCoordsFromLink(false);
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

  const origin = typeof window !== 'undefined' ? window.location.origin : null;
  const shareUrl = origin
    ? buildUrl(origin, '/list', {
        limit,
        radiusKm,
        hazards: hazards.join(','),
      })
    : null;

  const shareText = formatShelterListShareText({
    title: warningsActive ? '【災害時】近くの避難場所候補（手動共有）' : '近くの避難場所候補（手動共有）',
    fromArea: shareFromArea,
    now: new Date(),
    shelters: effectiveList.slice(0, Math.min(limit, 20)).map((s) => ({
      name: s.name,
      distanceKm: typeof s.distanceKm === 'number' ? s.distanceKm : typeof s.distance === 'number' ? s.distance : undefined,
      url: origin ? buildUrl(origin, `/shelters/${s.id}`, {}) : undefined,
    })),
  });

  const lineShare = shareUrl ? buildLineShareUrl(shareUrl, shareText) : null;

  return (
    <div className="space-y-6">
      <Head>
        <title>避難場所 | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">避難場所（一覧）</h1>
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
                if (coords) {
                  disableLocationMode();
                  return;
                }
                await handleLocate();
              }}
              title={locationTooltip}
              className="rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700"
            >
              {coords ? '現在地を解除' : '現在地を使う'}
            </button>
          </div>
        </div>

        {(sheltersUnavailable || sheltersFetchStatus === 'DOWN') && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            避難場所データに接続できません。通信・サーバ状況を確認してください。
          </div>
        )}

        {coords && (
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
        ) : effectiveList.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600">表示できる避難場所がありません。</div>
        ) : (
          <div className="mt-3">
            <MapView
              sites={effectiveList.slice(0, 300) as any}
              center={
                coords
                  ? coords
                  : {
                      lat: effectiveList[0]?.lat ?? 35.681236,
                      lon: effectiveList[0]?.lon ?? 139.767125,
                    }
              }
              recenterSignal={recenterSignal}
              origin={coords}
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
                    disableLocationMode();
                    setSelectedAreaId(e.target.value || null);
                  }}
                >
                  {(device?.savedAreas ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
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
                    disableLocationMode();
                    setTempPrefCode(e.target.value);
                    setMuniCode('');
                    setMuniText('');
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
            {areaPrefCode && municipalities.length > 0 && (
              <>
                <input
                  className="w-full rounded border px-3 py-2"
                  list="muni-list"
                  placeholder="市区町村を入力（候補から選択）"
                  value={muniText}
                  onChange={(e) => {
                    disableLocationMode();
                    const next = e.target.value;
                    setMuniText(next);
                    const hit = municipalities.find((m) => m.muniName === next) ?? null;
                    setMuniCode(hit?.muniCode ?? '');
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
                      disableLocationMode();
                      setMuniText('');
                      setMuniCode('');
                    }}
                  >
                    市区町村をクリア
                  </button>
                )}
              </>
            )}
            {muniCode && <div className="rounded border bg-gray-50 px-3 py-2 text-xs text-gray-700">市区町村: {selectedMuniName ?? '選択中'}</div>}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">検索</div>
            <input
              className="w-full rounded border px-3 py-2"
              placeholder="施設名"
              value={q}
              onChange={(e) => {
                disableLocationMode();
                setQ(e.target.value);
              }}
            />
            <div className="flex items-center justify-between rounded border bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-700">不適合を隠す</div>
              <button
                onClick={() => {
                  disableLocationMode();
                  setHideIneligible((v) => !v);
                }}
                className="rounded bg-white px-2 py-1 text-xs hover:bg-gray-100"
              >
                {hideIneligible ? 'ON' : 'OFF'}
              </button>
            </div>
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
        </div>

        {coords && (
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
            <div className="space-y-2">
              <div className="text-sm font-semibold">共有</div>
              <div className="rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
                共有文は「都道府県・市区町村」までを表示します（緯度経度は表示しません）。
              </div>
            </div>
          </div>
        )}
      </section>

      {coords && (
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="text-lg font-semibold">手動共有（LINE/SNS/DM）</h2>
          {!shareUrl && <div className="mt-3 text-sm text-gray-600">共有リンクの作成に失敗しました。</div>}
          {shareUrl && (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-gray-600">共有リンク（深いリンク）</div>
              <input className="w-full rounded border px-3 py-2 text-xs" value={shareUrl} readOnly />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
                      alert('コピーしました');
                    } catch {
                      alert('コピーに失敗しました');
                    }
                  }}
                  className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                >
                  テキスト+URLをコピー
                </button>
                {lineShare && (
                  <a href={lineShare} target="_blank" rel="noreferrer" className="rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
                    LINEで共有
                  </a>
                )}
              </div>
              <textarea className="w-full rounded border p-2 text-xs" rows={5} value={`${shareText}\n${shareUrl}`} readOnly />
              <div className="text-xs text-gray-600">
                プライバシー: 共有文は「都道府県・市区町村」までです（緯度経度は含めません）。
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">{coords ? '近くの候補（距離順）' : 'エリア内の避難場所（距離順）'}</h2>
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

        {(nearbyError || areaError) && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            サーバ/APIに接続できません。直近キャッシュを表示します（あれば）。
          </div>
        )}
        {!(nearbyError || areaError) && sheltersFetchStatus === 'DOWN' && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            サーバ/DBに接続できません。直近キャッシュを表示します（あれば）。{sheltersErrorLabel ? `（${sheltersErrorLabel}）` : ''}
          </div>
        )}

        {!coords && !areaPrefCode && <div className="mt-3 text-sm text-gray-600">保存エリアを追加してください（/main）。</div>}

        <div className="mt-4 space-y-2">
          {effectiveList.map((site) => {
            const flags = (site.hazards ?? {}) as Record<string, boolean>;
            const missing = hazards.filter((h) => !flags?.[h]);
            const matches = hazards.length === 0 ? true : missing.length === 0;
            const eligible = coords ? (site.matchesHazards ?? matches) : matches;

            return (
              <Link
                key={site.id}
                href={{
                  pathname: `/shelters/${site.id}`,
                  query: coords ? { lat: coords.lat, lon: coords.lon } : {},
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
                </div>

                <div className="mt-2 text-xs text-gray-700">{whyRecommended(site, hazards)}</div>

                {!eligible && hazards.length > 0 && (
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
