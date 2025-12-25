import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Returns the API base URL based on platform and configuration.
 * 
 * Priority:
 * 1. app.json extra.apiBaseUrl
 * 2. Platform-specific defaults
 */
export function getApiBaseUrl(): string {
    const configured = Constants.expoConfig?.extra?.apiBaseUrl;
    if (configured && typeof configured === 'string') {
        return configured;
    }

    // Fallback defaults by platform
    if (Platform.OS === 'android') {
        // Android emulator uses 10.0.2.2 to reach host localhost
        return 'http://10.0.2.2:3000';
    }

    // iOS simulator and web can use localhost
    return 'http://localhost:3000';
}

export const API_BASE_URL = getApiBaseUrl();
