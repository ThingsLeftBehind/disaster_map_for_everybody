import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { useState } from 'react';
import { QUAKE_MAP_TILE_LAYER } from 'lib/map/providers';

delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

type IntensityArea = { code: string; maxIntensity: string | null };

type Props = {
  epicenter: {
    lat: number | null;
    lon: number | null;
    name: string | null;
    maxIntensity: string | null;
  } | null;
  intensityAreas: IntensityArea[];
};

const PREF_CENTROIDS: Record<string, { name: string; lat: number; lon: number }> = {
  '01': { name: '北海道', lat: 43.06417, lon: 141.34694 },
  '02': { name: '青森県', lat: 40.82444, lon: 140.74000 },
  '03': { name: '岩手県', lat: 39.70361, lon: 141.15250 },
  '04': { name: '宮城県', lat: 38.26889, lon: 140.87194 },
  '05': { name: '秋田県', lat: 39.71861, lon: 140.10250 },
  '06': { name: '山形県', lat: 38.24056, lon: 140.36333 },
  '07': { name: '福島県', lat: 37.75000, lon: 140.46778 },
  '08': { name: '茨城県', lat: 36.34139, lon: 140.44667 },
  '09': { name: '栃木県', lat: 36.56583, lon: 139.88361 },
  '10': { name: '群馬県', lat: 36.39111, lon: 139.06083 },
  '11': { name: '埼玉県', lat: 35.85694, lon: 139.64889 },
  '12': { name: '千葉県', lat: 35.60472, lon: 140.12333 },
  '13': { name: '東京都', lat: 35.68944, lon: 139.69167 },
  '14': { name: '神奈川県', lat: 35.44778, lon: 139.64250 },
  '15': { name: '新潟県', lat: 37.90222, lon: 139.02361 },
  '16': { name: '富山県', lat: 36.69528, lon: 137.21139 },
  '17': { name: '石川県', lat: 36.59444, lon: 136.62556 },
  '18': { name: '福井県', lat: 36.06528, lon: 136.22194 },
  '19': { name: '山梨県', lat: 35.66389, lon: 138.56833 },
  '20': { name: '長野県', lat: 36.65139, lon: 138.18111 },
  '21': { name: '岐阜県', lat: 35.39111, lon: 136.72222 },
  '22': { name: '静岡県', lat: 34.97694, lon: 138.38306 },
  '23': { name: '愛知県', lat: 35.18028, lon: 136.90667 },
  '24': { name: '三重県', lat: 34.73028, lon: 136.50861 },
  '25': { name: '滋賀県', lat: 35.00444, lon: 135.86833 },
  '26': { name: '京都府', lat: 35.02139, lon: 135.75556 },
  '27': { name: '大阪府', lat: 34.68639, lon: 135.52000 },
  '28': { name: '兵庫県', lat: 34.69139, lon: 135.18306 },
  '29': { name: '奈良県', lat: 34.68528, lon: 135.83278 },
  '30': { name: '和歌山県', lat: 34.22611, lon: 135.16750 },
  '31': { name: '鳥取県', lat: 35.50361, lon: 134.23833 },
  '32': { name: '島根県', lat: 35.47222, lon: 133.05056 },
  '33': { name: '岡山県', lat: 34.66167, lon: 133.93500 },
  '34': { name: '広島県', lat: 34.39639, lon: 132.45944 },
  '35': { name: '山口県', lat: 34.18583, lon: 131.47139 },
  '36': { name: '徳島県', lat: 34.06583, lon: 134.55944 },
  '37': { name: '香川県', lat: 34.34028, lon: 134.04333 },
  '38': { name: '愛媛県', lat: 33.84167, lon: 132.76611 },
  '39': { name: '高知県', lat: 33.55972, lon: 133.53111 },
  '40': { name: '福岡県', lat: 33.60639, lon: 130.41806 },
  '41': { name: '佐賀県', lat: 33.24944, lon: 130.29889 },
  '42': { name: '長崎県', lat: 32.74472, lon: 129.87361 },
  '43': { name: '熊本県', lat: 32.78972, lon: 130.74167 },
  '44': { name: '大分県', lat: 33.23806, lon: 131.61250 },
  '45': { name: '宮崎県', lat: 31.91111, lon: 131.42389 },
  '46': { name: '鹿児島県', lat: 31.56028, lon: 130.55806 },
  '47': { name: '沖縄県', lat: 26.21250, lon: 127.68111 },
};

