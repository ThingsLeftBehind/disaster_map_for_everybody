import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { fetchNearbyShelters, fetchUrgent } from '../api/client';
import type { Shelter, UrgentItem } from '../api/types';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { ShelterCard } from '../components/ShelterCard';
import { cacheGet, cacheSet, makeCacheKey } from '../cache/CacheManager';
import { checkAndInvalidateIfNeeded } from '../cache/DataVersion';
import { theme } from '../theme';

const ITEM_HEIGHT = 100; // Approximate height for getItemLayout

// Memoized shelter card to prevent re-renders
const MemoizedShelterCard = React.memo(ShelterCard);

export function MainScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shelters, setShelters] = useState<Shelter[]>([]);
    const [urgentItems, setUrgentItems] = useState<UrgentItem[]>([]);
    const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [isOffline, setIsOffline] = useState(false);

    const fetchData = useCallback(async (coords: { lat: number; lon: number }, forceRefresh = false) => {
        const cacheKey = makeCacheKey('nearby', { lat: coords.lat.toFixed(2), lon: coords.lon.toFixed(2) });

        if (!forceRefresh) {
            await checkAndInvalidateIfNeeded();
        }

        const cached = await cacheGet<{ shelters: Shelter[]; urgentItems: UrgentItem[] }>(cacheKey);

        try {
            const [nearbyRes, urgentRes] = await Promise.all([
                fetchNearbyShelters({ lat: coords.lat, lon: coords.lon, limit: 5, radiusKm: 30 }),
                fetchUrgent(),
            ]);
            const newShelters = nearbyRes.sites || nearbyRes.items || [];
            const newUrgent = urgentRes.items || [];

            setShelters(newShelters);
            setUrgentItems(newUrgent);
            setError(null);
            setIsOffline(false);

            await cacheSet(cacheKey, { shelters: newShelters, urgentItems: newUrgent }, { pinned: true });
        } catch (e) {
            if (cached) {
                setShelters(cached.shelters || []);
                setUrgentItems(cached.urgentItems || []);
                setIsOffline(true);
                setError(null);
            } else {
                setError(e instanceof Error ? e.message : 'データ取得エラー');
            }
        }
    }, []);

    const requestLocation = useCallback(async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setError('位置情報の許可が必要です');
                setLoading(false);
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const coords = { lat: loc.coords.latitude, lon: loc.coords.longitude };
            setLocation(coords);
            await fetchData(coords);
        } catch (e) {
            setError('位置情報の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [fetchData]);

    useEffect(() => {
        requestLocation();
    }, [requestLocation]);

    const onRefresh = useCallback(async () => {
        if (!location) return;
        setRefreshing(true);
        await fetchData(location, true);
        setRefreshing(false);
    }, [location, fetchData]);

    const openShelterDetail = useCallback((shelter: Shelter) => {
        Alert.alert(
            shelter.name,
            `住所: ${shelter.address || shelter.pref_city || '不明'}\n距離: ${formatDistance(shelter.distanceKm)}`,
            [
                { text: '閉じる', style: 'cancel' },
                {
                    text: 'Google Maps',
                    onPress: () => {
                        const url = `https://www.google.com/maps/dir/?api=1&destination=${shelter.lat},${shelter.lon}&travelmode=walking`;
                        Linking.openURL(url);
                    }
                },
            ]
        );
    }, []);

    const renderItem = useCallback(({ item }: { item: Shelter }) => (
        <MemoizedShelterCard shelter={item} onPress={() => openShelterDetail(item)} />
    ), [openShelterDetail]);

    const keyExtractor = useCallback((item: Shelter) => item.id, []);

    const getItemLayout = useCallback((_: any, index: number) => ({
        length: ITEM_HEIGHT,
        offset: ITEM_HEIGHT * index,
        index,
    }), []);

    const listEmptyComponent = useMemo(() => (
        <EmptyState message="近くに避難場所が見つかりませんでした" icon="🗺️" />
    ), []);

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <LoadingState message="現在地を取得中..." />
            </SafeAreaView>
        );
    }

    if (error && shelters.length === 0) {
        return (
            <SafeAreaView style={styles.container}>
                <ErrorState message={error} onRetry={requestLocation} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>🏠 避難ナビ</Text>
                <TouchableOpacity style={styles.refreshBtn} onPress={requestLocation}>
                    <Text style={styles.refreshBtnText}>📍 現在地</Text>
                </TouchableOpacity>
            </View>

            {isOffline && (
                <View style={styles.offlineBanner}>
                    <Text style={styles.offlineText}>📴 オフラインモード（キャッシュを表示中）</Text>
                </View>
            )}

            {urgentItems.length > 0 && (
                <View style={styles.urgentBanner}>
                    <Text style={styles.urgentTitle}>⚠️ 重大な警報</Text>
                    {urgentItems.slice(0, 2).map((item) => (
                        <Text key={item.id} style={styles.urgentText} numberOfLines={1}>
                            {item.title}
                        </Text>
                    ))}
                </View>
            )}

            <Text style={styles.sectionTitle}>近くの避難場所</Text>

            <FlatList
                data={shelters}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                getItemLayout={getItemLayout}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={listEmptyComponent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
                removeClippedSubviews={true}
                maxToRenderPerBatch={10}
                windowSize={5}
                initialNumToRender={5}
            />
        </SafeAreaView>
    );
}

function formatDistance(km: number | undefined): string {
    if (typeof km !== 'number' || !Number.isFinite(km)) return '不明';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.colors.navBackground,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.textInverse,
    },
    refreshBtn: {
        backgroundColor: theme.colors.primary,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
    },
    refreshBtnText: {
        color: theme.colors.textInverse,
        fontSize: 13,
        fontWeight: '600',
    },
    offlineBanner: {
        backgroundColor: theme.colors.advisoryBg,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
    },
    offlineText: {
        fontSize: 12,
        color: theme.colors.advisoryText,
        textAlign: 'center',
    },
    urgentBanner: {
        backgroundColor: theme.colors.urgentBg,
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.urgentBorder,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        marginHorizontal: theme.spacing.lg,
        marginTop: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
    },
    urgentTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: theme.colors.urgentText,
        marginBottom: 4,
    },
    urgentText: {
        fontSize: 12,
        color: '#b91c1c',
        marginTop: 2,
    },
    sectionTitle: {
        ...theme.typography.h3,
        color: theme.colors.textPrimary,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
    },
    listContent: {
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
    },
});
