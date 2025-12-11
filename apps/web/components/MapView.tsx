import dynamic from 'next/dynamic';
import { HazardKey, hazardLabels } from '@jp-evac/shared';

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  hazards: HazardKey[];
  distance?: number;
};

const MapCanvas = dynamic(() => import('./MapViewInner'), { ssr: false });

export default function MapView({ markers, center, radiusKm, onSelect }: {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  radiusKm: number;
  onSelect?: (id: string) => void;
}) {
  return <MapCanvas markers={markers} center={center} radiusKm={radiusKm} hazardLabels={hazardLabels} onSelect={onSelect} />;
}
