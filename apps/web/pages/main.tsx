import Head from 'next/head';
import dynamic from 'next/dynamic';
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

type AlertSummaryArea = {
  area: string;
  areaName: string | null;
  updatedAt: string | null;
  urgentCount: number;
  advisoryCount: number;
  topUrgent: string[];
  topAdvisory: string[];
};

function formatAt(iso: string | null | undefined): string {
  if (!iso) return '未更新';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '未更新';
  return new Date(t).toLocaleString();
}

function sanitizeUiError(value: unknown, code = 'DB_DEGRADED'): string {
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

function hazardPreview(hazards: any): string {
  const tags = hazardKeys.filter((k) => Boolean(hazards?.[k]));
  if (tags.length === 0) return '対応ハザード: 不明';
  return `対応: ${tags
    .slice(0, 3)
    .map((k) => hazardLabels[k])
    .join('、')}${tags.length > 3 ? '…' : ''}`;
}

function splitTitle(title: string): { short: string; area: string | null } {
  const t = (title ?? '').trim();
  const m = t.match(/^(.*?)[(（]([^()（）]+)[)）]/);
  if (m) return { short: m[1].trim() || t, area: m[2].trim() || null };
  return { short: t, area: null };
}

export default function MainPage() {
  const router = useRouter();
  const { device, deviceId, updateDevice, coarseArea, setCoarseArea, currentJmaAreaCode, checkin } = useDevice();
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
        setCoords(next);
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

  const nearbyUrl = coords
    ? `/api/shelters/nearby?lat=${coords.lat}&lon=${coords.lon}&limit=6&radiusKm=30&hideIneligible=false&hazardTypes=`
    : null;
  const { data: nearbyData } = useSWR(nearbyUrl, fetcher, { dedupingInterval: 10_000, refreshInterval: 0 });
  const sites: NearbySite[] = nearbyData?.sites ?? [];
  const top6 = useMemo(() => sites.slice(0, 6), [sites]);
  const devDiagnostics = nearbyData?.devDiagnostics ?? null;

  const { data: healthData } = useSWR('/api/health', fetcher, { dedupingInterval: 60_000 });
  const sheltersCount: number | null = typeof healthData?.sheltersCount === 'number' ? healthData.sheltersCount : null;
  const dbConnected: boolean | null = typeof healthData?.dbConnected === 'boolean' ? healthData.dbConnected : null;
  const sheltersUnavailable = dbConnected === false || sheltersCount === 0;

  const isDev = process.env.NODE_ENV === 'development';
  const showDevDataCard = Boolean(isDev && coords);

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
  const favoriteSitesById = useMemo(() => {
    const rows: NearbySite[] = favoritesData?.sites ?? favoritesData?.items ?? [];
    const map = new Map(rows.map((s) => [s.id, s]));
    for (const site of sites) {
      if (favoriteIds.includes(site.id)) map.set(site.id, site);
    }
    return map;
  }, [favoritesData?.items, favoritesData?.sites, favoriteIds, sites]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const isFavorite = (id: string) => favoriteIds.includes(id);
  const setFavorite = (id: string, next: boolean) => {
    const current = device?.favorites?.shelterIds ?? [];
    const already = current.includes(id);
    if (next && !already && current.length >= 5) {
      setToast('保存は最大5件です');
      return;
    }
    const updated = next ? [id, ...current] : current.filter((s) => s !== id);
    void updateDevice({ favorites: { shelterIds: Array.from(new Set(updated)).slice(0, 5) } as any } as any);
    void mutateFavorites();
  };

  const [showSafetyPins, setShowSafetyPins] = useState(false);
  const [showSafetyPinsHistory, setShowSafetyPinsHistory] = useState(false);
  const [showSafetyPinsOld, setShowSafetyPinsOld] = useState(false);
  const [safetyPinsStatus, setSafetyPinsStatus] = useState<string>('');
  useEffect(() => {
    if (!showSafetyPins) {
      setShowSafetyPinsHistory(false);
      setShowSafetyPinsOld(false);
      setSafetyPinsStatus('');
    }
  }, [showSafetyPins]);

  const safetyPinsUrl =
    showSafetyPins && !lowBandwidth
      ? `/api/store/checkins?includeHistory=${showSafetyPinsHistory ? '1' : '0'}&includeOld=${showSafetyPinsOld ? '1' : '0'}&status=${encodeURIComponent(safetyPinsStatus)}`
      : null;
  const { data: safetyPinsData, mutate: mutateSafetyPins } = useSWR(safetyPinsUrl, fetcher, {
    refreshInterval: showSafetyPins ? refreshMs : 0,
    dedupingInterval: 10_000,
  });
  const safetyPins: any[] = safetyPinsData?.pins ?? [];
  const safetyPinsPolicy: { reportCautionThreshold: number; reportHideThreshold: number } | null = safetyPinsData?.moderationPolicy ?? null;

  const { data: nationalUrgent } = useSWR('/api/jma/urgent', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const nationalItems: Array<{ id: string; title: string; updated: string | null }> = nationalUrgent?.items ?? [];

  const savedAreaCodes = useMemo(() => {
    const areas = (device?.savedAreas ?? [])
      .map((a) => a.jmaAreaCode ?? `${a.prefCode}0000`)
      .filter((v): v is string => typeof v === 'string' && /^\d{6}$/.test(v));
    const merged = currentJmaAreaCode ? [...areas, currentJmaAreaCode] : areas;
    return Array.from(new Set(merged)).slice(0, 6);
  }, [currentJmaAreaCode, device?.savedAreas]);

  const summariesUrl = savedAreaCodes.length > 0 ? `/api/jma/warnings-summaries?areas=${encodeURIComponent(savedAreaCodes.join(','))}` : null;
  const { data: mySummary } = useSWR(summariesUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const myAreas: AlertSummaryArea[] = mySummary?.areas ?? [];

  const myActiveCheckin: any =
    (device?.checkins ?? []).find((c: any) => c && typeof c === 'object' && (c as any).active !== false) ?? (device?.checkins ?? [])[0] ?? null;
  const [myCheckinStatus, setMyCheckinStatus] = useState<'SAFE' | 'INJURED' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED'>('SAFE');
  const [myCheckinPrecise, setMyCheckinPrecise] = useState(false);
  const [myCheckinComment, setMyCheckinComment] = useState('');

  return (
    <div className="space-y-6">
      <Head>
        <title>メイン | 全国避難場所ファインダー</title>
      </Head>

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-bold">いま避難先を探す</h1>
            <div className="mt-1 text-sm text-gray-600">地図と近くの避難場所（距離順）を表示します。</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-0">
            <button
              disabled={locating}
              onClick={requestLocation}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              title={locationTooltip}
            >
              現在地を取得
            </button>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          位置情報は端末内でのみ使います。共有文には「都道府県・市区町村」までを表示します。{shareFromArea ? `現在地: ${shareFromArea}` : ''}
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
              recenterSignal={recenterSignal}
              origin={coords}
              fromAreaLabel={shareFromArea}
              onSelect={(site: any) => {
                void router.push(`/shelters/${site.id}`);
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

        <div className="mt-5 border-t pt-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-bold">近くの避難場所（距離順）</h2>
              <div className="mt-1 text-sm text-gray-600">行き先は必ず自治体の情報でも確認してください。</div>
            </div>
            <div className="mt-2 text-xs text-gray-500 md:mt-0">{coords ? `${sites.length}件から` : '現在地を取得すると表示します'}</div>
          </div>

          {!coords && (
            <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
              まず「現在地を取得」を押してください。
            </div>
          )}

          {coords && top6.length === 0 && <div className="mt-3 text-sm text-gray-600">近くの避難場所が見つかりませんでした。</div>}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {top6.map((site) => {
              const hazardCount = hazardKeys.filter((k) => Boolean((site.hazards as any)?.[k])).length;
              const caution = hazardCount === 0 || Boolean(site.is_same_address_as_shelter);
              const dest: Coords = { lat: site.lat, lon: site.lon };
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
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">{site.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-gray-700">{formatPrefCityLabel(site.pref_city)}</div>
                      <div className="mt-0.5 text-[10px] text-gray-500">{hazardPreview(site.hazards)}</div>
                      {caution && (
                        <div className="mt-0.5 text-[10px] font-semibold text-amber-800">
                          {hazardCount === 0 ? '対応ハザード情報が未設定（要確認）' : ''}
                          {hazardCount === 0 && site.is_same_address_as_shelter ? ' / ' : ''}
                          {site.is_same_address_as_shelter ? '同一住所データの可能性（要確認）' : ''}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-900">
                      {formatDistanceKm(site.distanceKm ?? site.distance)}
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
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                          >
                            {hazardLabels[k]}
                          </span>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
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
                        className="rounded bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-black"
                      >
                        Google Mapsで経路
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
                          isFavorite(site.id)
                            ? 'bg-amber-600 text-white ring-amber-700 hover:bg-amber-700'
                            : 'bg-white text-gray-900 ring-gray-300 hover:bg-gray-50'
                        )}
                        onClick={() => setFavorite(site.id, !isFavorite(site.id))}
                      >
                        {isFavorite(site.id) ? '★' : '☆'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showDevDataCard && (
          <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-2 text-xs text-gray-800">
            <div className="font-semibold">データ接続（dev）</div>
            <div className="mt-1">
              nearby: {nearbyData?.fetchStatus ?? 'unknown'} / 件数: {sites.length} / 先頭距離: {firstDistanceKm !== null ? `${firstDistanceKm.toFixed(2)}km` : '不明'} / 更新:{' '}
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
              <label className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200">
                <input
                  type="checkbox"
                  checked={showSafetyPinsHistory}
                  onChange={(e) => setShowSafetyPinsHistory(e.target.checked)}
                  disabled={lowBandwidth}
                />
                <span>履歴も表示</span>
              </label>
            )}
            {showSafetyPins && (
              <label className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200">
                <input
                  type="checkbox"
                  checked={showSafetyPinsOld}
                  onChange={(e) => setShowSafetyPinsOld(e.target.checked)}
                  disabled={lowBandwidth}
                />
                <span>古い情報も表示</span>
              </label>
            )}
            {showSafetyPins && (
              <select
                className="rounded-xl border bg-white px-3 py-2 text-sm"
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
            {coords ? `現在地: ${shareFromArea ?? 'エリア未確定'}` : '現在地: 未取得'}
          </div>
        </div>

        <details className="mt-4 rounded-2xl border bg-white p-4">
          <summary className="cursor-pointer list-none text-sm font-bold text-gray-900">
            自分の安否ピンを更新（手動）
            <span className="ml-2 text-xs font-normal text-gray-600">最終: {myActiveCheckin ? formatAt(myActiveCheckin.updatedAt) : '未更新'}</span>
          </summary>

          <div className="mt-3 space-y-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs font-semibold text-gray-700">1) 位置の確認（保存は粗い位置がデフォルト）</div>
              <div className="mt-1 text-xs text-gray-600">
                保存する位置: {coords ? (shareFromArea ?? 'エリア未確定') : '未取得'}
                {coords ? (myCheckinPrecise ? '（高精度）' : '（概略）') : ''}
              </div>
              <label className="mt-2 flex items-start gap-2 text-sm text-gray-800">
                <input type="checkbox" checked={myCheckinPrecise} onChange={(e) => setMyCheckinPrecise(e.target.checked)} />
                <span>
                  精密な位置を保存する（任意）
                  <span className="ml-2 text-xs text-gray-600">位置が特定されやすくなるため注意</span>
                </span>
              </label>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-700">2) 状態を選ぶ</div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                {[
                  { key: 'SAFE', label: '無事', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
                  { key: 'INJURED', label: '負傷', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
                  { key: 'ISOLATED', label: '孤立', cls: 'border-red-300 bg-red-50 text-red-900' },
                  { key: 'EVACUATING', label: '避難中', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
                  { key: 'COMPLETED', label: '避難完了', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
                ].map((s) => (
                  <button
                    key={s.key}
                    className={classNames(
                      'rounded-xl border px-3 py-2 text-left text-sm font-semibold hover:bg-white',
                      myCheckinStatus === (s.key as any) ? s.cls : 'border-gray-200 bg-white text-gray-900'
                    )}
                    onClick={() => setMyCheckinStatus(s.key as any)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-700">3) コメント（任意）</div>
              <textarea
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                rows={2}
                maxLength={120}
                value={myCheckinComment}
                onChange={(e) => setMyCheckinComment(e.target.value)}
                placeholder="短く（個人情報は書かないでください）"
              />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
                disabled={!coords}
                onClick={async () => {
                  if (!coords) {
                    setToast('まず現在地を取得してください');
                    return;
                  }
                  await checkin({
                    status: myCheckinStatus,
                    coords,
                    precision: myCheckinPrecise ? 'PRECISE' : 'COARSE',
                    comment: myCheckinComment,
                    shelterId: null,
                  });
                  setMyCheckinComment('');
                  setToast('安否ピンを更新しました');
                }}
              >
                ピンを更新
              </button>
              <div className="text-xs text-gray-600">更新: {myActiveCheckin ? formatAt(myActiveCheckin.updatedAt) : '未更新'}</div>
            </div>
          </div>
        </details>
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
                    <button className="min-w-0 text-left" onClick={() => void router.push(`/shelters/${id}`)}>
                      <div className="truncate font-semibold">{site?.name ?? '避難場所'}</div>
                      <div className="truncate text-xs text-gray-600">{formatPrefCityLabel(site?.pref_city)}</div>
                    </button>
                    <button
                      onClick={() => setFavorite(id, false)}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
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

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold">マイエリアの警報・注意報</h2>
            <div className="mt-1 text-sm text-gray-600">参考/可能性/定時などはここでは表示しません。</div>
          </div>
          <button
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
            onClick={() => void router.push('/alerts')}
          >
            警報ページへ
          </button>
        </div>

        {myAreas.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600">保存エリアを追加するか、現在地を取得すると表示されます。</div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {myAreas.map((a) => {
              const hasAny = a.urgentCount + a.advisoryCount > 0;
              return (
                <div key={a.area} className="rounded-2xl border bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold">{a.areaName ?? 'エリア名不明'}</div>
                      <div className="mt-1 text-xs text-gray-600">
                        {a.updatedAt ? `最終取得: ${new Date(a.updatedAt).toLocaleString()}` : 'まだ取得できていません'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <span className={classNames('rounded-full px-3 py-1 text-xs font-bold ring-1', a.urgentCount > 0 ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-white text-gray-800 ring-gray-200')}>
                        警報 {a.urgentCount}
                      </span>
                      <span className={classNames('rounded-full px-3 py-1 text-xs font-bold ring-1', a.advisoryCount > 0 ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-gray-800 ring-gray-200')}>
                        注意報 {a.advisoryCount}
                      </span>
                    </div>
                  </div>

                  {hasAny ? (
                    <div className="mt-3 space-y-2 text-sm text-gray-900">
                      {a.topUrgent.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-red-800">警報</div>
                          <div className="mt-1 text-sm">{a.topUrgent.join(' / ')}</div>
                        </div>
                      )}
                      {a.topAdvisory.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-amber-900">注意報</div>
                          <div className="mt-1 text-sm">{a.topAdvisory.join(' / ')}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-gray-700">いまは警報・注意報は確認できません。</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {toast && <div className="rounded-xl border bg-gray-900 px-4 py-3 text-sm font-semibold text-white">{toast}</div>}
    </div>
  );
}
