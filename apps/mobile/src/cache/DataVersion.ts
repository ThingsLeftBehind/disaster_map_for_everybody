import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/api';
import { cacheClearAll } from './CacheManager';

const VERSION_KEY = 'data_version';
const LAST_CHECK_KEY = 'data_version_last_check';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface VersionResponse {
    dataVersion: string;
    generatedAt: string;
    error?: string;
}

/**
 * Fetch the current data version from the server.
 */
async function fetchServerVersion(): Promise<string | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/system/version`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) return null;
        const data: VersionResponse = await response.json();
        return data.dataVersion || null;
    } catch {
        return null;
    }
}

/**
 * Get the locally stored data version.
 */
async function getStoredVersion(): Promise<string | null> {
    try {
        return await AsyncStorage.getItem(VERSION_KEY);
    } catch {
        return null;
    }
}

/**
 * Store the data version locally.
 */
async function setStoredVersion(version: string): Promise<void> {
    await AsyncStorage.setItem(VERSION_KEY, version);
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
}

/**
 * Check if we should skip the version check (rate limiting).
 */
async function shouldSkipCheck(): Promise<boolean> {
    try {
        const lastCheck = await AsyncStorage.getItem(LAST_CHECK_KEY);
        if (!lastCheck) return false;
        const elapsed = Date.now() - Number(lastCheck);
        return elapsed < CHECK_INTERVAL_MS;
    } catch {
        return false;
    }
}

/**
 * Check if data version has changed and invalidate caches if needed.
 * Returns true if caches were invalidated.
 */
export async function checkAndInvalidateIfNeeded(): Promise<boolean> {
    // Rate limit checks
    if (await shouldSkipCheck()) {
        return false;
    }

    const serverVersion = await fetchServerVersion();
    if (!serverVersion) {
        // Couldn't reach server, keep using cache
        return false;
    }

    const storedVersion = await getStoredVersion();

    if (storedVersion !== serverVersion) {
        // Version changed - invalidate all caches
        if (__DEV__) {
            console.log('[DataVersion] Version changed:', storedVersion, '->', serverVersion);
        }
        await cacheClearAll();
        await setStoredVersion(serverVersion);
        return true;
    }

    // Version unchanged, update last check time
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    return false;
}

/**
 * Force a version check ignoring rate limit.
 */
export async function forceVersionCheck(): Promise<boolean> {
    await AsyncStorage.removeItem(LAST_CHECK_KEY);
    return checkAndInvalidateIfNeeded();
}

/**
 * Get the current stored version (for display purposes).
 */
export async function getCurrentVersion(): Promise<string | null> {
    return getStoredVersion();
}
