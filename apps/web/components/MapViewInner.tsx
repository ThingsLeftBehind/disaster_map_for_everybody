import { MapContainer, Marker, Popup, TileLayer, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapMarker } from './MapView';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

export default function MapViewInner({
  markers,
  center,
  radiusKm,
  hazardLabels,
  onSelect
}: {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  radiusKm: number;
  hazardLabels: Record<string, string>;
  onSelect?: (id: string) => void;
}) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={11} scrollWheelZoom className="h-[420px] w-full rounded-xl">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Circle center={[center.lat, center.lng]} radius={radiusKm * 1000} pathOptions={{ color: '#2563eb', fillOpacity: 0.05 }} />
      {markers.map((marker) => (
        <Marker key={marker.id} position={[marker.lat, marker.lng]} eventHandlers={onSelect ? { click: () => onSelect(marker.id) } : undefined}>
          <Popup>
            <div className="space-y-1">
              <div className="font-semibold">{marker.name}</div>
              {marker.distance !== undefined && <div className="text-sm text-gray-600">{marker.distance.toFixed(2)} km</div>}
              <div className="flex flex-wrap gap-1">
                {marker.hazards.map((hazard) => (
                  <span key={hazard} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                    {hazardLabels[hazard] ?? hazard}
                  </span>
                ))}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
