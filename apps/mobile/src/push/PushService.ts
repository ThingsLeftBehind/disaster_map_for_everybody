import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/api';

const PUSH_TOKEN_KEY = 'push_token';
const SUBSCRIBED_CELLS_KEY = 'subscribed_cells';
const MAX_SUBSCRIPTIONS = 12;

// Configure notification handling
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

/**
 * Request notification permissions and get push token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
    if (!Device.isDevice) {
        console.log('[Push] Must use physical device for push notifications');
        return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('[Push] Permission not granted');
        return null;
    }

    try {
        const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: 'your-project-id', // Replace with actual Expo project ID
        });
        const token = tokenData.data;

        // Save locally
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

        // Register with server
        const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'expo';
        await registerTokenWithServer(token, platform);

        return token;
    } catch (error) {
        console.error('[Push] Failed to get push token:', error);
        return null;
    }
}

/**
 * Register push token with server.
 */
async function registerTokenWithServer(pushToken: string, platform: string): Promise<void> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/push/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pushToken, platform }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('[Push] Server registration failed:', error);
        }
    } catch (error) {
        console.error('[Push] Failed to register with server:', error);
    }
}

/**
 * Get the stored push token.
 */
export async function getStoredPushToken(): Promise<string | null> {
    return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Get currently subscribed cell IDs.
 */
export async function getSubscribedCells(): Promise<string[]> {
    try {
        const raw = await AsyncStorage.getItem(SUBSCRIBED_CELLS_KEY);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch {
        // Ignore parse errors
    }
    return [];
}

/**
 * Subscribe to cell IDs (max 12, replaces existing).
 */
export async function subscribeToCells(cellIds: string[]): Promise<boolean> {
    const pushToken = await getStoredPushToken();
    if (!pushToken) {
        console.log('[Push] No push token, cannot subscribe');
        return false;
    }

    // Limit to max subscriptions
    const limitedCells = cellIds.slice(0, MAX_SUBSCRIPTIONS);

    try {
        const response = await fetch(`${API_BASE_URL}/api/push/subscriptions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pushToken, cellIds: limitedCells }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('[Push] Subscription update failed:', error);
            return false;
        }

        // Save locally
        await AsyncStorage.setItem(SUBSCRIBED_CELLS_KEY, JSON.stringify(limitedCells));
        return true;
    } catch (error) {
        console.error('[Push] Failed to update subscriptions:', error);
        return false;
    }
}

/**
 * Add a cell ID to subscriptions.
 */
export async function addCellSubscription(cellId: string): Promise<boolean> {
    const current = await getSubscribedCells();
    if (current.includes(cellId)) {
        return true; // Already subscribed
    }
    if (current.length >= MAX_SUBSCRIPTIONS) {
        return false; // At limit
    }
    return subscribeToCells([...current, cellId]);
}

/**
 * Remove a cell ID from subscriptions.
 */
export async function removeCellSubscription(cellId: string): Promise<boolean> {
    const current = await getSubscribedCells();
    if (!current.includes(cellId)) {
        return true; // Not subscribed
    }
    return subscribeToCells(current.filter((id) => id !== cellId));
}

/**
 * Convert prefecture code to JMA area code.
 */
export function prefCodeToCellId(prefCode: string): string {
    // JMA area codes are prefCode + "0000"
    return `${prefCode.padStart(2, '0')}0000`;
}

/**
 * Setup notification listeners.
 */
export function setupNotificationListeners(
    onNotificationReceived?: (notification: Notifications.Notification) => void,
    onNotificationResponse?: (response: Notifications.NotificationResponse) => void
): () => void {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
        onNotificationReceived?.(notification);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        onNotificationResponse?.(response);
    });

    return () => {
        receivedSubscription.remove();
        responseSubscription.remove();
    };
}
