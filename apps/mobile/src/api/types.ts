export type FetchStatus = 'OK' | 'DEGRADED' | 'DOWN';

export type Shelter = {
  id: string | number;
  name: string | null;
  address: string | null;
  lat: number;
  lon: number;
  pref_city?: string | null;
  hazards?: Record<string, boolean> | null;
  kind?: string | null;
  distanceKm?: number | null;
  distance?: number | null;
  shelter_fields?: Record<string, unknown> | null;
  notes?: string | null;
};

export type SheltersNearbyResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  usedRadiusKm?: number | null;
  sites: Shelter[];
  items: Shelter[];
};

export type SheltersSearchResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  modeUsed?: string | null;
  prefName?: string | null;
  muniCode?: string | null;
  muniName?: string | null;
  sites: Shelter[];
  items: Shelter[];
};

export type ShelterVersionResponse = {
  fetchStatus: 'OK' | 'UNAVAILABLE';
  updatedAt: string | null;
  version: string | null;
  lastError?: string | null;
  count?: number | null;
};

export type ShelterDetailResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  site: Shelter | null;
};

export type CrowdVoteValue = 'EVACUATING' | 'SMOOTH' | 'NORMAL' | 'CROWDED' | 'CLOSED';

export type ShelterComment = {
  id: string;
  text: string;
  createdAt: string;
  reportCount?: number | null;
};

export type ShelterCommunityResponse = {
  updatedAt: string | null;
  moderationPolicy: { reportCautionThreshold: number; reportHideThreshold: number } | null;
  votesSummary: Record<string, number>;
  commentCount: number;
  hiddenCount: number;
  mostReported: number;
  commentsCollapsed: boolean;
  comments: ShelterComment[];
  lastError?: string | null;
};

export type JmaStatusFeed = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
};

export type JmaStatusResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError?: string | null;
  feeds: Record<string, JmaStatusFeed>;
};

export type JmaWarningItem = {
  id: string;
  kind: string;
  status: string | null;
  source?: string;
};

export type JmaWarningsResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  area: string;
  areaName: string | null;
  items: JmaWarningItem[];
  breakdown?: Record<string, { name: string; items: JmaWarningItem[] }>;
  muniMap?: Record<string, string>;
};

export type JmaQuakeItem = {
  id: string;
  time: string | null;
  title: string;
  link: string | null;
  maxIntensity: string | null;
  magnitude: string | null;
  epicenter: string | null;
  depthKm?: number | null;
  intensityAreas?: { intensity: string; areas: string[] }[];
};

export type JmaQuakesResponse = {
  fetchStatus: FetchStatus;
  updatedAt: string | null;
  lastError: string | null;
  items: JmaQuakeItem[];
};

export type HazardLayerTile = {
  url: string;
  scheme: string;
};

export type HazardLayer = {
  key: string;
  name: string;
  jaName: string;
  tileUrl?: string | null;
  tiles?: HazardLayerTile[] | null;
  scheme?: string | null;
  minZoom?: number | null;
  maxZoom?: number | null;
};

export type HazardLayerSource = {
  portalUrl?: string | null;
  metadataUrl?: string | null;
};

export type HazardLayersResponse = {
  fetchStatus?: FetchStatus;
  updatedAt: string | null;
  lastError?: string | null;
  version?: number;
  source?: HazardLayerSource | null;
  layers: HazardLayer[];
};

export type Prefecture = {
  prefCode: string;
  prefName: string;
};

export type Municipality = {
  muniCode: string;
  muniName: string;
};

export type PrefecturesResponse = {
  prefectures: Prefecture[];
  lastError?: string | null;
};

export type MunicipalitiesResponse = {
  municipalities: Municipality[];
  lastError?: string | null;
};