const JAPAN_BOUNDS: [[number, number], [number, number]] = [
  [20.0, 122.0],
  [46.8, 154.0],
];

function intensityScore(raw: string | null): number {
  const text = String(raw ?? '').replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
  const m = text.match(/([0-7])\s*([+\-]|弱|強)?/);
  if (!m) return 0;
  const base = Number(m[1]);
  const mod = m[2] ?? '';
  if (mod === '+' || mod === '強') return base + 0.5;
  return base;
}

function intensityColor(raw: string | null): string {
  const score = intensityScore(raw);
  if (score >= 6.5) return '#7c2d12';
  if (score >= 6) return '#dc2626';
  if (score >= 5.5) return '#f97316';
  if (score >= 5) return '#f59e0b';
  if (score >= 4) return '#eab308';
  if (score >= 3) return '#65a30d';
  return '#2563eb';
}

export default function QuakeMonitorMap({ epicenter, intensityAreas }: Props) {
  const [tileError, setTileError] = useState(false);
  const hasEpicenter = typeof epicenter?.lat === 'number' && typeof epicenter?.lon === 'number';

  return (
    <div className="relative overflow-hidden rounded-xl border bg-gray-100">
      <MapContainer
        center={hasEpicenter ? [epicenter!.lat!, epicenter!.lon!] : [37.5, 137.5]}
        zoom={hasEpicenter ? 6 : 5}
        minZoom={4}
        maxBounds={JAPAN_BOUNDS}
        maxBoundsViscosity={0.8}
        scrollWheelZoom={false}
        className="h-[360px] w-full"
      >
        <TileLayer
          attribution={QUAKE_MAP_TILE_LAYER.attribution}
          url={QUAKE_MAP_TILE_LAYER.url}
          maxNativeZoom={QUAKE_MAP_TILE_LAYER.maxNativeZoom}
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
        {intensityAreas.map((area) => {
          const pref = PREF_CENTROIDS[area.code];
          if (!pref) return null;
          const score = intensityScore(area.maxIntensity);
          return (
            <CircleMarker
              key={area.code}
              center={[pref.lat, pref.lon]}
              radius={Math.max(6, 5 + score * 2)}
              pathOptions={{ color: intensityColor(area.maxIntensity), fillColor: intensityColor(area.maxIntensity), fillOpacity: 0.45, weight: 2 }}
            >
              <Popup>
                <div className="text-sm font-semibold">{pref.name}</div>
                <div className="text-xs text-gray-700">最大震度 {area.maxIntensity ?? '不明'}</div>
              </Popup>
            </CircleMarker>
          );
        })}
        {hasEpicenter && (
          <CircleMarker
            center={[epicenter!.lat!, epicenter!.lon!]}
            radius={12}
            pathOptions={{ color: '#111827', fillColor: '#ef4444', fillOpacity: 0.85, weight: 3 }}
          >
            <Popup>
              <div className="text-sm font-semibold">{epicenter?.name ?? '震源'}</div>
              <div className="text-xs text-gray-700">最大震度 {epicenter?.maxIntensity ?? '不明'}</div>
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
      {tileError && (
        <div className="absolute left-3 top-3 z-[1000] max-w-[88%] rounded-xl border bg-white/95 px-3 py-2 text-xs font-semibold text-amber-900">
          地図タイルを読み込めません。震源・津波情報はこのページ内のカードで確認できます。
        </div>
      )}
    </div>
  );
}
