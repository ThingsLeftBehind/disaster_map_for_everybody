import { Seo } from '../components/Seo';
import useSWR from 'swr';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import HazardMap from '../components/HazardMap';
import { useDevice } from '../components/device/DeviceProvider';
import { loadLastLocation, saveLastLocation } from '../lib/client/location';
import { DataFetchDetails } from '../components/DataFetchDetails';

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
  const minRequiredZoom = useMemo(() => {
    const zooms = layers.map((layer) => layer.minZoom).filter((z) => Number.isFinite(z));
    return zooms.length > 0 ? Math.max(...zooms) : 10;
  }, [layers]);

  const [enabled, setEnabled] = useState<string[]>([]);
  const [zoomWarn, setZoomWarn] = useState<string | null>(null);
  const autoDisabledKeysRef = useRef<Set<string>>(new Set());
  const [geoError, setGeoError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
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
    // Clear zoom warning if user manually toggles ON at valid zoom
    if (!enabled.includes(key)) {
      autoDisabledKeysRef.current.delete(key);
      if (autoDisabledKeysRef.current.size === 0) {
        setZoomWarn(null);
      }
    }
  };

  const labelByKey = useMemo(() => new Map(layers.map((l) => [l.key, l.jaName])), [layers]);
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
      <Seo
        title="ハザード"
        description="洪水・土砂・津波・液状化などのハザードマップを重ねて確認できるページ。現在地周辺のリスク把握や避難経路の検討に役立ちます。低帯域環境でも必要情報を確認できるよう配慮しています。"
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        {/* H1 removed per requirement */}
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">ハザードマップ</h2>
          <button
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700"
            onClick={() => {
              setGeoError(null);
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                  saveLastLocation(loc);
                  setCenter(loc);
                  setUserLocation(loc);
                },
                (err) => {
                  if (err.code === err.PERMISSION_DENIED) {
                    setGeoError('位置情報の許可がありません。ブラウザ設定を確認してください。');
                  } else {
                    setGeoError('現在地を取得できませんでした。');
                  }
                },
                { enableHighAccuracy: false, timeout: 10000 }
              );
            }}
          >
            現在地へ
          </button>
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
            <div className="mt-3 relative">
              <HazardMap
                enabledKeys={enabled}
                layers={layers}
                center={center}
                initialZoom={minRequiredZoom}
                minRequiredZoom={minRequiredZoom}
                userLocation={userLocation}
                onDiagnostics={debugEnabled ? setDiagnostics : undefined}
                onZoomValid={(keys) => {
                  // Clear auto-disabled keys that are now valid
                  for (const k of keys) {
                    autoDisabledKeysRef.current.delete(k);
                  }
                  if (autoDisabledKeysRef.current.size === 0) {
                    setZoomWarn(null);
                  }
                }}
                onZoomOutOfRange={({ direction, keys }) => {
                  if (keys.length === 0) return;
                  setEnabled((prev) => prev.filter((k) => !keys.includes(k)));
                  for (const k of keys) {
                    autoDisabledKeysRef.current.add(k);
                  }
                  const label = keys.map((k) => labelByKey.get(k) ?? k).join('/');
                  if (direction === 'low') {
                    setZoomWarn(`${label}は拡大が必要なためOFFにしました。地図を拡大してから再度レイヤーを選択してください。`);
                  } else {
                    setZoomWarn(`${label}は縮小が必要なためOFFにしました。地図を縮小してから再度レイヤーを選択してください。`);
                  }
                }}
              />
            </div>

            {zoomWarn && <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{zoomWarn}</div>}
            {geoError && <div className="mt-2 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">{geoError}</div>}
          </>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">レイヤー選択</h2>
        {/* Label line removed per requirement */}
        <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
          {layers.map((l) => (
            <div key={l.key} className="space-y-1">
              <button
                disabled={lowBandwidth}
                onClick={() => toggle(l.key)}
                aria-pressed={enabled.includes(l.key)}
                className={`w-full rounded border px-3 py-2 text-sm font-semibold ${enabled.includes(l.key) ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-gray-300 bg-white text-gray-800'
                  } ${lowBandwidth ? 'opacity-50' : ''}`}
              >
                {l.jaName}
              </button>
              {/* Note removed */}
            </div>
          ))}
        </div>

        {/* Layer color explanation */}
        <LayerColorExplanation enabledKeys={enabled} labelByKey={labelByKey} />
      </section>

      <DataFetchDetails
        status={data?.fetchStatus ?? 'DEGRADED'}
        updatedAt={data?.updatedAt}
        fetchStatus={fetchStatus}
        error={!updatedAt ? data?.lastError : null}
      >
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
      </DataFetchDetails>

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

