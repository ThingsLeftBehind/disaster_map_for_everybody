// API Response Types for Mobile App

export interface HealthResponse {
    dbConnected?: boolean;
    sheltersCount?: number;
    nearbySampleCount?: number;
    fetchStatus?: string;
}

export interface Shelter {
    id: string;
    name: string;
    address: string | null;
    pref_city: string | null;
    lat: number;
    lon: number;
    hazards: Record<string, boolean>;
    is_same_address_as_shelter: boolean | null;
    notes: string | null;
    source_updated_at: string | null;
    updated_at: string;
    distanceKm?: number;
    distance?: number;
    matchesHazards?: boolean;
    missingHazards?: string[];
}

export interface NearbyResponse {
    fetchStatus: string;
    updatedAt: string | null;
    lastError: string | null;
    sites: Shelter[];
    items: Shelter[];
}

export interface SearchResponse extends NearbyResponse { }

export interface WarningItem {
    kind: string;
    status: string | null;
    source?: string;
}

export interface WarningGroup {
    key: string;
    kind: string;
    count: number;
    statuses: string[];
    priority: 'URGENT' | 'ADVISORY' | 'REFERENCE';
}

export interface WarningsResponse {
    fetchStatus: string;
    updatedAt: string | null;
    lastError: string | null;
    items: WarningItem[];
    breakdown?: Record<string, { name: string; items: WarningItem[] }>;
}

export interface UrgentItem {
    id: string;
    title: string;
    updated: string | null;
}

export interface UrgentResponse {
    items: UrgentItem[];
}

export interface QuakeItem {
    id: string;
    time: string | null;
    title: string;
    link: string | null;
    maxIntensity: string | null;
    magnitude: string | null;
    epicenter: string | null;
}

export interface QuakesResponse {
    fetchStatus: string;
    updatedAt: string | null;
    lastError: string | null;
    items: QuakeItem[];
}

export interface HazardLayer {
    key: string;
    name: string;
    jaName: string;
    tileUrl: string;
    scheme?: 'xyz' | 'tms';
    minZoom: number;
    maxZoom: number;
}

export interface HazardLayersResponse {
    fetchStatus: string;
    updatedAt: string | null;
    layers: HazardLayer[];
}

export interface Prefecture {
    prefCode: string;
    prefName: string;
}

export interface MunicipalitiesResponse {
    prefectures: Prefecture[];
}
