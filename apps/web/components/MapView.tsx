import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { hazardLabels } from '@jp-evac/shared';
import type { evac_sites } from '@jp-evac/db';
import type { ComponentProps } from 'react';
import type { Coords } from 'lib/client/location';

const DynamicMap = dynamic(() => import('./MapViewInner'), { ssr: false });

export type SiteWithDistance = evac_sites & { distance?: number };

export type CheckinPin = {
  id: string;
  status: 'INJURED' | 'SAFE' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED';
  lat: number;
  lon: number;
  precision: 'COARSE' | 'PRECISE';
  comment: string | null;
  updatedAt: string;
  archived: boolean;
  archivedAt: string | null;
  reportCount: number;
  commentHidden: boolean;
};

interface Props {
  sites: SiteWithDistance[];
  center: { lat: number; lon: number };
  bounds?: [[number, number], [number, number]] | null;
  initialZoom?: number;
  recenterSignal?: number;
  origin?: Coords | null;
  fromAreaLabel?: string | null;
  onSelect: (site: SiteWithDistance) => void;
  onCenterChange?: ((coords: { lat: number; lon: number }) => void) | null;
  checkinPins?: CheckinPin[] | null;
  checkinModerationPolicy?: { reportCautionThreshold: number; reportHideThreshold: number } | null;
  onReportCheckin?: ((pinId: string) => void) | null;
  isFavorite?: (id: string) => boolean;
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
  onMarkerClick?: (site: SiteWithDistance) => void;
}

export default function MapView({
  sites,
  center,
  bounds,
  initialZoom,
  recenterSignal,
  origin,
  fromAreaLabel,
  onSelect,
  onCenterChange,
  checkinPins,
  checkinModerationPolicy,
  onReportCheckin,
  isFavorite,
  onToggleFavorite,
  onMarkerClick,
}: Props) {
  const sitesById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
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

  const handleSelect: ComponentProps<typeof DynamicMap>['onSelect'] = (marker) => {
    const site = sitesById.get(marker.id);
    if (site) onSelect(site);
  };
  const handleMarkerClick: ComponentProps<typeof DynamicMap>['onMarkerClick'] = (marker) => {
    if (!onMarkerClick) return;
    const site = sitesById.get(marker.id);
    if (site) onMarkerClick(site);
  };

  return (
    <DynamicMap
      center={center}
      bounds={bounds ?? null}
      initialZoom={initialZoom}
      recenterSignal={recenterSignal}
      origin={origin ?? null}
      fromAreaLabel={fromAreaLabel ?? null}
      markers={markers}
      onSelect={handleSelect}
      onCenterChange={onCenterChange ?? null}
      hazardLabels={hazardLabels}
      checkinPins={checkinPins ?? null}
      checkinModerationPolicy={checkinModerationPolicy ?? null}
      onReportCheckin={onReportCheckin ?? null}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      onMarkerClick={onMarkerClick ? handleMarkerClick : undefined}
    />
  );
}
