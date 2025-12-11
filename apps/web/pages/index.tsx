import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import MapView from '../components/MapView';
import Disclaimer from '../components/Disclaimer';
import {
  hazardKeys,
  hazardLabels,
  congestionLevels,
  accessibilityLevels,
  safetyStatuses,
  type HazardKey
} from '@jp-evac/shared';
import classNames from 'classnames';
import { nanoid } from 'nanoid';

const fetcher = async (url: string, deviceHash?: string) => {
  const res = await fetch(url, {
    headers: deviceHash ? { 'x-device-hash': deviceHash } : undefined
  });
  if (!res.ok) throw new Error('request_failed');
  return res.json();
};

export default function Home() {
  const [coords, setCoords] = useState({ lat: 35.681236, lng: 139.767125 });
  const [radiusKm, setRadiusKm] = useState(5);
  const [limit, setLimit] = useState(15);
  const [selectedHazards, setSelectedHazards] = useState<HazardKey[]>([]);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [deviceHash, setDeviceHash] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [reportCongestion, setReportCongestion] = useState<typeof congestionLevels[number]>('normal');
  const [reportAccess, setReportAccess] = useState<typeof accessibilityLevels[number]>('accessible');
  const [reportComment, setReportComment] = useState('');
  const [safetyStatus, setSafetyStatus] = useState<typeof safetyStatuses[number]>('safe');
  const [safetySite, setSafetySite] = useState<string | null>(null);
  const [watchLabel, setWatchLabel] = useState('自宅');
  const [watchRadius, setWatchRadius] = useState(2);
  const [watchActive, setWatchActive] = useState(true);
  const [watchHazards, setWatchHazards] = useState<HazardKey[]>(hazardKeys);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('device_hash') : null;
    if (stored) {
      setDeviceHash(stored);
      document.cookie = `device_hash=${stored}; path=/; max-age=${60 * 60 * 24 * 365}`;
    } else {
      const hash = nanoid(24);
      setDeviceHash(hash);
      localStorage.setItem('device_hash', hash);
      document.cookie = `device_hash=${hash}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }
  }, []);

  const nearbyKey = `/api/shelters/nearby?lat=${coords.lat}&lng=${coords.lng}&radiusKm=${radiusKm}&limit=${limit}&hazardTypes=${selectedHazards.join(',')}`;
  const { data: nearby, mutate: refreshNearby } = useSWR(nearbyKey, (url) => fetcher(url, deviceHash));
  const { data: detail } = useSWR(selectedSite ? `/api/shelters/${selectedSite}` : null, (url) => fetcher(url, deviceHash));
  const { data: summary } = useSWR(selectedSite ? `/api/shelters/${selectedSite}/status-summary` : null, (url) => fetcher(url, deviceHash), {
    refreshInterval: 30000
  });
  const { data: safety, mutate: refreshSafety } = useSWR(deviceHash ? '/api/safety' : null, (url) => fetcher(url, deviceHash));
  const { data: watchRegions, mutate: refreshRegions } = useSWR(deviceHash ? '/api/watch-regions' : null, (url) => fetcher(url, deviceHash));

  useEffect(() => {
    if (nearby?.sites?.length && !selectedSite) {
      setSelectedSite(nearby.sites[0].id);
    }
  }, [nearby, selectedSite]);

  const markers = useMemo(
    () =>
      (nearby?.sites ?? []).map((site: any) => ({
        id: site.id,
        name: site.name,
        lat: site.lat,
        lng: site.lng,
        distance: site.distance_km,
        hazards: site.hazard_types as HazardKey[]
      })),
    [nearby]
  );

  const handleLocate = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        refreshNearby();
      },
      () => {}
    );
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    const result = await fetcher(`/api/geocode?q=${encodeURIComponent(searchTerm)}`);
    if (result.results?.length) {
      setCoords({ lat: result.results[0].lat, lng: result.results[0].lng });
      refreshNearby();
    }
  };

  const toggleHazard = (hazard: HazardKey) => {
    setSelectedHazards((prev) => (prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]));
  };

  const submitReport = async () => {
    if (!selectedSite) return;
    await fetch(`/api/shelters/${selectedSite}/status-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(deviceHash ? { 'x-device-hash': deviceHash } : {}) },
      body: JSON.stringify({
        congestion_level: reportCongestion,
        accessibility: reportAccess,
        comment: reportComment
      })
    });
    setReportComment('');
    refreshNearby();
  };

  const submitSafety = async () => {
    await fetch('/api/safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(deviceHash ? { 'x-device-hash': deviceHash } : {}) },
      body: JSON.stringify({ status: safetyStatus, current_site_id: safetySite })
    });
    refreshSafety();
  };

  const submitWatchRegion = async () => {
    await fetch('/api/watch-regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(deviceHash ? { 'x-device-hash': deviceHash } : {}) },
      body: JSON.stringify({
        label: watchLabel,
        latitude: coords.lat,
        longitude: coords.lng,
        radius_km: watchRadius,
        active: watchActive,
        hazard_types: watchHazards
      })
    });
    refreshRegions();
  };

  const statusSummary = summary?.summary ?? detail?.status_summary;
  const transferCode = safety?.transfer_code;

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900">
      <Head>
        <title>JP Nationwide Evacuation Finder</title>
      </Head>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700">Evacuation Finder v2</div>
            <h1 className="text-2xl font-bold">全国避難場所ファインダー</h1>
            <p className="text-sm text-gray-600">現在地や住所から最寄りの避難場所をすぐに確認し、混雑状況や安全情報を共有できます。</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleLocate}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              現在地を使う
            </button>
            <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="住所や地名で検索"
                className="w-48 border-b border-gray-200 px-2 py-1 text-sm focus:outline-none"
              />
              <button onClick={handleSearch} className="rounded bg-slate-900 px-3 py-1 text-sm font-semibold text-white">
                検索
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow md:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span>半径</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="w-16 rounded border px-2 py-1 text-sm"
                />
                <span>km</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span>件数</span>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-16 rounded border px-2 py-1 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {hazardKeys.map((hazard) => (
                  <label key={hazard} className="flex cursor-pointer items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={selectedHazards.includes(hazard)}
                      onChange={() => toggleHazard(hazard)}
                    />
                    <span>{hazardLabels[hazard]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <MapView markers={markers} center={coords} radiusKm={radiusKm} onSelect={(id) => setSelectedSite(id)} />
            </div>
            <div className="mt-2 text-xs text-gray-600">位置情報は端末内にとどまり、リクエスト時のみ送信されます。</div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">近くの避難場所</h2>
                <span className="text-sm text-gray-500">{nearby?.sites?.length ?? 0} 件</span>
              </div>
              <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {(nearby?.sites ?? []).map((site: any) => (
                  <button
                    key={site.id}
                    onClick={() => setSelectedSite(site.id)}
                    className={classNames(
                      'w-full rounded-lg border px-3 py-2 text-left transition',
                      selectedSite === site.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-400'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">{site.name}</div>
                      {site.distance_km !== undefined && (
                        <span className="text-xs text-gray-600">{site.distance_km.toFixed(2)} km</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600">{site.address}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {site.hazard_types.map((h: HazardKey) => (
                        <span key={h} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                          {hazardLabels[h]}
                        </span>
                      ))}
                    </div>
                    {site.status_summary?.congestion && (
                      <div className="mt-1 text-xs text-blue-700">混雑: {site.status_summary.congestion}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow">
              <h3 className="text-lg font-semibold">安全ステータス</h3>
              <div className="mt-2 space-y-2">
                <select
                  value={safetyStatus}
                  onChange={(e) => setSafetyStatus(e.target.value as typeof safetyStatuses[number])}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  {safetyStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  value={safetySite ?? ''}
                  onChange={(e) => setSafetySite(e.target.value || null)}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="">リンクする避難場所なし</option>
                  {(nearby?.sites ?? []).map((site: any) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={submitSafety}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  更新する
                </button>
                {transferCode && (
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    引き継ぎコード: <span className="font-mono text-sm">{transferCode}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">施設詳細</h2>
              {statusSummary?.updatedAt && (
                <span className="text-xs text-gray-500">更新: {new Date(statusSummary.updatedAt).toLocaleTimeString()}</span>
              )}
            </div>
            {detail ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xl font-bold">{detail.name}</div>
                  <div className="text-sm text-gray-600">{detail.address}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.hazard_capabilities
                    .filter((h: any) => h.is_supported)
                    .map((h: any) => (
                      <span key={h.hazard_type} className="rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-800">
                        {hazardLabels[h.hazard_type as HazardKey]}
                      </span>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <div className="text-xs text-gray-500">混雑度</div>
                    <div className="text-lg font-semibold text-blue-700">{statusSummary?.congestion ?? '不明'}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <div className="text-xs text-gray-500">通行可否</div>
                    <div className="text-lg font-semibold text-emerald-700">{statusSummary?.accessibility ?? '不明'}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">{statusSummary?.counts ?? 0} 件の最近の報告</div>
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <div className="text-sm font-semibold">混雑・通行状況を共有</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <select
                      value={reportCongestion}
                      onChange={(e) => setReportCongestion(e.target.value as typeof congestionLevels[number])}
                      className="rounded border px-3 py-2 text-sm"
                    >
                      {congestionLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                    <select
                      value={reportAccess}
                      onChange={(e) => setReportAccess(e.target.value as typeof accessibilityLevels[number])}
                      className="rounded border px-3 py-2 text-sm"
                    >
                      {accessibilityLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={reportComment}
                    onChange={(e) => setReportComment(e.target.value)}
                    placeholder="短いメモ (任意)"
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                  <button
                    onClick={submitReport}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    報告を送信
                  </button>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                  データ提供元: {detail.source_name}. 最新情報は必ず自治体の公式発表を確認してください。
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">施設を選択してください。</div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow">
              <h3 className="text-lg font-semibold">見守りエリア</h3>
              <div className="mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={watchLabel}
                    onChange={(e) => setWatchLabel(e.target.value)}
                    className="rounded border px-3 py-2 text-sm"
                    placeholder="名称"
                  />
                  <input
                    type="number"
                    min={0.5}
                    max={50}
                    value={watchRadius}
                    onChange={(e) => setWatchRadius(Number(e.target.value))}
                    className="rounded border px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {hazardKeys.map((hazard) => (
                    <label key={hazard} className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={watchHazards.includes(hazard)}
                        onChange={() =>
                          setWatchHazards((prev) =>
                            prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]
                          )
                        }
                      />
                      <span>{hazardLabels[hazard]}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={watchActive}
                    onChange={() => setWatchActive((v) => !v)}
                  />
                  <span>通知対象として保存</span>
                </div>
                <button
                  onClick={submitWatchRegion}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  この位置で保存
                </button>
                <div className="space-y-2 text-sm">
                  {(watchRegions?.regions ?? []).map((region: any) => (
                    <div key={region.id} className="rounded border border-gray-200 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{region.label}</div>
                        <span className={classNames('text-xs', region.active ? 'text-emerald-700' : 'text-gray-500')}>
                          {region.active ? '監視中' : '停止中'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600">半径 {region.radius_km} km</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(region.hazard_types ?? []).map((h: HazardKey) => (
                          <span key={h} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                            {hazardLabels[h]}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Disclaimer />
          </div>
        </div>
      </main>
    </div>
  );
}
