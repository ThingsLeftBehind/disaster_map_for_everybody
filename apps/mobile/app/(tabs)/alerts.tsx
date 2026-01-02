import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, Modal, FlatList, TextInput } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Location from 'expo-location';

import { fetchJson } from '@/src/api/client';
import type { JmaWarningsResponse } from '@/src/api/types';
import { buildWarningsViewModel } from '@/src/features/warnings/transform';
import { type TokyoMode } from '@/src/features/warnings/tokyoRouting';
import { JmaAreaMapper, type JmaAreaResult } from '@/src/features/warnings/areaMapping';
import { LEVEL_COLORS } from '@/src/features/warnings/constants';
import { TabScreen } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';

import munisData from '@/src/data/municipalities.json';

// Types
type Municipality = {
    muniCode: string;
    muniName: string;
};

type AreaSelection = {
    prefCode: string;
    prefName: string;
    muniCode: string | null;
    muniName: string | null;
    jmaAreaCode: string | null;
    jmaAreaName: string | null;
};

type LatLng = {
    lat: number;
    lon: number;
};

// Typed JSON data
const ALL_MUNICIPALITIES: Municipality[] = munisData as Municipality[];

const PREFECTURES = [
    { code: '01', name: '北海道' }, { code: '02', name: '青森県' }, { code: '03', name: '岩手県' },
    { code: '04', name: '宮城県' }, { code: '05', name: '秋田県' }, { code: '06', name: '山形県' },
    { code: '07', name: '福島県' }, { code: '08', name: '茨城県' }, { code: '09', name: '栃木県' },
    { code: '10', name: '群馬県' }, { code: '11', name: '埼玉県' }, { code: '12', name: '千葉県' },
    { code: '13', name: '東京都' }, { code: '14', name: '神奈川県' }, { code: '15', name: '新潟県' },
    { code: '16', name: '富山県' }, { code: '17', name: '石川県' }, { code: '18', name: '福井県' },
    { code: '19', name: '山梨県' }, { code: '20', name: '長野県' }, { code: '21', name: '岐阜県' },
    { code: '22', name: '静岡県' }, { code: '23', name: '愛知県' }, { code: '24', name: '三重県' },
    { code: '25', name: '滋賀県' }, { code: '26', name: '京都府' }, { code: '27', name: '大阪府' },
    { code: '28', name: '兵庫県' }, { code: '29', name: '奈良県' }, { code: '30', name: '和歌山県' },
    { code: '31', name: '鳥取県' }, { code: '32', name: '島根県' }, { code: '33', name: '岡山県' },
    { code: '34', name: '広島県' }, { code: '35', name: '山口県' }, { code: '36', name: '徳島県' },
    { code: '37', name: '香川県' }, { code: '38', name: '愛媛県' }, { code: '39', name: '高知県' },
    { code: '40', name: '福岡県' }, { code: '41', name: '佐賀県' }, { code: '42', name: '長崎県' },
    { code: '43', name: '熊本県' }, { code: '44', name: '大分県' }, { code: '45', name: '宮崎県' },
    { code: '46', name: '鹿児島県' }, { code: '47', name: '沖縄県' },
];

const PREF_BY_CODE = new Map(PREFECTURES.map((pref) => [pref.code, pref.name]));
const MUNICIPALITY_BY_CODE = new Map(ALL_MUNICIPALITIES.map((muni) => [muni.muniCode, muni.muniName]));

