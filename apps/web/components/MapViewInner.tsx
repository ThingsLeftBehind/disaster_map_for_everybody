import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MarkerData {
  id: string;
  name: string;
  position: { lat: number; lon: number };
  hazards: Record<string, boolean>;
  distance?: number;
}

interface Props {
  center: { lat: number; lon: number };
  markers: MarkerData[];
  hazardLabels: Record<string, string>;
  onSelect: (marker: MarkerData) => void;
}

export default function MapViewInner({ center, markers, hazardLabels, onSelect }: Props) {
  useEffect(() => {
    // Fix for leaflet icon paths when bundling
  }, []);

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={11} scrollWheelZoom={true} className="h-96 w-full rounded-lg">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map((marker) => (
        <Marker key={marker.id} position={[marker.position.lat, marker.position.lon]} eventHandlers={{ click: () => onSelect(marker as any) }}>
          <Popup>
            <div className="space-y-2">
              <div className="font-semibold">{marker.name}</div>
              {marker.distance !== undefined && <div className="text-sm text-gray-600">{marker.distance.toFixed(2)} km</div>}
              <div className="flex flex-wrap gap-1">
                {Object.entries(marker.hazards)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => (
                    <span key={key} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                      {hazardLabels[key] ?? key}
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
