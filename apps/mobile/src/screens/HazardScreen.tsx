import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchHazardLayers } from '../api/client';
import type { HazardLayer } from '../api/types';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

const FALLBACK_LAYERS: HazardLayer[] = [
    { key: 'flood', name: 'Flood', jaName: '洪水', tileUrl: '', minZoom: 10, maxZoom: 17 },
    { key: 'landslide', name: 'Landslide', jaName: '土砂災害', tileUrl: '', minZoom: 10, maxZoom: 17 },
    { key: 'tsunami', name: 'Tsunami', jaName: '津波', tileUrl: '', minZoom: 10, maxZoom: 17 },
    { key: 'liquefaction', name: 'Liquefaction', jaName: '液状化', tileUrl: '', minZoom: 10, maxZoom: 16 },
];

const LAYER_INFO: Record<string, { description: string; colorGuide: string }> = {
    flood: {
        description: '洪水浸水想定区域（L2想定最大）を表示します。',
        colorGuide: '濃い青/紫ほど浸水深が大きい（危険）を示します。',
    },
    landslide: {
        description: '土砂災害警戒区域（土石流・急傾斜地・地すべり）を表示します。',
        colorGuide: '赤色/黄色が警戒区域・特別警戒区域を示します。',
    },
    tsunami: {
        description: '津波浸水想定区域を表示します。',
        colorGuide: '濃い色ほど浸水深が大きい（危険）を示します。',
    },
    liquefaction: {
        description: '液状化危険度（2012年版）を表示します。',
        colorGuide: '赤/オレンジは液状化リスクが高い地域を示します。',
    },
};

export function HazardScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [layers, setLayers] = useState<HazardLayer[]>(FALLBACK_LAYERS);
    const [enabled, setEnabled] = useState<Record<string, boolean>>({});

    const fetchData = useCallback(async () => {
        try {
            const res = await fetchHazardLayers();
            if (res.layers && res.layers.length > 0) {
                setLayers(res.layers);
            }
            setError(null);
        } catch (e) {
            // Use fallback layers, don't show error
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchData();
        setRefreshing(false);
    }, [fetchData]);

    const toggleLayer = (key: string, value: boolean) => {
        setEnabled((prev) => ({ ...prev, [key]: value }));
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <LoadingState message="レイヤー情報を取得中..." />
            </SafeAreaView>
        );
    }

    if (error && layers.length === 0) {
        return (
            <SafeAreaView style={styles.container}>
                <ErrorState message={error} onRetry={fetchData} />
            </SafeAreaView>
        );
    }

    const enabledCount = Object.values(enabled).filter(Boolean).length;

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>ハザードマップ</Text>
                <Text style={styles.subtitle}>ON: {enabledCount}</Text>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>📌 重要</Text>
                    <Text style={styles.noticeText}>
                        レイヤーはデフォルトOFFです。地図表示はモバイル版では現在未対応です。将来のアップデートで追加予定です。
                    </Text>
                </View>

                <Text style={styles.sectionTitle}>レイヤー選択</Text>

                {layers.map((layer) => {
                    const info = LAYER_INFO[layer.key];
                    const isEnabled = enabled[layer.key] || false;

                    return (
                        <View key={layer.key} style={styles.layerCard}>
                            <View style={styles.layerHeader}>
                                <Text style={styles.layerName}>{layer.jaName}</Text>
                                <Switch
                                    value={isEnabled}
                                    onValueChange={(value) => toggleLayer(layer.key, value)}
                                    trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                                    thumbColor={isEnabled ? '#3b82f6' : '#f4f4f5'}
                                />
                            </View>

                            {/* Always-visible notes (per requirement) */}
                            {info && (
                                <View style={styles.layerInfo}>
                                    <Text style={styles.infoDescription}>{info.description}</Text>
                                    <Text style={styles.infoColorGuide}>{info.colorGuide}</Text>
                                </View>
                            )}
                        </View>
                    );
                })}

                <View style={styles.disclaimer}>
                    <Text style={styles.disclaimerTitle}>注意事項</Text>
                    <Text style={styles.disclaimerText}>
                        • 濃い色/強い色ほど危険度が高いことを示します{'\n'}
                        • 透明/空白部分はデータなし・範囲外・極低リスクの場合があります{'\n'}
                        • ハザードマップは参考情報です。公式情報も必ず確認してください
                    </Text>
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#1e293b',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    subtitle: {
        fontSize: 13,
        color: '#94a3b8',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    notice: {
        backgroundColor: '#fef3c7',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        borderLeftWidth: 4,
        borderLeftColor: '#f59e0b',
    },
    noticeTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#92400e',
        marginBottom: 4,
    },
    noticeText: {
        fontSize: 12,
        color: '#78350f',
        lineHeight: 18,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748b',
        marginBottom: 12,
    },
    layerCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    layerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    layerName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1e293b',
    },
    layerInfo: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
    },
    infoDescription: {
        fontSize: 12,
        color: '#475569',
        marginBottom: 4,
    },
    infoColorGuide: {
        fontSize: 11,
        color: '#64748b',
        fontStyle: 'italic',
    },
    disclaimer: {
        backgroundColor: '#f1f5f9',
        borderRadius: 12,
        padding: 12,
        marginTop: 8,
    },
    disclaimerTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
        marginBottom: 6,
    },
    disclaimerText: {
        fontSize: 11,
        color: '#64748b',
        lineHeight: 18,
    },
});
