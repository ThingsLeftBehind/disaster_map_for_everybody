
const LS_SAVED_SHELTERS_KEY = 'jp_evac_v1_saved_shelters';

export type SavedShelter = {
    id: string;
    name: string;
    address: string | null;
    pref_city: string | null;
    lat: number;
    lon: number;
    hazards: any;
    notes?: string | null;
    updatedAt: string;
    // Fields for NearbySite compatibility
    is_same_address_as_shelter: boolean;
    source_updated_at: string | null;
    updated_at: string;
};

export function getAllSavedShelters(): SavedShelter[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(LS_SAVED_SHELTERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as SavedShelter[];
        return [];
    } catch {
        return [];
    }
}

export function getShelterFromStorage(id: string): SavedShelter | null {
    const all = getAllSavedShelters();
    return all.find((s) => s.id === id) ?? null;
}

export function saveShelterToStorage(shelter: SavedShelter) {
    if (typeof window === 'undefined') return;
    const all = getAllSavedShelters();
    const next = [shelter, ...all.filter((s) => s.id !== shelter.id)].slice(0, 50); // Limit to 50 locally
    localStorage.setItem(LS_SAVED_SHELTERS_KEY, JSON.stringify(next));
}

export function removeShelterFromStorage(id: string) {
    if (typeof window === 'undefined') return;
    const all = getAllSavedShelters();
    const next = all.filter((s) => s.id !== id);
    localStorage.setItem(LS_SAVED_SHELTERS_KEY, JSON.stringify(next));
}