const LAYER_EXPLANATIONS: Record<
  string,
  { description: string; legend: Array<{ label: string; color: string }>; guidance: string[] }
> = {
  flood: {
    description: '洪水浸水想定区域（L2想定最大）を表示しています。',
    legend: [
      { label: '浅い', color: 'bg-blue-100' },
      { label: '中程度', color: 'bg-blue-300' },
      { label: '深い', color: 'bg-blue-600' },
    ],
    guidance: [
      '低地や地下は浸水しやすいため、早めに高い場所へ移動する準備をしてください。',
      '河川沿い・橋の下には近づかず、周辺の安全を最優先に行動してください。',
      '避難情報やハザードの更新を確認し、無理のない範囲で避難を検討してください。',
    ],
  },
  landslide: {
    description: '土砂災害警戒区域（土石流・急傾斜地・地すべり）を表示しています。',
    legend: [
      { label: '警戒区域', color: 'bg-yellow-300' },
      { label: '特別警戒区域', color: 'bg-red-500' },
    ],
    guidance: [
      '斜面や崖の近くから離れ、安全な建物内に避難してください。',
      '強い雨が続くときは早めに移動し、避難経路の安全を確認してください。',
    ],
  },
  tsunami: {
    description: '津波浸水想定区域を表示しています。',
    legend: [
      { label: '低い', color: 'bg-cyan-100' },
      { label: '中程度', color: 'bg-cyan-300' },
      { label: '高い', color: 'bg-cyan-600' },
    ],
    guidance: [
      '強い揺れや津波警報が出たら、すぐ高台や指定の避難場所へ向かってください。',
      '海岸・河口・川沿いには近づかず、情報更新に注意してください。',
    ],
  },
  liquefaction: {
    description: '液状化危険度（2012年版）を表示しています。',
    legend: [
      { label: '低い', color: 'bg-amber-100' },
      { label: 'やや高い', color: 'bg-amber-300' },
      { label: '高い', color: 'bg-orange-500' },
    ],
    guidance: [
      '道路の段差や沈下が起きる可能性があります。足元の安全を確認してください。',
      'マンホールの浮き上がり等に注意し、無理な移動を避けてください。',
    ],
  },
};

function LayerColorExplanation({ enabledKeys, labelByKey }: { enabledKeys: string[]; labelByKey: Map<string, string> }) {
  const [isOpen, setIsOpen] = useState(true);

  if (enabledKeys.length === 0) return null;

  const explanations = enabledKeys
    .map((key) => ({ key, label: labelByKey.get(key) ?? key, ...LAYER_EXPLANATIONS[key] }))
    .filter((e) => e.description);

  if (explanations.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border bg-gray-50 p-3">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm font-semibold text-gray-800">色の見方</span>
        <span className="text-xs text-gray-500">{isOpen ? '閉じる' : '開く'}</span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
          {explanations.map((e) => (
            <div key={e.key} className="text-xs text-gray-700">
              <div className="font-semibold">{e.label}</div>
              <div className="mt-1">{e.description}</div>
              {e.legend.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] font-semibold text-gray-600">凡例</div>
                  <div className="mt-1 space-y-1">
                    {e.legend.map((item) => (
                      <div key={`${e.key}-${item.label}`} className="flex items-center gap-2">
                        <span className={`h-3 w-3 rounded ${item.color}`} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {e.guidance.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] font-semibold text-gray-600">避難の考え方</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {e.guidance.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <div className="mt-2 rounded border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            濃い色ほど危険度が高い目安です。透明/空白部分はデータなし・範囲外・極低リスクの場合があります。
          </div>
        </div>
      )}
    </div>
  );
}
