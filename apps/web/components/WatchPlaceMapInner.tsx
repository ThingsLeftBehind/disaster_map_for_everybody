import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { GENERAL_MAP_TILE_LAYER } from 'lib/map/providers';

export type WatchPlaceCoords = { lat: number; lon: number };

type Props = {
  center: WatchPlaceCoords;
  selected: WatchPlaceCoords | null;
  onChange: (coords: WatchPlaceCoords) => void;
};

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

function Recenter({ center }: { center: WatchPlaceCoords }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lon], Math.max(map.getZoom(), 14), { animate: true });
  }, [center.lat, center.lon, map]);
  return null;
}

function ClickToSelect({ onChange }: { onChange: (coords: WatchPlaceCoords) => void }) {
  useMapEvents({
    click: (event) => {
      onChange({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });
  return null;
}

export default function WatchPlaceMapInner({ center, selected, onChange }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-gray-100">
      <MapContainer center={[center.lat, center.lon]} zoom={14} scrollWheelZoom className="h-[360px] w-full">
        <Recenter center={center} />
        <ClickToSelect onChange={onChange} />
        <TileLayer
          attribution={GENERAL_MAP_TILE_LAYER.attribution}
          url={GENERAL_MAP_TILE_LAYER.url}
          maxNativeZoom={GENERAL_MAP_TILE_LAYER.maxNativeZoom}
        />
        {selected && (
          <Marker
            position={[selected.lat, selected.lon]}
            draggable
            eventHandlers={{
              dragend: (event) => {
                const marker = event.target as L.Marker;
                const latLng = marker.getLatLng();
                onChange({ lat: latLng.lat, lon: latLng.lng });
              },
            }}
          >
            <Popup>
              <div className="text-sm font-semibold">保存する位置</div>
              <div className="mt-1 text-xs text-gray-700">ドラッグまたは地図タップで調整できます。</div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
