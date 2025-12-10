import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { hazardLabels } from '@jp-evac/shared';
import type { evac_sites } from '@jp-evac/db';

const DynamicMap = dynamic(() => import('./MapViewInner'), { ssr: false });

export type SiteWithDistance = evac_sites & { distance?: number };

interface Props {
  sites: SiteWithDistance[];
  center: { lat: number; lon: number };
  onSelect: (site: SiteWithDistance) => void;
}

export default function MapView({ sites, center, onSelect }: Props) {
  const markers = useMemo(
    () =>
      sites.map((site) => ({
        id: site.id,
        name: site.name,
        position: { lat: site.lat, lon: site.lon },
        hazards: site.hazards as Record<string, boolean>,
        distance: site.distance,
      })),
    [sites]
  );

  return <DynamicMap center={center} markers={markers} onSelect={onSelect} hazardLabels={hazardLabels} />;
}
