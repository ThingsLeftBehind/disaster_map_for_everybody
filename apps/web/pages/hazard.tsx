import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import HazardMap from '../components/HazardMap';
import { useDevice } from '../components/device/DeviceProvider';
import { loadLastLocation } from '../lib/client/location';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const healthFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('health');
  return res.json();
};

type HazardLayerTile = { url: string; scheme?: 'xyz' | 'tms' };
type HazardLayer = { key: string; name: string; jaName: string; tileUrl: string; scheme?: 'xyz' | 'tms'; tiles?: HazardLayerTile[]; minZoom: number; maxZoom: number };
type TileErrorSample = { at: string; status: number | null; url: string };
type OverlayDiagnostics = {
  updatedAt: string;
  items: Array<{ key: string; urls: string[]; loaded: number; errors: number; fatalErrors: number; errorSamples: TileErrorSample[] }>;
};

export default function HazardPage() {
  const router = useRouter();
  const { device } = useDevice();
  const lowBandwidth = Boolean(device?.settings?.lowBandwidth || device?.settings?.powerSaving);

  const { data } = useSWR('/api/gsi/hazard-layers', fetcher, { dedupingInterval: 60_000 });
  const fallbackLayers: HazardLayer[] = [
    { key: 'flood', name: 'Flood', jaName: '洪水', tileUrl: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 17 },
    {
      key: 'landslide',
      name: 'Landslide',
      jaName: '土砂災害',
      tileUrl: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
      scheme: 'xyz',
      tiles: [
        { url: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
        { url: 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
        { url: 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
      ],
      minZoom: 10,
      maxZoom: 17,
    },
    { key: 'tsunami', name: 'Tsunami', jaName: '津波', tileUrl: '/api/tiles/tsunami/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 17 },
    { key: 'liquefaction', name: 'Liquefaction', jaName: '液状化', tileUrl: '/api/tiles/lcm25k_2012/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 16 },
  ];
  const layers: HazardLayer[] = data?.layers?.length ? data.layers : fallbackLayers;
  const fetchStatus: string = data?.fetchStatus ?? 'DEGRADED';
  const updatedAt: string | null = data?.updatedAt ?? null;
  const lastError: string | null = data?.lastError ?? null;

  const [enabled, setEnabled] = useState<string[]>([]);
  const [zoomWarn, setZoomWarn] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<OverlayDiagnostics | null>(null);
  const debugEnabled = process.env.NODE_ENV !== 'production' && String(router.query.debug ?? '') === '1';
  const { data: health, error: healthError } = useSWR(debugEnabled ? '/api/health' : null, healthFetcher, { dedupingInterval: 30_000, shouldRetryOnError: false });
  const apiUnreachable = debugEnabled && (healthError || health?.ok !== true);

  const [center, setCenter] = useState<{ lat: number; lon: number }>({ lat: 35.681236, lon: 139.767125 });
  useEffect(() => {
    try {
      const last = loadLastLocation();
      if (last) setCenter({ lat: last.lat, lon: last.lon });
    } catch {
      // ignore
    }
  }, []);

  const toggle = (key: string) => {
    setEnabled((prev) => {
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    });
  };

  const labelByKey = useMemo(() => new Map(layers.map((l) => [l.key, l.jaName])), [layers]);
  const enabledNames = useMemo(() => enabled.map((k) => labelByKey.get(k) ?? k), [enabled, labelByKey]);
  const diagnosticsByKey = useMemo(() => new Map((diagnostics?.items ?? []).map((item) => [item.key, item])), [diagnostics]);
  const layerWarnings = useMemo(
    () =>
      layers
        .map((layer) => {
          const diag = diagnosticsByKey.get(layer.key);
          const errors = diag?.errors ?? 0;
          const fatal = diag?.fatalErrors ?? 0;
          if (errors === 0) return null;
          return { key: layer.key, label: layer.jaName, errors, fatal };
        })
        .filter(Boolean) as Array<{ key: string; label: string; errors: number; fatal: number }>,
    [diagnosticsByKey, layers]
  );

  return (
    <div className="space-y-6">
      <Head>
        <title>ハザード（地図） | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">ハザード（地図）</h1>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">地図（デフォルト: OFF）</h2>
        <div className="mt-2 text-xs text-gray-600">
          レイヤーをONにするとタイルを読み込みます。ズームが低い場合は自動的にOFFになります。
        </div>
        {apiUnreachable && (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Server API unreachable (wrong port or dev server stopped).
          </div>
        )}

        {lowBandwidth ? (
          <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            低帯域/省電力モードがONのため、地図は無効です。/main でOFFにすると表示できます。
          </div>
        ) : (
          <>
            <div className="mt-3">
              <HazardMap
                enabledKeys={enabled}
                layers={layers}
                center={center}
                onDiagnostics={debugEnabled ? setDiagnostics : undefined}
                onZoomOutOfRange={({ direction, keys }) => {
                  if (keys.length === 0) return;
                  setEnabled((prev) => prev.filter((k) => !keys.includes(k)));
                  const label = keys.map((k) => labelByKey.get(k) ?? k).join(' / ');
                  if (direction === 'low') {
                    setZoomWarn(`${label} は拡大が必要なためOFFにしました。地図を拡大してから再度ONにしてください。`);
                  } else {
                    setZoomWarn(`${label} は縮小が必要なためOFFにしました。地図を縮小してから再度ONにしてください。`);
                  }
                }}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-600">ON: {enabledNames.length > 0 ? enabledNames.join(' / ') : 'なし'}</div>
              <button
                className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-800 hover:bg-gray-200"
                onClick={() => {
                  const last = loadLastLocation();
                  if (last) setCenter({ lat: last.lat, lon: last.lon });
                  else alert('最後の位置情報がありません（/main または /list で「現在地」を取得してください）');
                }}
              >
                最後の現在地へ
              </button>
            </div>

            {zoomWarn && <div className="mt-2 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">{zoomWarn}</div>}
          </>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">レイヤー選択</h2>
        <div className="mt-2 text-xs text-gray-600">洪水 / 土砂 / 津波 / 液状化（デフォルトOFF）</div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {layers.map((l) => (
            <div key={l.key} className="space-y-1">
              <button
                disabled={lowBandwidth}
                onClick={() => toggle(l.key)}
                aria-pressed={enabled.includes(l.key)}
                className={`w-full rounded border px-3 py-2 text-sm font-semibold ${
                  enabled.includes(l.key) ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-gray-300 bg-white text-gray-800'
                } ${lowBandwidth ? 'opacity-50' : ''}`}
              >
                {l.jaName}
              </button>
              {l.key === 'liquefaction' && (
                <div className="text-[11px] text-gray-600">
                  液状化はデータがある地域のみ表示されます。データがない地域は空白になります。
                </div>
              )}
            </div>
          ))}
        </div>

      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">取得状態</h2>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">fetchStatus</div>
            <div className="mt-1 font-semibold">{fetchStatus}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">updatedAt</div>
            <div className="mt-1 text-xs text-gray-700">{updatedAt ? new Date(updatedAt).toLocaleString() : 'No successful fetch yet'}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">lastError</div>
            <div className="mt-1 text-xs text-gray-700">{lastError ? '取得エラー' : 'なし'}</div>
          </div>
        </div>
        <div className="mt-3 rounded border bg-gray-50 p-3 text-xs text-gray-700">
          <div className="text-xs text-gray-600">タイル警告</div>
          {layerWarnings.length === 0 ? (
            <div className="mt-1">タイルエラーは検出されていません。</div>
          ) : (
            <div className="mt-1 space-y-1">
              {layerWarnings.map((warn) => (
                <div key={warn.key}>
                  {warn.label}: errors {warn.errors} / fatal {warn.fatal}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {debugEnabled && diagnostics && (
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="text-lg font-semibold">Overlay diagnostics (dev)</h2>
          <div className="mt-2 text-xs text-gray-600">更新: {new Date(diagnostics.updatedAt).toLocaleTimeString()}</div>
          <div className="mt-3 space-y-3 text-xs text-gray-700">
            {layers.map((layer) => {
              const diag = diagnosticsByKey.get(layer.key);
              const tiles = layer.tiles && layer.tiles.length > 0 ? layer.tiles : [{ url: layer.tileUrl, scheme: layer.scheme ?? 'xyz' }];
              const errorSamples = diag?.errorSamples ?? [];
              return (
                <div key={layer.key} className="rounded border bg-gray-50 p-3">
                  <div className="font-semibold">{layer.jaName}</div>
                  <div className="mt-1">
                    zoom: {layer.minZoom} - {layer.maxZoom} / loaded {diag?.loaded ?? 0} / errors {diag?.errors ?? 0} / fatal {diag?.fatalErrors ?? 0}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] text-gray-600">
                    {tiles.map((tile) => (
                      <div key={`${layer.key}-${tile.url}`}>
                        {tile.scheme ?? layer.scheme ?? 'xyz'}: {tile.url}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-600">
                    {errorSamples.length === 0 ? (
                      'tile errors: none'
                    ) : (
                      errorSamples.map((sample) => (
                        <div key={`${layer.key}-${sample.at}-${sample.url}`}>
                          {sample.status ?? 'ERR'} {new Date(sample.at).toLocaleTimeString()} {sample.url}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
