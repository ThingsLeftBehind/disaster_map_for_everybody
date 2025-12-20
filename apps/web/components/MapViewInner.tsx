import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { buildUrl, formatShelterShareText } from 'lib/client/share';
import { type Coords } from 'lib/client/location';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

interface MarkerData {
  id: string;
  name: string;
  position: { lat: number; lon: number };
  hazards: Record<string, boolean>;
  distance?: number;
}

type CheckinStatus = 'INJURED' | 'SAFE' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED';

interface Props {
  center: { lat: number; lon: number };
  recenterSignal?: number;
  origin?: Coords | null;
  fromAreaLabel?: string | null;
  markers: MarkerData[];
  hazardLabels: Record<string, string>;
  onSelect: (marker: MarkerData) => void;
  checkinPins?: Array<{
    id: string;
    status: CheckinStatus;
    lat: number;
    lon: number;
    comment: string | null;
    updatedAt: string;
    archived: boolean;
    reportCount: number;
    commentHidden: boolean;
  }> | null;
  checkinModerationPolicy?: { reportCautionThreshold: number; reportHideThreshold: number } | null;
  onReportCheckin?: ((pinId: string) => void) | null;
}

function Recenter({ center, recenterSignal }: { center: { lat: number; lon: number }; recenterSignal: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lon], map.getZoom(), { animate: true });
  }, [center.lat, center.lon, map, recenterSignal]);
  return null;
}

function formatAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '不明';
  return new Date(t).toLocaleString();
}

function statusMeta(status: CheckinStatus): {
  label: string;
  short: string;
  color: string;
} {
  switch (status as any) {
    case 'SAFE':
      return { label: '無事', short: '無', color: '#16a34a' };
    case 'INJURED':
      return { label: '負傷', short: '負', color: '#f59e0b' };
    case 'ISOLATED':
      return { label: '孤立', short: '孤', color: '#dc2626' };
    case 'EVACUATING':
      return { label: '避難中', short: '避', color: '#2563eb' };
    case 'COMPLETED':
      return { label: '避難完了', short: '完', color: '#059669' };
    default:
      return { label: '不明', short: '?', color: '#6b7280' };
  }
}

const pinIconCache = new Map<string, L.DivIcon>();
function getPinIcon(status: CheckinStatus, archived: boolean): L.DivIcon {
  const meta = statusMeta(status);
  const key = `${status}:${archived ? 'arch' : 'active'}`;
  const cached = pinIconCache.get(key);
  if (cached) return cached;

  const bg = archived ? '#6b7280' : meta.color;
  const size = archived ? 18 : 22;
  const html = `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${archived ? 10 : 12}px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);opacity:${archived ? 0.75 : 1};">${meta.short}</div>`;
  const icon = L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
  pinIconCache.set(key, icon);
  return icon;
}