export default function AlertsScreen() {
    const styles = useThemedStyles(createStyles);

    // State
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<JmaWarningsResponse | null>(null);
    const [referenceData, setReferenceData] = useState<JmaWarningsResponse[]>([]);

    // Area Selection
    const [currentLocation, setCurrentLocation] = useState<AreaSelection | null>(null);
    const [manualArea, setManualArea] = useState<AreaSelection | null>(null);

    const [selectorVisible, setSelectorVisible] = useState(false);

    // Target Area Resolution
    const resolvedArea = useMemo<JmaAreaResult>(() => {
        // Use manual area if selected, otherwise current location
        const code = manualArea?.muniCode ?? currentLocation?.muniCode ?? null;
        // Default to Tokyo if nothing
        if (!code) {
            return {
                officeCode: '130000',
                officeName: '東京都',
                class10Code: '130010', // Tokyo Area default
                class10Name: '東京地方',
                class20Code: null,
                class20Name: null,
            };
        }
        return JmaAreaMapper.resolve(code);
    }, [manualArea?.muniCode, currentLocation?.muniCode]);

    const apiAreaCode = resolvedArea.officeCode ?? '130000';

    // Derived Tokyo Mode for UI compat (can be refined later or derived from class10)
    const tokyoMode: TokyoMode = useMemo(() => {
        if (resolvedArea.officeCode !== '130000') return 'OTHER';
        if (resolvedArea.class10Code === '130010') return 'MAINLAND';
        if (['130020', '130030', '130040'].includes(resolvedArea.class10Code ?? '')) return 'ISLANDS';
        return 'MAINLAND';
    }, [resolvedArea.officeCode, resolvedArea.class10Code]);

    // Strictly normalize class20 code according to rules:
    // 1) 7 digits: return as is.
    // 2) 6 digits: drop check digit -> 5 digits, append "00".
    // 3) 5 digits: append "00".
    // 4) Otherwise: null.
    const safeNormalizeClass20 = (code: string | null | undefined): string | null => {
        if (!code) return null;
        if (code.length === 7) return code;
        if (code.length === 6) return `${code.slice(0, 5)}00`;
        if (code.length === 5) return `${code}00`;
        return null;
    };

    const rawClass20 = resolvedArea.class20Code ?? manualArea?.muniCode ?? currentLocation?.muniCode ?? null;
    const normalizedClass20 = safeNormalizeClass20(rawClass20);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Build query string with class20 for municipality-level filtering
            let url = `/api/jma/warnings?area=${apiAreaCode}`;
            if (normalizedClass20) {
                url += `&class20=${encodeURIComponent(normalizedClass20)}`;
            }

            if (__DEV__) {
                console.log(`[JMA Warnings] RawClass20: ${rawClass20 ?? 'null'}`);
                console.log(`[JMA Warnings] NormalizedClass20: ${normalizedClass20 ?? 'null'}`);
                console.log(`[JMA Warnings] URL: ${url}`);
            }
            const primary = await fetchJson<JmaWarningsResponse>(url);
            if (__DEV__) {
                console.log(`[JMA Warnings] Response items: ${primary.items?.length ?? 0}`);
            }
            setData(primary);
            setReferenceData([]); // References not needed if we rely on office breakdown
        } catch {
            setData(null);
            setReferenceData([]);
        } finally {
            setLoading(false);
        }
    }, [apiAreaCode, normalizedClass20, rawClass20]);

    // Load Current Location on Mount
    useEffect(() => {
        let active = true;
        const init = async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const pos = await Location.getCurrentPositionAsync();
                const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                const [geo, reverse] = await Promise.all([
                    reverseGeocodeResult(coords).catch(() => null),
                    Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon }).catch(() => null),
                ]);
                if (!active || !geo?.prefCode) return;

                const prefName = PREF_BY_CODE.get(geo.prefCode) ?? reverse?.[0]?.region ?? null;
                const muniName =
                    (geo.muniCode ? MUNICIPALITY_BY_CODE.get(geo.muniCode) : null) ??
                    reverse?.[0]?.city ??
                    reverse?.[0]?.district ??
                    reverse?.[0]?.subregion ??
                    null;

                setCurrentLocation({
                    prefCode: geo.prefCode,
                    prefName: prefName ?? '',
                    muniCode: geo.muniCode,
                    muniName,
                    jmaAreaCode: null,
                    jmaAreaName: null,
                });
            } catch {
                // ignore
            }
        };
        void init();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // ViewModel
    const viewModel = useMemo(() => {
        return buildWarningsViewModel(
            { primary: data, references: [] },
            {
                muniCode: manualArea?.muniCode ?? currentLocation?.muniCode ?? null,
                prefName: manualArea?.prefName ?? currentLocation?.prefName ?? null,
                muniName: manualArea?.muniName ?? currentLocation?.muniName ?? null,
                tokyoMode,
                class10Code: resolvedArea.class10Code,
                officeName: resolvedArea.officeName,
                class10Name: resolvedArea.class10Name,
            }
        );
    }, [data, manualArea, currentLocation, tokyoMode, resolvedArea]);

    const [detailsExpanded, setDetailsExpanded] = useState(false);

    const onSelectArea = (area: AreaSelection) => {
        setManualArea(area);
        setSelectorVisible(false);
    };

    const clearManual = () => {
        setManualArea(null);
    };

    // Header Counts
    const { special, warning, advisory } = viewModel.summary;

    const currentTarget = manualArea ?? currentLocation;
    const dispPref = currentTarget?.prefName;
    const dispMuni = currentTarget?.muniName;

    const areaDisplayName =
        viewModel.meta.areaDisplayName ||
        [dispPref, dispMuni].filter((v) => typeof v === 'string' && v.trim()).join(' ');

    const jmaAreaName = viewModel.meta.primaryJmaAreaName ?? currentTarget?.jmaAreaName;

    return (
        <TabScreen title="警報・注意報">
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
            >
                {/* HEADER SECTION */}
                <View style={styles.headerRow}>
                    <Text style={styles.pageTitle}>発表状況</Text>
                    <View style={styles.headerCounts}>
                        {special > 0 && <Badge label="特別警報" count={special} color={LEVEL_COLORS.special} />}
                        {warning > 0 && <Badge label="警報" count={warning} color={LEVEL_COLORS.warning} />}
                        {advisory > 0 && <Badge label="注意報" count={advisory} color={LEVEL_COLORS.advisory} />}
                        {(special === 0 && warning === 0 && advisory === 0) && (
                            <Text style={styles.noAlertText}>発表なし</Text>
                        )}
                    </View>
                </View>

                {/* AREA SELECTION */}
                <View style={styles.areaCard}>
                    <Text style={styles.areaLabel}>対象エリア</Text>
                    <View style={styles.areaRow}>
                        <View>
                            <Text style={styles.currentAreaText}>{areaDisplayName || 'エリア未設定'}</Text>
                            <Text style={styles.subAreaText}>JMA基準: {jmaAreaName || '未設定'}</Text>
                        </View>
                        <Pressable style={styles.changeButton} onPress={() => setSelectorVisible(true)}>
                            <Text style={styles.changeButtonText}>変更</Text>
                        </Pressable>
                    </View>
                    {manualArea && (
                        <Pressable onPress={clearManual}>
                            <Text style={styles.resetLink}>現在地に戻す</Text>
                        </Pressable>
                    )}
                </View>

                {/* ACTIVE WARNINGS (発令中) */}
                <Text style={styles.sectionTitle}>発令中</Text>
                {viewModel.countedWarnings.length === 0 ? (
                    <View style={styles.emptyCard}>
                        <Text style={styles.emptyText}>現在、発表されている警報・注意報はありません。</Text>
                    </View>
                ) : (
                    <View style={styles.warningsGrid}>
                        {viewModel.countedWarnings.map(item => (
                            <View key={item.id} style={styles.warningCard}>
                                <View style={styles.warningInfo}>
                                    <View style={[styles.iconBox, {
                                        backgroundColor: item.color.bg,
                                        borderColor: item.color.border
                                    }]}>
                                        <Text style={[styles.iconText, { color: item.color.text }]}>{item.phenomenon}</Text>
                                    </View>
                                    <View style={styles.statusCol}>
                                        <Text style={styles.kindText}>{item.kind}</Text>
                                        {item.status && <Text style={styles.statusText}>{item.status}</Text>}
                                    </View>
                                </View>
                                <View style={[styles.levelPill, {
                                    borderColor: LEVEL_COLORS[item.severity].border,
                                    backgroundColor: LEVEL_COLORS[item.severity].bg
                                }]}>
                                    <Text style={[styles.levelText, { color: LEVEL_COLORS[item.severity].border }]}>
                                        {item.severity === 'special' ? '特別警報' : item.severity === 'warning' ? '警報' : '注意報'}
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {/* DETAILS BY AREA (詳細) - Only if Prefecture level selected (no specific muni) */}
                {!resolvedArea.class20Code && (
                    <View style={{ marginBottom: 24 }}>
                        <Pressable
                            style={styles.detailAccordionHeader}
                            onPress={() => setDetailsExpanded(!detailsExpanded)}
                        >
                            <Text style={styles.sectionTitleNoMargin}>詳細（エリア別）</Text>
                            <FontAwesome name={detailsExpanded ? "chevron-up" : "chevron-down"} size={14} color="#6b7280" />
                        </Pressable>

                        {detailsExpanded && (
                            <View style={{ marginTop: 8 }}>
                                <Text style={styles.detailSubText}>JMA基準: {jmaAreaName || '未設定'}</Text>
                                {viewModel.areaDetailItems.filter(a => a.hasActive).length === 0 ? (
                                    <Text style={[styles.emptyText, { marginLeft: 4 }]}>発表なし</Text>
                                ) : (
                                    viewModel.areaDetailItems.filter(a => a.hasActive).map((area, idx) => (
                                        <View key={`${area.areaName}-${idx}`} style={[styles.detailCard, area.isPrimary && styles.primaryDetailCard]}>
                                            <View style={styles.detailHeader}>
                                                <Text style={styles.detailAreaName}>{area.areaName}</Text>
                                                <View style={styles.detailSummary}>
                                                    <Text style={styles.activeLabel}>発表あり</Text>
                                                </View>
                                            </View>
                                            <View style={styles.detailTags}>
                                                {area.items.map(it => (
                                                    <View key={it.id} style={[styles.miniTag, { borderColor: it.color.border }]}>
                                                        <Text style={{ fontSize: 10, color: it.color.text }}>{it.kind}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        </View>
                                    ))
                                )}
                            </View>
                        )}
                    </View>
                )}

                {viewModel.referenceWarnings.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>参考情報（島しょ）</Text>
                        {viewModel.referenceWarnings.map((area, idx) => (
                            <View key={`ref-${area.areaName}-${idx}`} style={styles.detailCard}>
                                <View style={styles.detailHeader}>
                                    <Text style={styles.detailAreaName}>{area.areaName}</Text>
                                    <View style={styles.detailSummary}>
                                        <Text style={styles.referenceLabel}>参考</Text>
                                    </View>
                                </View>
                                {area.items.length > 0 && (
                                    <View style={styles.detailTags}>
                                        {area.items.map((it) => (
                                            <View key={it.id} style={[styles.miniTag, { borderColor: it.color.border }]}>
                                                <Text style={{ fontSize: 10, color: it.color.text }}>{it.kind}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </View>
                        ))}
                    </>
                )}

                <View style={{ height: 24 }} />

                {/* GUIDANCE (警戒レベルについて) - Bottom Placement */}
                <Text style={styles.sectionTitle}>警戒レベルについて</Text>
                <View style={styles.guidanceCard}>
                    <LevelRow level="special" label="特別警報" desc="予想をはるかに超える現象です。直ちに命を守る行動をとってください。" />
                    <LevelRow level="warning" label="警報" desc="重大な災害が起こるおそれがある場合に発表されます。" />
                    <LevelRow level="advisory" label="注意報" desc="災害が起こるおそれがある場合に発表されます。" />
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>

            <AreaSelectorSheet
                visible={selectorVisible}
                onClose={() => setSelectorVisible(false)}
                onSelect={onSelectArea}
                muniMap={data?.muniMap ?? null}
                breakdown={data?.breakdown ?? null}
                currentPrefCode={manualArea?.prefCode ?? currentLocation?.prefCode ?? '13'}
            />
        </TabScreen>
    );
}

function Badge({ label, count, color }: { label: string, count: number, color: { border: string, bg: string, text: string } }) {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={[styles.badge, { borderColor: color.border, backgroundColor: color.bg }]}>
            <Text style={[styles.badgeText, { color: color.text }]}>{label} {count}</Text>
        </View>
    );
}

function LevelRow({ level, label, desc }: { level: 'special' | 'warning' | 'advisory', label: string, desc: string }) {
    const styles = useThemedStyles(createStyles);
    const c = LEVEL_COLORS[level];
    return (
        <View style={styles.levelRow}>
            <View style={[styles.levelBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                <Text style={[styles.levelBadgeText, { color: c.text }]}>{label}</Text>
            </View>
            <Text style={styles.levelDesc}>{desc}</Text>
        </View>
    );
}

// Text Input for search

function AreaSelectorSheet({
    visible,
    onClose,
    onSelect,
    muniMap,
    breakdown,
    currentPrefCode,
}: {
    visible: boolean;
    onClose: () => void;
    onSelect: (area: AreaSelection) => void;
    muniMap: JmaWarningsResponse['muniMap'] | null;
    breakdown: JmaWarningsResponse['breakdown'] | null;
    currentPrefCode?: string;
}) {
    const [selectedPref, setSelectedPref] = useState<string | null>(currentPrefCode ?? null);
    const [searchText, setSearchText] = useState('');

    const styles = useThemedStyles(createStyles);

    const handlePrefPress = (code: string) => {
        setSelectedPref(code);
        setSearchText('');
    };

    // Filter Logic
    const munis = useMemo(() => {
        const term = searchText.trim();
        if (!selectedPref && !term) return [];
        let list = ALL_MUNICIPALITIES;
        if (selectedPref) {
            list = list.filter((m) => m.muniCode.startsWith(selectedPref));
        }
        if (term) {
            list = list.filter((m) => m.muniName.includes(term));
        }
        return list.slice(0, 100);
    }, [selectedPref, searchText]);

    const handleMuniPress = (muni: Municipality) => {
        const prefCode = muni.muniCode.slice(0, 2);
        const prefName = PREF_BY_CODE.get(prefCode) ?? '未設定';
        const jmaAreaCode = muniMap?.[muni.muniCode] ?? null;
        const jmaAreaName = jmaAreaCode ? breakdown?.[jmaAreaCode]?.name ?? null : null;
        onSelect({
            prefCode,
            prefName,
            muniCode: muni.muniCode,
            muniName: muni.muniName,
            jmaAreaCode,
            jmaAreaName,
        });
        setSelectedPref(null);
        setSearchText('');
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
            <View style={styles.sheetContainer}>
                <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>{selectedPref ? '市区町村を選択' : '都道府県を選択'}</Text>
                    <Pressable onPress={() => { setSelectedPref(null); setSearchText(''); onClose(); }}>
                        <Text style={styles.closeText}>閉じる</Text>
                    </Pressable>
                </View>

                <View>
                    {selectedPref && (
                        <Pressable style={styles.backRow} onPress={() => { setSelectedPref(null); setSearchText(''); }}>
                            <FontAwesome name="arrow-left" size={16} />
                            <Text style={{ marginLeft: 8 }}>都道府県に戻る</Text>
                        </Pressable>
                    )}
                    <View style={styles.searchBox}>
                        <FontAwesome name="search" size={14} color="#9ca3af" />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="市区町村を検索"
                            value={searchText}
                            onChangeText={setSearchText}
                            autoFocus={false}
                        />
                    </View>
                </View>

                {!selectedPref && !searchText.trim() ? (
                    <FlatList
                        data={PREFECTURES}
                        keyExtractor={(item) => item.code}
                        renderItem={({ item }) => (
                            <Pressable style={styles.optionRow} onPress={() => handlePrefPress(item.code)}>
                                <Text style={styles.optionText}>{item.name}</Text>
                                <FontAwesome name="chevron-right" color="#ccc" />
                            </Pressable>
                        )}
                    />
                ) : (
                    <FlatList
                        data={munis}
                        keyExtractor={(item) => item.muniCode}
                        renderItem={({ item }) => (
                            <Pressable style={styles.optionRow} onPress={() => handleMuniPress(item)}>
                                <Text style={styles.optionText}>{item.muniName}</Text>
                            </Pressable>
                        )}
                        ListEmptyComponent={<Text style={styles.emptyText}>該当なし</Text>}
                    />
                )}
            </View>
        </Modal>
    );
}

async function reverseGeocodeResult(coords: LatLng): Promise<{ prefCode: string | null; muniCode: string | null }> {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
        coords.lon
    )}&lat=${encodeURIComponent(coords.lat)}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return { prefCode: null, muniCode: null };
    const json = await response.json();
    const muniRaw = json?.results?.muniCd ?? null;
    return normalizeMuniCode(muniRaw);
}

function computeCheckDigit(code5: string): string {
    const digits = code5.split('').map((ch) => Number(ch));
    if (digits.length !== 5 || digits.some((d) => !Number.isFinite(d))) return '0';
    const weights = [6, 5, 4, 3, 2];
    const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
    const remainder = sum % 11;
    const cd = (11 - remainder) % 11;
    return cd === 10 ? '0' : String(cd);
}

function normalizeMuniCode(raw: unknown): { muniCode: string | null; prefCode: string | null } {
    if (typeof raw !== 'string') return { muniCode: null, prefCode: null };
    const digits = raw.replace(/\D/g, '');
    if (!digits) return { muniCode: null, prefCode: null };

    if (digits.length === 6) {
        const prefCode = digits.slice(0, 2);
        return { muniCode: digits, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
    }

    if (digits.length <= 5) {
        const base5 = digits.padStart(5, '0');
        if (!/^\d{5}$/.test(base5)) return { muniCode: null, prefCode: null };
        const muniCode = `${base5}${computeCheckDigit(base5)}`;
        const prefCode = base5.slice(0, 2);
        return { muniCode, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
    }

    return { muniCode: null, prefCode: null };
}


// Styles
const createStyles = (colors: { background: string; border: string; text: string; muted: string }) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    content: {
        padding: spacing.md,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.md,
    },
    pageTitle: {
        ...typography.subtitle, // Already bold
        fontSize: 24,
        color: colors.text,
    },
    headerCounts: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: 4,
        flex: 1,
        marginLeft: 16, // Space from title
    },
    badge: {
        borderWidth: 1,
        borderRadius: 8, // Pill
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    noAlertText: {
        fontSize: 12,
        color: colors.muted,
        marginTop: 6,
    },
    areaCard: {
        backgroundColor: '#f9fafb', // gray-50
        borderRadius: radii.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
    },
    areaLabel: {
        fontSize: 12,
        color: colors.muted,
    },
    areaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    currentAreaText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.text,
    },
    changeButton: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#ccc',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radii.md,
    },
    changeButtonText: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    resetLink: {
        fontSize: 12,
        color: '#2563eb', // blue-600
        marginTop: 8,
        textDecorationLine: 'underline',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: spacing.sm,
        marginBottom: spacing.sm,
        color: colors.text,
    },
    sectionTitleNoMargin: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.text,
    },
    detailAccordionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    detailSubText: {
        fontSize: 12,
        color: colors.muted,
        marginBottom: spacing.sm,
    },
    emptyCard: {
        padding: spacing.lg,
        alignItems: 'center',
        backgroundColor: '#f3f4f6', // gray-100
        borderRadius: radii.lg,
    },
    emptyText: {
        color: colors.muted,
    },
    warningsGrid: {
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    warningCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: radii.lg,
        padding: spacing.md,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    warningInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    iconBox: {
        width: 48,
        height: 48,
        borderRadius: 8,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconText: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    statusCol: {
        flex: 1,
    },
    kindText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.text,
    },
    statusText: {
        fontSize: 12,
        color: colors.muted,
    },
    levelPill: {
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    levelText: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    detailCard: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        marginBottom: 8,
        borderRadius: radii.md,
        padding: 12,
    },
    primaryDetailCard: {
        borderColor: '#93c5fd', // blue-300
        backgroundColor: '#eff6ff', // blue-50
    },
    detailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    detailAreaName: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    detailSummary: {
        //
    },
    activeLabel: {
        fontSize: 12,
        color: '#dc2626',
        fontWeight: 'bold',
    },
    inactiveLabel: {
        fontSize: 12,
        color: '#9ca3af',
    },
    referenceLabel: {
        fontSize: 12,
        color: colors.muted,
    },
    detailTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 8,
    },
    miniTag: {
        borderWidth: 1,
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 2,
        backgroundColor: '#fff',
    },
    guidanceCard: {
        backgroundColor: '#fff',
        borderRadius: radii.lg,
        padding: spacing.md,
        gap: 12,
    },
    levelRow: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
    },
    levelBadge: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        minWidth: 70,
        alignItems: 'center',
    },
    levelBadgeText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    levelDesc: {
        flex: 1,
        fontSize: 12,
        color: colors.text,
        lineHeight: 18,
    },
    // Sheet
    sheetContainer: {
        flex: 1,
        backgroundColor: '#fff',
        paddingTop: 20,
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    closeText: {
        fontSize: 16,
        color: '#2563eb',
    },
    backRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f3f3',
    },
    optionRow: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f3f3',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    optionText: {
        fontSize: 16,
    },
    subAreaText: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 2,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
        marginHorizontal: 16,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        height: 36,
    },
    searchInput: {
        flex: 1,
        marginLeft: 8,
        fontSize: 14,
    },
});
