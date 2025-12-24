export const SAVED_SHELTERS_KEY = 'jp_evac_device_state_v1';
export const SAVED_SHELTERS_EVENT = 'jp-evac:saved-shelters-changed';

export type SiteSummary = {
    id: string;
    [key: string]: any;
};

function readFullState(): any {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(SAVED_SHELTERS_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function writeFullState(state: any) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(SAVED_SHELTERS_KEY, JSON.stringify(state));
        window.dispatchEvent(new Event(SAVED_SHELTERS_EVENT));
    } catch {
        // ignore
    }
}

export function loadSavedShelters(): string[] {
    const state = readFullState();
    return Array.isArray(state?.favorites?.shelterIds) ? state.favorites.shelterIds : [];
}

export function addSavedShelters(sites: SiteSummary[], max = 5): { added: number; total: number } {
    const state = readFullState();
    const currentIds: string[] = Array.isArray(state?.favorites?.shelterIds) ? state.favorites.shelterIds : [];

    // We want to add new items.
    // Strategy: Prepend new items. If item already exists, remove old instance (move to top).
    const incomingIds = sites.map(s => s.id).filter(Boolean);
    if (incomingIds.length === 0) return { added: 0, total: currentIds.length };

    const idSet = new Set(currentIds);
    let addedCount = 0;

    // Identify strictly new items
    for (const id of incomingIds) {
        if (!idSet.has(id)) {
            addedCount++;
        }
    }

    // Combine: Incoming (newest) + Old (unaffected)
    // Use Set to dedupe, but we want to prioritize incoming at the start.
    // [...incoming, ...current] passed to Set will keep incoming order and drop duplicates from current.
    const combined = Array.from(new Set([...incomingIds, ...currentIds]));

    const capped = combined.slice(0, max);

    const nextState = {
        ...state,
        favorites: {
            ...state.favorites,
            shelterIds: capped,
        },
        updatedAt: new Date().toISOString(),
    };

    writeFullState(nextState);
    return { added: addedCount, total: capped.length };
}

export function removeSavedShelter(id: string) {
    const state = readFullState();
    const currentIds: string[] = Array.isArray(state?.favorites?.shelterIds) ? state.favorites.shelterIds : [];
    if (!currentIds.includes(id)) return;

    const nextIds = currentIds.filter(x => x !== id);
    const nextState = {
        ...state,
        favorites: {
            ...state.favorites,
            shelterIds: nextIds,
        },
        updatedAt: new Date().toISOString(),
    };
    writeFullState(nextState);
}

export function subscribeSavedShelters(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => { };
    const handler = () => cb();
    window.addEventListener(SAVED_SHELTERS_EVENT, handler);
    return () => window.removeEventListener(SAVED_SHELTERS_EVENT, handler);
}