export default function MapViewInner({
  center,
  recenterSignal = 0,
  origin = null,
  fromAreaLabel = null,
  markers,
  hazardLabels,
  onSelect,
  checkinPins,
  checkinModerationPolicy,
  onReportCheckin,
}: Props) {
  const [tileError, setTileError] = useState<string | null>(null);

  const originUrl = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : null), []);

  useEffect(() => {
    // Fix for leaflet icon paths when bundling
  }, []);

  return (
    <div className="relative">
      <MapContainer center={[center.lat, center.lon]} zoom={11} scrollWheelZoom={true} className="h-[520px] w-full rounded-xl">
        <Recenter center={center} recenterSignal={recenterSignal} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        eventHandlers={{
          tileerror: () => {
            setTileError((prev) => prev ?? '地図タイルの読み込みに失敗しました。通信環境を確認してください。');
          },
        }}
      />
      {origin && (
        <CircleMarker
          center={[origin.lat, origin.lon]}
          radius={9}
          pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.75, weight: 2 }}
        >
          <Popup>
            <div className="space-y-1">
              <div className="font-semibold">現在地（概略）</div>
              <div className="text-xs text-gray-700">{fromAreaLabel ?? 'エリア未確定'}</div>
            </div>
          </Popup>
        </CircleMarker>
      )}
      {(checkinPins ?? []).map((pin) => {
        const meta = statusMeta(pin.status);
        const cautionThreshold = checkinModerationPolicy?.reportCautionThreshold ?? 3;
        const showCaution = pin.reportCount >= cautionThreshold;
        return (
          <Marker
            key={`pin:${pin.id}`}
            position={[pin.lat, pin.lon]}
            icon={getPinIcon(pin.status, pin.archived)}
            zIndexOffset={pin.archived ? 500 : 900}
          >
            <Popup>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    {meta.label}
                    {pin.archived && <span className="ml-2 text-xs text-gray-600">（履歴）</span>}
                  </div>
                  {showCaution && (
                    <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                      多数の通報あり
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600">更新: {formatAt(pin.updatedAt)}</div>

                {pin.comment && !pin.commentHidden && <div className="whitespace-pre-wrap text-sm text-gray-900">{pin.comment}</div>}
                {pin.comment && pin.commentHidden && (
                  <details className="rounded border bg-gray-50 px-2 py-2">
                    <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900">
                      通報により非表示（詳細を見る）
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{pin.comment}</div>
                  </details>
                )}

                {onReportCheckin && (
                  <button
                    className="rounded bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                    onClick={() => onReportCheckin(pin.id)}
                  >
                    通報
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
      {markers.map((marker) => (
        <Marker key={marker.id} position={[marker.position.lat, marker.position.lon]}>
          <Popup>
            <ShelterPopup
              marker={marker}
              hazardLabels={hazardLabels}
              onOpenDetails={() => onSelect(marker)}
              originUrl={originUrl}
              origin={origin}
              fromAreaLabel={fromAreaLabel}
            />
          </Popup>
        </Marker>
      ))}
      </MapContainer>

      {tileError && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[85%] rounded-xl border bg-white/90 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          {tileError}
        </div>
      )}
    </div>
  );
}

function googleMapsRouteUrl(args: { origin?: Coords | null; dest: Coords }) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${args.dest.lat},${args.dest.lon}`);
  if (args.origin) u.searchParams.set('origin', `${args.origin.lat},${args.origin.lon}`);
  u.searchParams.set('travelmode', 'walking');
  return u.toString();
}

function ShelterPopup({
  marker,
  hazardLabels,
  onOpenDetails,
  originUrl,
  origin,
  fromAreaLabel,
}: {
  marker: MarkerData;
  hazardLabels: Record<string, string>;
  onOpenDetails: () => void;
  originUrl: string | null;
  origin: Coords | null;
  fromAreaLabel: string | null;
}) {
  const shareUrl = originUrl ? buildUrl(originUrl, `/shelters/${marker.id}`, {}) : null;
  const shareText = formatShelterShareText({
    shelterName: marker.name,
    address: null,
    fromArea: fromAreaLabel,
    now: new Date(),
  });

  const share = async () => {
    if (!shareUrl) return;
    try {
      const nav = navigator as Navigator & { share?: (data: { text?: string; url?: string }) => Promise<void> };
      if (nav.share) {
        await nav.share({ text: shareText, url: shareUrl });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        return;
      }
      window.prompt('共有テキスト', `${shareText}\n${shareUrl}`);
    } catch {
      // ignore
    }
  };

  const dest: Coords = { lat: marker.position.lat, lon: marker.position.lon };

  return (
    <div className="space-y-2">
      <div className="font-semibold">{marker.name}</div>
      {typeof marker.distance === 'number' && <div className="text-sm text-gray-600">{marker.distance.toFixed(2)} km</div>}
      <div className="flex flex-wrap gap-1">
        {Object.entries(marker.hazards)
          .filter(([, enabled]) => enabled)
          .slice(0, 6)
          .map(([key]) => (
            <span key={key} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
              {hazardLabels[key] ?? key}
            </span>
          ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button className="rounded bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black" onClick={onOpenDetails}>
          詳細
        </button>
        <a
          href={googleMapsRouteUrl({ origin, dest })}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
        >
          Google Mapsで経路
        </a>
        <button
          className="rounded bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-60"
          disabled={!shareUrl}
          onClick={share}
        >
          共有
        </button>
      </div>
    </div>
  );
}
