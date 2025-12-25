import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { searchShelters } from '../api/client';
import type { Shelter } from '../api/types';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { ShelterCard } from '../components/ShelterCard';
import { cacheGet, cacheSet, makeCacheKey } from '../cache/CacheManager';
import { checkAndInvalidateIfNeeded } from '../cache/DataVersion';
import { theme } from '../theme';

const HAZARD_FILTERS = [
    { key: 'flood', label: '洪水' },
    { key: 'landslide', label: '土砂' },
    { key: 'tsunami', label: '津波' },
    { key: 'earthquake', label: '地震' },
    { key: 'fire', label: '火災' },
    { key: 'storm', label: '暴風' },
];

const ITEM_HEIGHT = 100;
const DEBOUNCE_MS = 300;

const MemoizedShelterCard = React.memo(ShelterCard);

export function ListScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shelters, setShelters] = useState<Shelter[]>([]);
    const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [selectedHazards, setSelectedHazards] = useState<string[]>([]);
    const [isOffline, setIsOffline] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    const fetchData = useCallback(async (coords: { lat: number; lon: number }, hazards: string[], forceRefresh = false) => {
        const cacheKey = makeCacheKey('search', {
            lat: coords.lat.toFixed(2),
            lon: coords.lon.toFixed(2),
            hazards: hazards.sort().join(','),
        });

        if (!forceRefresh) {
            await checkAndInvalidateIfNeeded();
        }

        const cached = await cacheGet<{ shelters: Shelter[] }>(cacheKey);

        try {
            const res = await searchShelters({
                lat: coords.lat,
                lon: coords.lon,
                limit: 20,
                radiusKm: 10,
                hazardTypes: hazards,
            });
            const newShelters = res.sites || res.items || [];

            setShelters(newShelters);
            setError(null);
            setIsOffline(false);

            await cacheSet(cacheKey, { shelters: newShelters }, { isSearch: true });
        } catch (e) {
            if (cached) {
                setShelters(cached.shelters || []);
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
            await fetchData(coords, selectedHazards);
        } catch (e) {
            setError('位置情報の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [fetchData, selectedHazards]);

    useEffect(() => {
        requestLocation();
    }, []);

    const onRefresh = useCallback(async () => {
        if (!location) return;
        setRefreshing(true);
        await fetchData(location, selectedHazards, true);
        setRefreshing(false);
    }, [location, fetchData, selectedHazards]);

    const toggleHazard = useCallback((key: string) => {
        setSelectedHazards(prev => {
            const next = prev.includes(key) ? prev.filter((h) => h !== key) : [...prev, key];
            if (location) {
                // Debounce the search
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                    fetchData(location, next);
                }, DEBOUNCE_MS);
            }
            return next;
        });
    }, [location, fetchData]);

    // Filter by search query (client-side)
    const filteredShelters = useMemo(() => {
        if (!searchQuery.trim()) return shelters;
        const q = searchQuery.toLowerCase();
        return shelters.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.address && s.address.toLowerCase().includes(q))
        );
    }, [shelters, searchQuery]);

    const renderItem = useCallback(({ item }: { item: Shelter }) => (
        <MemoizedShelterCard shelter={item} />
    ), []);

    const keyExtractor = useCallback((item: Shelter) => item.id, []);

    const getItemLayout = useCallback((_: any, index: number) => ({
        length: ITEM_HEIGHT,
        offset: ITEM_HEIGHT * index,
        index,
    }), []);

    const listEmptyComponent = useMemo(() => (
        <EmptyState message="条件に合う避難場所がありません" icon="🔍" />
    ), []);

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <LoadingState message="検索中..." />
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
                <Text style={styles.title}>避難場所検索</Text>
                <Text style={styles.subtitle}>{filteredShelters.length}件</Text>
            </View>

            {isOffline && (
                <View style={styles.offlineBanner}>
                    <Text style={styles.offlineText}>📴 オフラインモード</Text>
                </View>
            )}

            <View style={styles.searchSection}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="名前・住所で絞り込み..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>

            <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>ハザード対応フィルタ</Text>
                <View style={styles.filterRow}>
                    {HAZARD_FILTERS.map((f) => (
                        <TouchableOpacity
                            key={f.key}
                            style={[styles.filterChip, selectedHazards.includes(f.key) && styles.filterChipActive]}
                            onPress={() => toggleHazard(f.key)}
                        >
                            <Text style={[styles.filterChipText, selectedHazards.includes(f.key) && styles.filterChipTextActive]}>
                                {f.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <FlatList
                data={filteredShelters}
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
                initialNumToRender={10}
            />
        </SafeAreaView>
    );
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
        ...theme.typography.h2,
        color: theme.colors.textInverse,
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textMuted,
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
    searchSection: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
    },
    searchInput: {
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.borderRadius.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        fontSize: 14,
        color: theme.colors.textPrimary,
    },
    filterSection: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    filterLabel: {
        ...theme.typography.label,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.sm,
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    filterChip: {
        backgroundColor: theme.colors.surfaceAlt,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs + 2,
        borderRadius: theme.borderRadius.full,
        marginRight: theme.spacing.sm,
        marginBottom: theme.spacing.xs,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    filterChipActive: {
        backgroundColor: theme.colors.primaryLight,
        borderColor: theme.colors.primary,
    },
    filterChipText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    filterChipTextActive: {
        color: theme.colors.primaryDark,
        fontWeight: '600',
    },
    listContent: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
    },
});
