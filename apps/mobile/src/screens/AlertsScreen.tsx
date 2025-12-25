import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { fetchWarnings, fetchMunicipalities } from '../api/client';
import type { WarningsResponse, Prefecture } from '../api/types';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { AlertChip } from '../components/AlertChip';

// Tokyo island municipality codes (5-digit)
const TOKYO_ISLAND_MUNI_CODES = new Set([
    '13361', '13362', '13363', '13364', '13381', '13382', '13401', '13402', '13421',
]);

function isTokyoIslandMuni(muniCode: string | null): boolean {
    if (!muniCode) return false;
    const code5 = muniCode.length === 6 ? muniCode.slice(0, 5) : muniCode;
    return TOKYO_ISLAND_MUNI_CODES.has(code5);
}

function isIslandAreaName(name: string): boolean {
    return name.includes('伊豆諸島') || name.includes('小笠原');
}

export function AlertsScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<WarningsResponse | null>(null);
    const [prefectures, setPrefectures] = useState<Prefecture[]>([]);
    const [selectedPref, setSelectedPref] = useState<string>('13'); // Default Tokyo
    const [currentMuniCode, setCurrentMuniCode] = useState<string | null>(null);

    const fetchData = useCallback(async (prefCode: string) => {
        try {
            const areaCode = `${prefCode}0000`;
            const res = await fetchWarnings(areaCode);
            setWarnings(res);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'データ取得エラー');
        }
    }, []);

    const init = useCallback(async () => {
        try {
            const [prefRes] = await Promise.all([
                fetchMunicipalities(),
            ]);
            setPrefectures(prefRes.prefectures || []);

            // Try to get current location for auto-selecting prefecture
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
                    // For simplicity, we'll just use Tokyo. In production, reverse geocode to get prefCode.
                    // This matches the web behavior of defaulting to current location.
                }
            } catch {
                // Ignore location errors
            }

            await fetchData(selectedPref);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'データ取得エラー');
        } finally {
            setLoading(false);
        }
    }, [fetchData, selectedPref]);

    useEffect(() => {
        init();
    }, []);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchData(selectedPref);
        setRefreshing(false);
    }, [selectedPref, fetchData]);

    const onPrefChange = (prefCode: string) => {
        setSelectedPref(prefCode);
        setLoading(true);
        fetchData(prefCode).finally(() => setLoading(false));
    };

    // Tokyo scope logic (matching web)
    const isTokyoArea = selectedPref === '13';
    const tokyoScope: 'mainland' | 'islands' = isTokyoArea && isTokyoIslandMuni(currentMuniCode) ? 'islands' : 'mainland';

    // Filter breakdown by Tokyo scope
    const activeAreas = useMemo(() => {
        const breakdown = warnings?.breakdown;
        if (!breakdown) return [];

        return Object.entries(breakdown)
            .filter(([, data]) => {
                if (!isTokyoArea) return true;
                const isIsland = isIslandAreaName(data.name);
                if (tokyoScope === 'mainland' && isIsland) return false;
                if (tokyoScope === 'islands' && !isIsland) return false;
                return true;
            })
            .map(([code, data]) => {
                const activeItems = data.items.filter((i: any) => {
                    const s = i.status || '';
                    return !s.includes('解除') && !s.includes('なし');
                });
                return { code, name: data.name, items: activeItems };
            })
            .filter((area) => area.items.length > 0)
            .sort((a, b) => b.items.length - a.items.length);
    }, [warnings, isTokyoArea, tokyoScope]);

    // Count warnings
    const counts = useMemo(() => {
        let urgent = 0;
        let advisory = 0;
        for (const area of activeAreas) {
            for (const item of area.items) {
                const kind = item.kind || '';
                if (kind.includes('警報') && !kind.includes('注意報')) {
                    urgent++;
                } else if (kind.includes('注意報')) {
                    advisory++;
                }
            }
        }
        return { urgent, advisory, total: urgent + advisory };
    }, [activeAreas]);

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <LoadingState message="警報情報を取得中..." />
            </SafeAreaView>
        );
    }

    if (error && !warnings) {
        return (
            <SafeAreaView style={styles.container}>
                <ErrorState message={error} onRetry={() => init()} />
            </SafeAreaView>
        );
    }

    const selectedPrefName = prefectures.find((p) => p.prefCode === selectedPref)?.prefName || '不明';

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>警報・注意報</Text>
                <View style={styles.countRow}>
                    <View style={[styles.countBadge, counts.urgent > 0 && styles.urgentBadge]}>
                        <Text style={[styles.countText, counts.urgent > 0 && styles.urgentText]}>警報 {counts.urgent}</Text>
                    </View>
                    <View style={[styles.countBadge, counts.advisory > 0 && styles.advisoryBadge]}>
                        <Text style={[styles.countText, counts.advisory > 0 && styles.advisoryText]}>注意報 {counts.advisory}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.prefSelector}>
                <Text style={styles.prefLabel}>対象: {selectedPrefName}</Text>
                {isTokyoArea && (
                    <Text style={styles.tokyoScope}>
                        {tokyoScope === 'mainland' ? '東京都' : '東京都（島しょ）'}
                    </Text>
                )}
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {activeAreas.length === 0 ? (
                    <View style={styles.emptySection}>
                        <Text style={styles.emptyIcon}>✅</Text>
                        <Text style={styles.emptyText}>現在、発表中の警報・注意報はありません</Text>
                    </View>
                ) : (
                    activeAreas.map((area) => (
                        <View key={area.code} style={styles.areaCard}>
                            <Text style={styles.areaName}>{area.name}</Text>
                            <View style={styles.chipRow}>
                                {area.items.slice(0, 5).map((item: any, idx: number) => (
                                    <AlertChip
                                        key={`${area.code}-${idx}`}
                                        kind={item.kind}
                                        status={item.status}
                                        variant={item.kind.includes('警報') && !item.kind.includes('注意報') ? 'urgent' : 'advisory'}
                                    />
                                ))}
                            </View>
                        </View>
                    ))
                )}

                <View style={styles.noteCard}>
                    <Text style={styles.noteTitle}>行動の目安</Text>
                    <Text style={styles.noteText}>• 注意報: 災害が起こるおそれがあります</Text>
                    <Text style={styles.noteText}>• 警報: 重大な災害が起こるおそれがあります</Text>
                    <Text style={styles.noteText}>• 特別警報: 直ちに命を守る行動をとってください</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#1e293b',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    countRow: {
        flexDirection: 'row',
        marginTop: 8,
        gap: 8,
    },
    countBadge: {
        backgroundColor: '#334155',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    urgentBadge: {
        backgroundColor: '#fef2f2',
    },
    advisoryBadge: {
        backgroundColor: '#fef3c7',
    },
    countText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#94a3b8',
    },
    urgentText: {
        color: '#991b1b',
    },
    advisoryText: {
        color: '#92400e',
    },
    prefSelector: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
    },
    prefLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1e293b',
    },
    tokyoScope: {
        fontSize: 12,
        color: '#64748b',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    emptySection: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 12,
    },
    emptyText: {
        fontSize: 14,
        color: '#64748b',
    },
    areaCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    areaName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1e293b',
        marginBottom: 8,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    noteCard: {
        backgroundColor: '#f1f5f9',
        borderRadius: 12,
        padding: 12,
        marginTop: 8,
    },
    noteTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#1e293b',
        marginBottom: 6,
    },
    noteText: {
        fontSize: 12,
        color: '#475569',
        marginTop: 2,
    },
});
