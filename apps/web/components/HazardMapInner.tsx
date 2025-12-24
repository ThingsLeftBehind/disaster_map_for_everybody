import { CircleMarker, MapContainer, Pane, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createLayerComponent, updateGridLayer } from '@react-leaflet/core';
import L from 'leaflet';

export type HazardLayer = {
  key: string;
  jaName: string;
  tileUrl: string;
  scheme?: 'xyz' | 'tms';
  tiles?: Array<{ url: string; scheme?: 'xyz' | 'tms' }>;
  minZoom: number;
  maxZoom: number;
};

type TileErrorSample = {
  at: string;
  status: number | null;
  url: string;
};

type OverlayDiagnostics = {
  updatedAt: string;
  items: Array<{
    key: string;
    urls: string[];
    loaded: number;
    errors: number;
    fatalErrors: number;
    errorSamples: TileErrorSample[];
  }>;
};

const LANDSLIDE_TILE_URLS = [
  'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
  'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png',
  'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png',
];

function toProxyUrl(url: string) {
  // Encode the URL but preserve template parameters {z}, {x}, {y} so Leaflet can replace them
  return `/api/tiles/gsi?url=${encodeURIComponent(url).replace(/%7B/g, '{').replace(/%7D/g, '}')}`;
}

const JAPAN_BOUNDS: L.LatLngBoundsExpression = [
  [20.0, 122.0],
  [45.33, 153.98], // Slightly optimized bounds
];
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function overlayTiles(layer: HazardLayer): Array<{ url: string; scheme: 'xyz' | 'tms' }> {
  if (layer.tiles && layer.tiles.length > 0) {
    return layer.tiles.map((tile) => ({ url: tile.url, scheme: tile.scheme ?? layer.scheme ?? 'xyz' }));
  }
  if (layer.key === 'landslide') {
    return LANDSLIDE_TILE_URLS.map((url) => ({ url: toProxyUrl(url), scheme: layer.scheme ?? 'xyz' }));
  }
  return [{ url: layer.tileUrl, scheme: layer.scheme ?? 'xyz' }];
}

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const anyErr = error as any;
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr?.response?.status;
  if (typeof status === 'number') return status;
  const message = typeof anyErr.message === 'string' ? anyErr.message : '';
  const match = message.match(/\b(401|403|404|410|429|500|502|503)\b/);
  if (match) return Number(match[1]);
  return null;
}

function isKnownHazardDomain(url: string | null): boolean {
  if (!url) return false;
  if (url.startsWith('/api/tiles/')) return true;
  return /disaportaldata\.gsi\.go\.jp|cyberjapandata\.gsi\.go\.jp/i.test(url);
}

type HazardTileLayerProps = {
  url: string;
  scheme: 'xyz' | 'tms';
  errorTileUrl?: string;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  maxNativeZoom?: number;
  bounds?: L.LatLngBoundsExpression;
  noWrap?: boolean;
  zIndex?: number;
  attribution?: string;
  eventHandlers?: L.LeafletEventHandlerFnMap;
};

function applyTileScheme(layer: L.TileLayer, url: string, scheme: 'xyz' | 'tms') {
  if (scheme === 'tms') {
    layer.getTileUrl = function (coords: L.Coords) {
      const y = (1 << coords.z) - 1 - coords.y;
      const data = { ...coords, y, s: (this as any)._getSubdomain(coords) };
      return L.Util.template(url, data);
    };
  } else {
    layer.getTileUrl = function (coords: L.Coords) {
      const data = { ...coords, s: (this as any)._getSubdomain(coords) };
      return L.Util.template(url, data);
    };
  }
}

const HazardTileLayer = createLayerComponent<L.TileLayer, HazardTileLayerProps>(
  function createLayer({ url, scheme, eventHandlers, ...options }, context) {
    const layer = L.tileLayer(url, options);
    applyTileScheme(layer, url, scheme);
    return { instance: layer, context };
  },
  function updateLayer(layer, props, prevProps) {
    if (props.url !== prevProps.url) layer.setUrl(props.url);
    if (props.url !== prevProps.url || props.scheme !== prevProps.scheme) applyTileScheme(layer, props.url, props.scheme);
    updateGridLayer(layer, props, prevProps);
  }
);

function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  useMapEvents({
    zoomend: (evt) => {
      const zoom = evt.target.getZoom();
      onZoomChange(zoom);
    },
  });
  return null;
}

function Recenter({ center }: { center: { lat: number; lon: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lon], map.getZoom(), { animate: true });
  }, [center.lat, center.lon, map]);
  return null;
}

