import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import MapView, { SiteWithDistance } from '../components/MapView';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import useSWR from 'swr';
import axios from 'axios';
import classNames from 'classnames';
import { nanoid } from 'nanoid';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function useDeviceIdentity() {
  const [deviceHash, setDeviceHash] = useState<string | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);

  useEffect(() => {
    const storedHash = localStorage.getItem('device_hash');
    const storedTransfer = localStorage.getItem('transfer_code');
    if (storedHash && storedTransfer) {
      setDeviceHash(storedHash);
      setTransferCode(storedTransfer);
      return;
    }
    const hash = nanoid(12);
    const transfer = nanoid(6);
    localStorage.setItem('device_hash', hash);
    localStorage.setItem('transfer_code', transfer);
    setDeviceHash(hash);
    setTransferCode(transfer);
  }, []);

  return { deviceHash, transferCode };
}

export default function Home() {
  const [coords, setCoords] = useState({ lat: 35.681236, lon: 139.767125 });
  const [hazards, setHazards] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [selectedSite, setSelectedSite] = useState<SiteWithDistance | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [crowdStatus, setCrowdStatus] = useState('OK');
  const [crowdComment, setCrowdComment] = useState('');
  const { deviceHash, transferCode } = useDeviceIdentity();

  const { data, mutate } = useSWR(
    `/api/shelters/nearby?lat=${coords.lat}&lon=${coords.lon}&limit=${limit}&hazardTypes=${hazards.join(',')}`,
    fetcher
  );

  const sites: SiteWithDistance[] = data?.sites ?? [];

  const { data: crowdSummary } = useSWR(
    () => (selectedSite ? `/api/crowd-summary?siteId=${selectedSite.id}` : null),
    fetcher,
    { refreshInterval: 30000 }
  );

  useEffect(() => {
    if (sites.length && !selectedSite) setSelectedSite(sites[0]);
  }, [sites, selectedSite]);

  const handleLocate = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        console.error(err);
        alert('位置情報の取得に失敗しました');
      }
    );
  };

  const handleSearch = async () => {
    if (!searchTerm) return;
    setSearching(true);
    try {
      const url = `${process.env.NEXT_PUBLIC_NOMINATIM_URL}?format=json&q=${encodeURIComponent(searchTerm)}&countrycodes=jp&limit=1`;
      const response = await fetch(url);
      const results = await response.json();
      if (results.length > 0) {
        setCoords({ lat: Number(results[0].lat), lon: Number(results[0].lon) });
      } else {
        alert('場所が見つかりませんでした');
      }
    } catch (error) {
      console.error(error);
      alert('検索中にエラーが発生しました');
    } finally {
      setSearching(false);
    }
  };

  const toggleHazard = (hazard: string) => {
    setHazards((prev) =>
      prev.includes(hazard) ? prev.filter((h) => h !== hazard) : [...prev, hazard]
    );
  };

  const handleReport = async () => {
    if (!deviceHash || !selectedSite) return;
    await axios.post('/api/crowd-report', {
      siteId: selectedSite.id,
      status: crowdStatus,
      comment: crowdComment,
      device_hash: deviceHash,
    });
    setCrowdComment('');
    mutate();
  };

  const list = useMemo(() => sites, [sites]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>JP Nationwide Evacuation Finder</title>
      </Head>
      <header className="bg-white shadow">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">全国避難場所ファインダー</h1>
            <p className="text-sm text-gray-600">位置情報と避難データを組み合わせて最寄りの避難場所を探します。</p>
          </div>
          <div className="text-xs text-gray-500">転送コード: {transferCode ?? '...'} / デバイスID: {deviceHash ?? '...'}</div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <section className="grid gap-4 rounded-lg bg-white p-4 shadow md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-semibold">住所検索</label>
            <div className="flex gap-2">
              <input
                className="w-full rounded border px-3 py-2"
                placeholder="例: 東京駅"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button
                onClick={handleSearch}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                disabled={searching}
              >
                {searching ? '検索中...' : '検索'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold">表示件数</label>
            <select
              className="w-full rounded border px-3 py-2"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[5, 10, 20].map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold">現在地</label>
            <button
              onClick={handleLocate}
              className="w-full rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
            >
              現在地を使う
            </button>
          </div>
          <div className="md:col-span-4">
            <label className="block text-sm font-semibold">ハザードフィルター</label>
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
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <MapView
              sites={list}
              center={coords}
              onSelect={(site) => setSelectedSite(site)}
            />
            <div className="mt-2 text-xs text-gray-600">
              位置情報はブラウザ内でのみ利用されます。データ提供元の最新情報を必ず確認してください。
            </div>
          </div>
          <div className="space-y-3 md:col-span-2">
            <div className="rounded-lg bg-white p-4 shadow">
              <h2 className="text-lg font-semibold">近くの避難場所</h2>
              <div className="mt-3 space-y-2">
                {list.map((site) => (
                  <button
                    key={site.id}
                    className={classNames(
                      'flex w-full flex-col rounded border p-3 text-left hover:border-blue-500',
                      selectedSite?.id === site.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    )}
                    onClick={() => setSelectedSite(site)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{site.name}</div>
                      {site.distance !== undefined && (
                        <span className="text-sm text-gray-600">{site.distance.toFixed(2)} km</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{site.address}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hazardKeys
                        .filter((key) => (site.hazards as any)?.[key])
                        .map((key) => (
                          <span key={key} className="rounded bg-emerald-100 px-2 py-1 text-[10px] text-emerald-800">
                            {hazardLabels[key]}
                          </span>
                        ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-white p-4 shadow">
              <h2 className="text-lg font-semibold">施設詳細</h2>
              {selectedSite ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xl font-bold">{selectedSite.name}</div>
                    <div className="text-sm text-gray-600">{selectedSite.address}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {hazardKeys
                      .filter((key) => (selectedSite.hazards as any)?.[key])
                      .map((key) => (
                        <span key={key} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                          {hazardLabels[key]}
                        </span>
                      ))}
                  </div>
                  <div className="rounded bg-gray-50 p-2 text-xs text-gray-700">
                    データは公的オープンデータをもとにしています。最新の自治体情報を必ず確認してください。
                  </div>
                  <div>
                    <h3 className="font-semibold">混雑状況 (直近60分)</h3>
                    <div className="text-sm text-gray-700">
                      {crowdSummary?.count ? `${crowdSummary.count}件の報告` : '報告なし'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold">混雑度を報告</h3>
                    <select
                      className="w-full rounded border px-3 py-2"
                      value={crowdStatus}
                      onChange={(e) => setCrowdStatus(e.target.value)}
                    >
                      {['OK', 'CROWDED', 'VERY_CROWDED', 'CLOSED', 'BLOCKED'].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="w-full rounded border px-3 py-2"
                      placeholder="混雑状況や注意点"
                      value={crowdComment}
                      onChange={(e) => setCrowdComment(e.target.value)}
                    />
                    <button
                      onClick={handleReport}
                      className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400"
                      disabled={!deviceHash}
                    >
                      送信
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">施設を選択してください。</div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
          <span>
            本アプリのデータは公的オープンデータを基にしており、最新の自治体の公式情報を必ず優先してください。安全確保はご自身でお願いいたします。
          </span>
          <span className="text-xs text-gray-500">JP Nationwide Evacuation Finder (MVP)</span>
        </div>
      </footer>
    </div>
  );
}
