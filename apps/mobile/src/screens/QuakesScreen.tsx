import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Linking, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchQuakes } from '../api/client';
import type { QuakeItem } from '../api/types';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

function normalizeFullWidthDigits(input: string): string {
    return input.replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
}

function parseMaxIntensity(raw: string | null, title: string): { label: string; score: number } | null {
    const source = raw || title;
    const t = normalizeFullWidthDigits(source);
    const m = t.match(/最大震度\s*([0-7])\s*([+\-]|弱|強)?/) || t.match(/([0-7])\s*([+\-]|弱|強)?/);
    if (!m) return null;

    const base = Number(m[1]);
    if (!Number.isFinite(base)) return null;

    const mod = (m[2] ?? '').trim();
    if (!mod) return { label: String(base), score: base };
    if (mod === '-' || mod === '弱') return { label: `${base}弱`, score: base };
    if (mod === '+' || mod === '強') return { label: `${base}強`, score: base + 0.5 };
    return { label: `${base}${mod}`, score: base };
}

function severityTone(score: number | null): 'red' | 'yellow' | 'blue' | 'neutral' {
    if (score === null) return 'neutral';
    if (score >= 6) return 'red';
    if (score >= 5) return 'yellow';
    if (score >= 4) return 'blue';
    return 'neutral';
}

function toneStyle(tone: ReturnType<typeof severityTone>) {
    switch (tone) {
        case 'red': return styles.toneRed;
        case 'yellow': return styles.toneYellow;
        case 'blue': return styles.toneBlue;
        default: return styles.toneNeutral;
    }
}

function formatEventTime(time: string | null): string {
    if (!time) return '不明';
    const t = Date.parse(time);
    if (Number.isNaN(t)) return normalizeFullWidthDigits(time) || '不明';
    return new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function QuakesScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [quakes, setQuakes] = useState<QuakeItem[]>([]);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetchQuakes();
            setQuakes(res.items || []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'データ取得エラー');
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

    // Filter and dedupe quakes (matching web logic)
    const filteredQuakes = useMemo(() => {
        const allowed = ['震源・震度情報', '顕著な地震の震源要素更新'];
        const filtered = quakes.filter((q) =>
            allowed.some((a) => (q.title || '').includes(a))
        );
        // Dedupe by id
        const unique = Array.from(new Map(filtered.map((q) => [q.id, q])).values());
        return unique;
    }, [quakes]);

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <LoadingState message="地震情報を取得中..." />
            </SafeAreaView>
        );
    }

    if (error && quakes.length === 0) {
        return (
            <SafeAreaView style={styles.container}>
                <ErrorState message={error} onRetry={fetchData} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>地震情報</Text>
                <TouchableOpacity
                    style={styles.externalLink}
                    onPress={() => Linking.openURL('http://www.kmoni.bosai.go.jp/')}
                >
                    <Text style={styles.externalLinkText}>リアルタイムモニタ →</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={filteredQuakes}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                    const intensity = parseMaxIntensity(item.maxIntensity, item.title);
                    const tone = severityTone(intensity?.score ?? null);

                    return (
                        <TouchableOpacity
                            style={[styles.quakeCard, toneStyle(tone)]}
                            onPress={() => item.link && Linking.openURL(item.link)}
                            disabled={!item.link}
                        >
                            <View style={styles.quakeHeader}>
                                <Text style={styles.quakeIntensity}>
                                    震度 {intensity?.label ?? '不明'}
                                </Text>
                                <Text style={styles.quakeTime}>{formatEventTime(item.time)}</Text>
                            </View>
                            <Text style={styles.quakeEpicenter} numberOfLines={1}>
                                {item.epicenter || item.title}
                            </Text>
                            <View style={styles.quakeDetails}>
                                <Text style={styles.quakeDetail}>M{item.magnitude || '?'}</Text>
                                {item.link && <Text style={styles.quakeLink}>詳細を見る →</Text>}
                            </View>
                        </TouchableOpacity>
                    );
                }}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<EmptyState message="最近の地震情報はありません" icon="🌏" />}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            />
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
    externalLink: {
        backgroundColor: '#334155',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    externalLinkText: {
        fontSize: 11,
        color: '#94a3b8',
    },
    listContent: {
        padding: 16,
    },
    quakeCard: {
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
    },
    quakeHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    quakeIntensity: {
        fontSize: 15,
        fontWeight: '700',
    },
    quakeTime: {
        fontSize: 11,
        color: '#64748b',
    },
    quakeEpicenter: {
        marginTop: 6,
        fontSize: 13,
        fontWeight: '500',
        color: '#1e293b',
    },
    quakeDetails: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    quakeDetail: {
        fontSize: 12,
        color: '#64748b',
    },
    quakeLink: {
        fontSize: 11,
        color: '#3b82f6',
    },
    toneRed: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
    },
    toneYellow: {
        backgroundColor: '#fefce8',
        borderColor: '#fde047',
    },
    toneBlue: {
        backgroundColor: '#eff6ff',
        borderColor: '#bfdbfe',
    },
    toneNeutral: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
    },
});