export default function HazardMapInner({
  enabledKeys,
  layers,
  center,
  onZoomOutOfRange,
  onZoomValid,
  onDiagnostics,
  userLocation,
}: {
  enabledKeys: string[];
  layers: HazardLayer[];
  center: { lat: number; lon: number };
  onZoomOutOfRange: (args: { direction: 'low' | 'high'; zoom: number; min: number; max: number; keys: string[] }) => void;
  onZoomValid?: (keys: string[]) => void;
  onDiagnostics?: (diag: OverlayDiagnostics) => void;
  userLocation?: { lat: number; lon: number } | null;
}) {
  const overlays = useMemo(() => layers.filter((l) => enabledKeys.includes(l.key)), [enabledKeys, layers]);
  const overlayTileEntries = useMemo(
    () =>
      overlays.flatMap((layer) =>
        overlayTiles(layer).map((tile, idx) => ({
          layer,
          url: tile.url,
          scheme: tile.scheme,
          tileId: `${layer.key}:${idx}:${tile.scheme}`,
        }))
      ),
    [overlays]
  );
  const minOverlayZoom = useMemo(() => {
    const mins = overlays.map((o) => o.minZoom).filter((n) => Number.isFinite(n));
    return mins.length > 0 ? Math.min(...mins) : 10;
  }, [overlays]);
  const maxOverlayZoom = useMemo(() => {
    const maxs = overlays.map((o) => o.maxZoom).filter((n) => Number.isFinite(n));
    return maxs.length > 0 ? Math.max(...maxs) : 18;
  }, [overlays]);
  const [ready, setReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(11);
  const [baseTileError, setBaseTileError] = useState<string | null>(null);
  const [overlayTileError, setOverlayTileError] = useState<string | null>(null);
  const statsRef = useRef<Record<string, { urls: Set<string>; loaded: number; errors: number; fatalErrors: number; errorSamples: TileErrorSample[] }>>({});
  const diagTimerRef = useRef<number | null>(null);
  const diagnosticsEnabled = Boolean(onDiagnostics) && process.env.NODE_ENV !== 'production';

  const safeTileOptions = {
    bounds: JAPAN_BOUNDS,
    noWrap: true,
    errorTileUrl: TRANSPARENT_PNG,
  };

  useEffect(() => setReady(true), []);
  const hasOverlays = overlays.length > 0;
  const zoomInRange = hasOverlays && currentZoom >= minOverlayZoom && currentZoom <= maxOverlayZoom;

  useEffect(() => {
    if (!hasOverlays || !zoomInRange) setOverlayTileError(null);
  }, [hasOverlays, zoomInRange]);

  useEffect(() => {
    setOverlayTileError(null);
  }, [enabledKeys.join('|')]);

  useEffect(() => {
    statsRef.current = {};
    if (diagnosticsEnabled && onDiagnostics) {
      onDiagnostics({
        updatedAt: new Date().toISOString(),
        items: [],
      });
    }
  }, [diagnosticsEnabled, enabledKeys, onDiagnostics]);

  useEffect(() => {
    if (!diagnosticsEnabled) return;
    if (overlayTileEntries.length === 0) return;
    const entries = overlayTileEntries.map((entry) => ({
      key: entry.layer.key,
      url: entry.url,
      scheme: entry.scheme,
      minZoom: entry.layer.minZoom,
      maxZoom: entry.layer.maxZoom,
    }));
    // eslint-disable-next-line no-console
    console.debug('[hazard] resolved tiles', entries);
  }, [diagnosticsEnabled, overlayTileEntries]);

  const queueDiagnostics = () => {
    if (!diagnosticsEnabled || !onDiagnostics) return;
    if (diagTimerRef.current !== null) return;
    diagTimerRef.current = window.setTimeout(() => {
      diagTimerRef.current = null;
      const items = Object.entries(statsRef.current).map(([key, stat]) => ({
        key,
        urls: Array.from(stat.urls),
        loaded: stat.loaded,
        errors: stat.errors,
        fatalErrors: stat.fatalErrors,
        errorSamples: stat.errorSamples,
      }));
      onDiagnostics({ updatedAt: new Date().toISOString(), items });
    }, 400);
  };

  const bumpStats = (key: string, url: string, kind: 'load' | 'error', fatal: boolean, sample?: TileErrorSample) => {
    if (!diagnosticsEnabled) return;
    const bucket = statsRef.current[key] ?? { urls: new Set<string>(), loaded: 0, errors: 0, fatalErrors: 0, errorSamples: [] };
    bucket.urls.add(url);
    if (kind === 'load') bucket.loaded += 1;
    if (kind === 'error') bucket.errors += 1;
    if (fatal) bucket.fatalErrors += 1;
    if (kind === 'error' && sample) {
      bucket.errorSamples = [...bucket.errorSamples, sample].slice(-6);
    }
    statsRef.current[key] = bucket;
    queueDiagnostics();
  };

  useEffect(() => {
    if (!hasOverlays) return;
    const lowKeys = overlays.filter((o) => currentZoom < o.minZoom).map((o) => o.key);
    const highKeys = overlays.filter((o) => currentZoom > o.maxZoom).map((o) => o.key);
    const validKeys = overlays.filter((o) => currentZoom >= o.minZoom && currentZoom <= o.maxZoom).map((o) => o.key);

    if (lowKeys.length > 0) onZoomOutOfRange({ direction: 'low', zoom: currentZoom, min: minOverlayZoom, max: maxOverlayZoom, keys: lowKeys });
    if (highKeys.length > 0) onZoomOutOfRange({ direction: 'high', zoom: currentZoom, min: minOverlayZoom, max: maxOverlayZoom, keys: highKeys });
    if (validKeys.length > 0 && onZoomValid) onZoomValid(validKeys);
  }, [currentZoom, hasOverlays, maxOverlayZoom, minOverlayZoom, onZoomOutOfRange, onZoomValid, overlays]);

  return (
    <div className="relative">
      <MapContainer center={[center.lat, center.lon]} zoom={11} scrollWheelZoom={true} className="h-[520px] w-full rounded-lg">
        <Recenter center={center} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          zIndex={1}
          eventHandlers={{
            tileerror: () => {
              setBaseTileError((prev) => prev ?? '地図タイルの読み込みに失敗しました。通信環境を確認してください。');
            },
          }}
        />
        <ZoomWatcher
          onZoomChange={setCurrentZoom}
        />
        <Pane name="hazard-overlays" style={{ zIndex: 200 }}>
          {ready &&
            zoomInRange &&
            overlayTileEntries
              .filter((entry) => currentZoom >= entry.layer.minZoom && currentZoom <= entry.layer.maxZoom)
              .map((entry) => (
                <HazardTileLayer
                  key={entry.tileId}
                  // For normal layers (not proxied), ensure HTTPS. For proxied, it's already relative /api/...
                  url={entry.url.startsWith('/api') ? entry.url : entry.url.replace(/^http:\/\//i, 'https://')}
                  scheme={entry.scheme}
                  opacity={0.7}
                  minZoom={entry.layer.minZoom}
                  maxZoom={entry.layer.maxZoom}
                  maxNativeZoom={entry.layer.maxZoom}
                  bounds={safeTileOptions.bounds}
                  noWrap={safeTileOptions.noWrap}
                  errorTileUrl={safeTileOptions.errorTileUrl}
                  zIndex={200}
                  attribution='&copy; <a href="https://disaportal.gsi.go.jp/">GSI Hazard Map</a>'
                  eventHandlers={{
                    tileload: () => {
                      bumpStats(entry.layer.key, entry.url, 'load', false);
                    },
                    tileerror: (event) => {
                      const status = readErrorStatus((event as any)?.error);
                      const src = (event as any)?.tile?.src ?? (event as any)?.target?.src ?? null;
                      const knownDomain = isKnownHazardDomain(src ?? entry.url);
                      // 404/410 are now benign (swallowed by proxy mostly, but just in case)
                      const benign = status === 404 || status === 410;
                      const fatal = status ? (status >= 500 || status === 401 || status === 403) : !knownDomain;
                      bumpStats(entry.layer.key, entry.url, 'error', fatal, {
                        at: new Date().toISOString(),
                        status,
                        url: src ?? entry.url,
                      });
                      if (!benign && fatal) {
                        setOverlayTileError((prev) => prev ?? 'ハザードレイヤーのみ取得できませんでした。地図は表示されています。');
                      }
                    },
                  }}
                />
              ))}
        </Pane>
        {userLocation && (
          <CircleMarker
            center={[userLocation.lat, userLocation.lon]}
            radius={8}
            pathOptions={{ color: '#ffffff', fillColor: '#2563eb', fillOpacity: 0.9, weight: 2 }}
          />
        )}
      </MapContainer>

      {(overlayTileError ?? baseTileError) && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[85%] rounded-xl border bg-white/90 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          {overlayTileError ?? baseTileError}
        </div>
      )}
    </div>
  );
}
