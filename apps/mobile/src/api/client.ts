import { API_BASE_URL } from '../config/api';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Fetch wrapper with retry logic for API calls.
 */
export async function apiFetch<T>(path: string): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json() as T;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY_MS * (attempt + 1));
            }
        }
    }

    throw lastError ?? new Error('Network request failed');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// API Endpoints

import type {
    HealthResponse,
    NearbyResponse,
    SearchResponse,
    WarningsResponse,
    UrgentResponse,
    QuakesResponse,
    HazardLayersResponse,
    MunicipalitiesResponse,
} from './types';

export async function fetchHealth(): Promise<HealthResponse> {
    return apiFetch<HealthResponse>('/api/health');
}

export async function fetchNearbyShelters(params: {
    lat: number;
    lon: number;
    limit?: number;
    radiusKm?: number;
}): Promise<NearbyResponse> {
    const { lat, lon, limit = 10, radiusKm = 30 } = params;
    return apiFetch<NearbyResponse>(
        `/api/shelters/nearby?lat=${lat}&lon=${lon}&limit=${limit}&radiusKm=${radiusKm}&hideIneligible=false`
    );
}

export async function searchShelters(params: {
    lat: number;
    lon: number;
    limit?: number;
    radiusKm?: number;
    hazardTypes?: string[];
}): Promise<SearchResponse> {
    const { lat, lon, limit = 20, radiusKm = 10, hazardTypes = [] } = params;
    const hazards = hazardTypes.length > 0 ? `&hazardTypes=${hazardTypes.join(',')}` : '';
    return apiFetch<SearchResponse>(
        `/api/shelters/search?mode=LOCATION&lat=${lat}&lon=${lon}&limit=${limit}&radiusKm=${radiusKm}${hazards}&includeHazardless=true`
    );
}

export async function fetchWarnings(areaCode: string): Promise<WarningsResponse> {
    return apiFetch<WarningsResponse>(`/api/jma/warnings?area=${areaCode}`);
}

export async function fetchUrgent(): Promise<UrgentResponse> {
    return apiFetch<UrgentResponse>('/api/jma/urgent');
}

export async function fetchQuakes(): Promise<QuakesResponse> {
    return apiFetch<QuakesResponse>('/api/jma/quakes');
}

export async function fetchHazardLayers(): Promise<HazardLayersResponse> {
    return apiFetch<HazardLayersResponse>('/api/gsi/hazard-layers');
}

export async function fetchMunicipalities(): Promise<MunicipalitiesResponse> {
    return apiFetch<MunicipalitiesResponse>('/api/ref/municipalities');
}
