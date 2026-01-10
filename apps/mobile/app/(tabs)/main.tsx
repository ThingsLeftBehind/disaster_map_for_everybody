import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';

import { buildCacheKey, checkShelterVersion, fetchJson, fetchJsonWithCache, toApiError, type ApiError } from '@/src/api/client';
import type { JmaWarningsResponse, Shelter, SheltersNearbyResponse } from '@/src/api/types';
import { getEmergencyState, type EmergencyState } from '@/src/emergency/state';
import { NearbySheltersCard } from '@/src/main/NearbySheltersCard';
import { FAVORITE_LIMIT, loadFavorites, saveFavorites, toFavoriteShelter, type FavoriteShelter } from '@/src/main/favorites';
import { ShelterDetailSheet } from '@/src/main/ShelterDetailSheet';
import { ShelterMap, type ShelterMapRegion, type ShelterMarker } from '@/src/map/ShelterMap';
import { JmaAreaMapper } from '@/src/features/warnings/areaMapping';
import { buildWarningsViewModel } from '@/src/features/warnings/transform';
import { type TokyoMode } from '@/src/features/warnings/tokyoRouting';
import { subscribeMainRefresh } from '@/src/push/events';
import { loadLastKnownLocation } from '@/src/push/service';
import { setLastKnownLocation } from '@/src/push/state';
import { PrimaryButton, SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { ensureHazardCoverage } from '@/src/storage/hazardCoverage';
import { radii, spacing, typography, useThemedStyles, useTheme } from '@/src/ui/theme';

const DEFAULT_RADIUS_KM = 20;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const NEARBY_TIMEOUT_MS = 15000;
const DEFAULT_AREA = '130000';
const DEFAULT_MAP_REGION: ShelterMapRegion = {
    latitude: 35.6812,
    longitude: 139.7671,
    latitudeDelta: 0.2,
    longitudeDelta: 0.2,
};

type PermissionState = 'unknown' | 'granted' | 'denied';

type LatLng = {
    lat: number;
    lon: number;
};

type CacheInfo = {
    fromCache: boolean;
    cachedAt: string | null;
    updatedAt: string | null;
};

export default function MainScreen() {
    const router = useRouter();
    const { height } = useWindowDimensions();
    const styles = useThemedStyles(createStyles);
    const { colors } = useTheme();
    const mapHeight = Math.max(220, Math.min(340, Math.round(height * 0.42)));

    const [permission, setPermission] = useState<PermissionState>('unknown');
    const [location, setLocation] = useState<LatLng | null>(null);
    const [isLocating, setIsLocating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [uiNotice, setUiNotice] = useState<string | null>(null);
    const [permissionDismissed, setPermissionDismissed] = useState(false);
    const [shelters, setShelters] = useState<Shelter[]>([]);
    const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
    const [favorites, setFavorites] = useState<FavoriteShelter[]>([]);
    const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Area Context
    const [areaCode, setAreaCode] = useState(DEFAULT_AREA);
    const [currentMuniCode, setCurrentMuniCode] = useState<string | null>(null);
    const [prefName, setPrefName] = useState<string | null>(null);
    const [muniName, setMuniName] = useState<string | null>(null);
    const [tokyoMode, setTokyoMode] = useState<TokyoMode>('OTHER');
    const [referenceAreaCodes, setReferenceAreaCodes] = useState<string[]>([]);

    const [warningsData, setWarningsData] = useState<JmaWarningsResponse | null>(null);
    const [referenceWarningsData, setReferenceWarningsData] = useState<JmaWarningsResponse[]>([]);
    const [warningsError, setWarningsError] = useState<ApiError | null>(null);
    const [emergencyState, setEmergencyState] = useState<EmergencyState | null>(null);
    const cacheLabel = useMemo(() => {
        if (!cacheInfo?.fromCache) return null;
        const stamp = cacheInfo.updatedAt ?? cacheInfo.cachedAt ?? null;
        return stamp ? `キャッシュ表示: ${formatTime(stamp)}` : 'キャッシュ表示';
    }, [cacheInfo]);

    useEffect(() => {
        let active = true;
        loadFavorites()
            .then((items) => {
                if (!active) return;
                setFavorites(items);
            })
            .catch(() => {
                if (!active) return;
                setFavorites([]);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        void saveFavorites(favorites);
    }, [favorites]);

    useEffect(() => {
        let active = true;
        getEmergencyState()
            .then((state) => {
                if (!active) return;
                setEmergencyState(state);
            })
            .catch(() => {
                if (!active) return;
                setEmergencyState(null);
            });
        return () => {
            active = false;
        };
    }, []);

    useFocusEffect(
        useCallback(() => {
            let active = true;
            getEmergencyState()
                .then((state) => {
                    if (!active) return;
                    setEmergencyState(state);
                })
                .catch(() => {
                    if (!active) return;
                    setEmergencyState(null);
                });
            return () => {
                active = false;
            };
        }, [])
    );

    const fetchShelters = useCallback(
        async (coords: LatLng, options?: { notice?: string | null }) => {
            setIsLoading(true);
            setError(null);
            setNotice(options?.notice ?? null);
            setUiNotice(null);
            setCacheInfo(null);
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
                await checkShelterVersion();
                const limit = Math.min(DEFAULT_LIMIT, MAX_LIMIT);
                const params = new URLSearchParams({
                    lat: coords.lat.toString(),
                    lon: coords.lon.toString(),
                    limit: String(limit),
                    radiusKm: String(DEFAULT_RADIUS_KM),
                    hideIneligible: 'false',
                });
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), NEARBY_TIMEOUT_MS);
                const cacheKey = buildCacheKey('/api/shelters/nearby', params);
                const result = await fetchJsonWithCache<SheltersNearbyResponse>(
                    `/api/shelters/nearby?${params.toString()}`,
                    { signal: controller.signal },
                    { key: cacheKey, kind: 'nearby' }
                );
                const data = result.data;
                const items = (data.items ?? data.sites ?? []).slice();
                items.sort((a, b) => getDistance(a) - getDistance(b));
                setShelters(items);
                setCacheInfo({ fromCache: result.fromCache, cachedAt: result.cachedAt, updatedAt: result.updatedAt });
                void ensureHazardCoverage('current', coords, items, data.updatedAt ?? null);
            } catch (err) {
                setError(toApiError(err));
                setShelters([]);
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                setIsLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        let active = true;
        const load = async () => {
            setIsLocating(true);
            setError(null);
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (!active) return;
                if (status !== 'granted') {
                    setPermission('denied');
                    setIsLocating(false);
                    return;
                }
                setPermission('granted');
                const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                if (!active) return;
                const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
                setLocation(coords);
                await setLastKnownLocation(coords);
                setIsLocating(false);
                await fetchShelters(coords);
            } catch (err) {
                if (!active) return;
                setIsLocating(false);
                setError(toApiError(err));
            }
        };
        void load();
        return () => {
            active = false;
        };
    }, [fetchShelters]);

    useEffect(() => {
        void checkShelterVersion();
    }, []);

    useEffect(() => {
        let active = true;
        const resolveArea = async () => {
            if (!location) return;
            try {
                // Parallel fetch: PrefCode (for API) and CityName (for Display)
                const [geo, reverse] = await Promise.all([
                    reverseGeocodeResult(location).catch(() => null),
                    Location.reverseGeocodeAsync({ latitude: location.lat, longitude: location.lon }).catch(() => null),
                ]);
                if (!active) return;

                if (reverse && reverse.length > 0) {
                    const address = reverse[0];
                    const city = address.city ?? address.district ?? address.subregion ?? null;
                    setPrefName(address.region ?? null);
                    setMuniName(city);
                }

                if (geo?.prefCode) {
                    const muniCode = geo.muniCode;
                    setCurrentMuniCode(muniCode);

                    const info = JmaAreaMapper.resolve(muniCode);
                    const officeCode = info.officeCode ?? `${geo.prefCode}0000`;
                    setAreaCode(officeCode);
                    setReferenceAreaCodes([]);

                    // Derive Tokyo Mode for consistent filtering
                    let mode: TokyoMode = 'OTHER';
                    if (officeCode === '130000') {
                        if (info.class10Code === '130010') mode = 'MAINLAND';
                        else if (['130020', '130030', '130040'].includes(info.class10Code ?? '')) mode = 'ISLANDS';
                        else mode = 'MAINLAND';
                    }
                    setTokyoMode(mode);
                }
            } catch {
                // ignore
            }
        };
        void resolveArea();
        return () => {
            active = false;
        };
    }, [location]);

    const referenceKey = useMemo(() => referenceAreaCodes.join('|'), [referenceAreaCodes]);

    useEffect(() => {
        let active = true;
        const loadWarnings = async () => {
            setWarningsError(null);
            try {
                const info = JmaAreaMapper.resolve(currentMuniCode);
                const rawClass20 = info.class20Code ?? currentMuniCode ?? null;
                const normalizedClass20 = normalizeClass20(rawClass20);
                let url = `/api/jma/warnings?area=${areaCode}`;
                if (normalizedClass20) {
                    url += `&class20=${encodeURIComponent(normalizedClass20)}`;
                }
                const isTokyoArea = areaCode === '130000';
                if (__DEV__) {
                    console.log(`[JMA Warnings] Area: ${areaCode}`);
                    console.log(`[JMA Warnings] RawClass20: ${rawClass20 ?? 'null'}`);
                    console.log(`[JMA Warnings] NormalizedClass20: ${normalizedClass20 ?? 'null'}`);
                    console.log(`[JMA Warnings] URL: ${url}`);
                    if (isTokyoArea && normalizedClass20) {
                        console.log(`[JMA Warnings] Tokyo class20 group: ${getTokyoClass20Group(normalizedClass20)}`);
                    }
                    if (!normalizedClass20) {
                        console.log('[JMA Warnings] No class20: area-only request');
                    }
                }
                let primary = await fetchJson<JmaWarningsResponse>(url);
                if (__DEV__) {
                    console.log(`[JMA Warnings] Response items: ${primary.items?.length ?? 0}`);
                }
                if (normalizedClass20 && (primary.items?.length ?? 0) === 0) {
                    if (isTokyoArea) {
                        if (__DEV__) {
                            console.log('[JMA Warnings] Fallback skipped: Tokyo with valid class20');
                        }
                    } else {
                        const fallbackUrl = `/api/jma/warnings?area=${areaCode}`;
                        if (__DEV__) {
                            console.log(`[JMA Warnings] Fallback URL: ${fallbackUrl}`);
                        }
                        const fallback = await fetchJson<JmaWarningsResponse>(fallbackUrl);
                        if (__DEV__) {
                            console.log(`[JMA Warnings] Fallback items: ${fallback.items?.length ?? 0}`);
                        }
                        if ((fallback.items?.length ?? 0) > 0) {
                            primary = fallback;
                            if (__DEV__) {
                                console.log('[JMA Warnings] Fallback used: non-Tokyo empty class20');
                            }
                        }
                    }
                }

                if (!active) return;
                setWarningsData(primary);
                setReferenceWarningsData([]);
            } catch (err) {
                if (!active) return;
                setWarningsError(toApiError(err));
                setWarningsData(null);
                setReferenceWarningsData([]);
            }
        };
        void loadWarnings();
        return () => {
            active = false;
        };
    }, [areaCode, currentMuniCode, referenceKey]);

    const refreshFromPush = useCallback(async () => {
        const permissionStatus = await Location.getForegroundPermissionsAsync();
        if (permissionStatus.status === 'granted') {
            const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
            if (position?.coords) {
                const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
                setLocation(coords);
                await setLastKnownLocation(coords);
                await fetchShelters(coords);
                return;
            }
        }

        const last = await loadLastKnownLocation();
        if (last) {
            setLocation(last);
            await fetchShelters(last, { notice: '保存済みの位置で表示しています。' });
        } else {
            setNotice('位置情報が必要です。');
        }
    }, [fetchShelters]);

    useEffect(() => {
        const unsubscribe = subscribeMainRefresh(() => {
            void refreshFromPush();
        });
        return unsubscribe;
    }, [refreshFromPush]);

    const mapRegion = useMemo<ShelterMapRegion>(() => {
        if (!location) return DEFAULT_MAP_REGION;
        return {
            latitude: location.lat,
            longitude: location.lon,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
        };
    }, [location]);

    const mapShelters = useMemo(
        () => shelters.filter((shelter) => Number.isFinite(shelter.lat) && Number.isFinite(shelter.lon)),
        [shelters]
    );

    const mapMarkers = useMemo<ShelterMarker[]>(() => {
        const markers: ShelterMarker[] = [];
        if (location) {
            markers.push({ id: 'current', lat: location.lat, lon: location.lon, title: '現在地' });
        }
        mapShelters.forEach((shelter) => {
            markers.push({
                id: String(shelter.id),
                lat: shelter.lat,
                lon: shelter.lon,
                title: shelter.name ?? '避難所',
            });
        });
        return markers;
    }, [location, mapShelters]);

    const selectedShelter = useMemo(
        () => shelters.find((shelter) => String(shelter.id) === selectedShelterId) ?? null,
        [selectedShelterId, shelters]
    );

    useEffect(() => {
        if (detailOpen && selectedShelterId && !selectedShelter) {
            setDetailOpen(false);
        }
    }, [detailOpen, selectedShelter, selectedShelterId]);

    const jmaInfo = useMemo(() => JmaAreaMapper.resolve(currentMuniCode), [currentMuniCode]);

    const viewModel = useMemo(
        () =>
            buildWarningsViewModel(
                { primary: warningsData, references: [] },
                {
                    muniCode: currentMuniCode,
                    prefName,
                    muniName,
                    tokyoMode,
                    class10Code: jmaInfo.class10Code,
                    officeName: jmaInfo.officeName,
                    class10Name: jmaInfo.class10Name
                }
            ),
        [currentMuniCode, muniName, prefName, tokyoMode, warningsData, jmaInfo]
    );

    const hasAlerts = viewModel.countedWarnings.length > 0 && !warningsError;
    const useMyAreaAlert = emergencyState?.baseMode === 'myArea' && Boolean(emergencyState?.myArea);
    const alertIconActive = useMyAreaAlert ? emergencyState?.myAreaHasWarnings === true : hasAlerts;
    const areaLabel = viewModel.meta.areaDisplayName
        ? `対象: ${viewModel.meta.areaDisplayName}`
        : `対象: ${viewModel.meta.primaryJmaAreaName ?? '現在地周辺'}`;

    const alertMessage = useMemo(() => {
        const { special, warning, advisory } = viewModel.summary;
        const parts: string[] = [];
        if (special > 0) parts.push(`特別警報 ${special}件`);
        if (warning > 0) parts.push(`警報 ${warning}件`);
        if (advisory > 0) parts.push(`注意報 ${advisory}件`);
        return parts.join(' / ');
    }, [viewModel.summary]);

    const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
    const isFavorite = selectedShelterId ? favoriteIds.has(selectedShelterId) : false;

    const handleReseek = useCallback(() => {
        if (location) {
            void fetchShelters(location);
            return;
        }
        void refreshFromPush();
    }, [fetchShelters, location, refreshFromPush]);

    const handleSelectShelter = useCallback((shelter: Shelter) => {
        setSelectedShelterId(String(shelter.id));
        setDetailOpen(true);
    }, []);

    const handleMarkerPress = useCallback(
        (id: string) => {
            if (id === 'current') return;
            const shelter = shelters.find((item) => String(item.id) === id);
            if (!shelter) return;
            handleSelectShelter(shelter);
        },
        [handleSelectShelter, shelters]
    );

    const handleToggleFavorite = useCallback(() => {
        if (!selectedShelter) return;
        setUiNotice(null);
        setFavorites((prev) => {
            const id = String(selectedShelter.id);
            const exists = prev.some((item) => item.id === id);
            if (exists) {
                return prev.filter((item) => item.id !== id);
            }
            if (prev.length >= FAVORITE_LIMIT) {
                setUiNotice(`保存は最大${FAVORITE_LIMIT}件までです。`);
                return prev;
            }
            const cachedAt = cacheInfo?.updatedAt ?? cacheInfo?.cachedAt ?? new Date().toISOString();
            return [...prev, toFavoriteShelter(selectedShelter, cachedAt)];
        });
    }, [cacheInfo?.cachedAt, cacheInfo?.updatedAt, selectedShelter]);

    const handleDirections = useCallback(async () => {
        if (!selectedShelter) return;
        const destination = selectedShelter.address
            ? selectedShelter.address
            : Number.isFinite(selectedShelter.lat) && Number.isFinite(selectedShelter.lon)
                ? `${selectedShelter.lat},${selectedShelter.lon}`
                : null;
        if (!destination) return;
        const origin = location ? `${location.lat},${location.lon}` : null;
        const base = 'https://www.google.com/maps/dir/?api=1';
        const url = origin
            ? `${base}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
            : `${base}&destination=${encodeURIComponent(destination)}`;
        await Linking.openURL(url);
    }, [location, selectedShelter]);

    const handleShare = useCallback(async () => {
        if (!selectedShelter) return;
        const lines = [selectedShelter.name ?? '避難所'];
        if (selectedShelter.address) lines.push(selectedShelter.address);
        if (Number.isFinite(selectedShelter.lat) && Number.isFinite(selectedShelter.lon)) {
            lines.push(`https://www.google.com/maps/search/?api=1&query=${selectedShelter.lat},${selectedShelter.lon}`);
        }
        try {
            await Share.share({ message: lines.join('\n') });
        } catch {
            return;
        }
    }, [selectedShelter]);

    const detailDistance = selectedShelter ? formatDistance(getDistance(selectedShelter)) : null;
    const noticeLabel = notice ?? uiNotice;

    const emergencyIcon = (
        <Pressable
            style={styles.alertIconButton}
            onPress={() => router.push('/emergency')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="緊急モードを開く"
        >
            <View
                style={[
                    styles.alertTriangle,
                    { borderBottomColor: alertIconActive ? colors.statusDanger : colors.text },
                ]}
            />
            <Text style={[styles.alertTriangleText, { color: alertIconActive ? '#ffffff' : colors.background }]}>!</Text>
        </Pressable>
    );

    return (
        <TabScreen title="避難ナビ" rightAccessory={emergencyIcon}>
            {permission !== 'granted' && !permissionDismissed ? (
                <View style={styles.permissionCard}>
                    <View style={styles.permissionHeader}>
                        <Text style={styles.permissionTitle}>位置情報の許可が必要です</Text>
                        <Pressable hitSlop={10} onPress={() => setPermissionDismissed(true)}>
                            <FontAwesome name="close" size={16} color={styles.permissionText.color} />
                        </Pressable>
                    </View>
                    <Text style={styles.permissionText}>
                        災害時の迅速な通知・周辺避難所のリアルタイム更新のため、位置情報の許可が必要です。
                    </Text>
                    <SecondaryButton label="設定を開く" onPress={() => Linking.openSettings()} />
                </View>
            ) : null}

            <View style={styles.mapCard}>
                {hasAlerts ? (
                    <View style={styles.alertBannerContainer}>
                        <View style={styles.alertTextBlock}>
                            <Text style={styles.alertText}>{alertMessage}</Text>
                            <Text style={styles.alertArea}>{areaLabel}</Text>
                        </View>
                        <Pressable style={styles.alertButton} onPress={() => router.push('/alerts')}>
                            <Text style={styles.alertButtonText}>警報ページへ</Text>
                        </Pressable>
                    </View>
                ) : null}

                <View style={[styles.mapWrap, { height: mapHeight }]}>
                    <ShelterMap region={mapRegion} markers={mapMarkers} onPressMarker={handleMarkerPress} />
                </View>
                {isLocating || isLoading ? (
                    <View style={styles.skeletonStack}>
                        <Skeleton height={12} />
                        <Skeleton width="60%" height={12} />
                    </View>
                ) : null}
                <PrimaryButton label="再検索" onPress={handleReseek} />
            </View>

            <NearbySheltersCard
                shelters={shelters}
                favorites={favorites}
                selectedId={selectedShelterId}
                isLoading={isLoading}
                error={error}
                cacheLabel={cacheLabel}
                notice={noticeLabel}
                onRetry={handleReseek}
                onSelect={handleSelectShelter}
                onOpenList={() => router.push('/list')}
            />

            <ShelterDetailSheet
                visible={detailOpen}
                shelter={selectedShelter}
                distanceLabel={detailDistance}
                isFavorite={isFavorite}
                onClose={() => setDetailOpen(false)}
                onToggleFavorite={handleToggleFavorite}
                onDirections={handleDirections}
                onShare={handleShare}
            />
        </TabScreen>
    );
}

function getDistance(shelter: Shelter) {
    const distance = shelter.distanceKm ?? shelter.distance ?? null;
    if (typeof distance === 'number' && Number.isFinite(distance)) return distance;
    return Number.POSITIVE_INFINITY;
}

function formatDistance(distance: number) {
    if (!Number.isFinite(distance)) return '距離不明';
    if (distance < 1) return `${Math.round(distance * 1000)}m`;
    return `${distance.toFixed(1)}km`;
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(
        date.getMinutes()
    ).padStart(2, '0')}`;
}

// Updated reverse geocoder to extract muniCode
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

function normalizeClass20(raw: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 7) return digits;
    if (digits.length === 5) return `${digits}00`;
    if (digits.length === 6) {
        const base5 = digits.slice(0, 5);
        const checkDigit = digits.slice(5);
        if (computeCheckDigit(base5) !== checkDigit) return null;
        return `${base5}00`;
    }
    return null;
}

function getTokyoClass20Group(class20: string): 'urban' | 'islands' | 'unknown' {
    if (!class20) return 'unknown';
    const islandPrefixes = ['13361', '13362', '13363', '13364', '13381', '13382', '13401', '13402', '13421'];
    if (islandPrefixes.some((prefix) => class20.startsWith(prefix))) return 'islands';
    if (class20.startsWith('13')) return 'urban';
    return 'unknown';
}

const createStyles = (colors: { background: string; border: string; text: string; muted: string }) =>
    StyleSheet.create({
        permissionCard: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.lg,
            padding: spacing.md,
            backgroundColor: colors.background,
            marginBottom: spacing.md,
        },
        permissionHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.xs,
        },
        permissionTitle: {
            ...typography.subtitle,
            color: colors.text,
            flex: 1,
        },
        permissionText: {
            ...typography.caption,
            color: colors.muted,
            marginBottom: spacing.sm,
        },
        alertIconButton: {
            width: 30,
            height: 26,
            alignItems: 'center',
            justifyContent: 'center',
        },
        alertTriangle: {
            width: 0,
            height: 0,
            borderLeftWidth: 10,
            borderRightWidth: 10,
            borderBottomWidth: 18,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
        },
        alertTriangleText: {
            position: 'absolute',
            top: 4,
            fontSize: 12,
            fontWeight: '700',
        },
        mapCard: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.lg,
            padding: spacing.md,
            backgroundColor: colors.background,
            marginBottom: spacing.md,
        },
        mapWrap: {
            borderRadius: radii.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.border,
            position: 'relative',
        },
        // New Alert Banner Styles
        alertBannerContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: spacing.sm,
            borderRadius: radii.md,
            borderWidth: 2,
            borderColor: '#000000', // Black border per requirement
            backgroundColor: colors.background,
            marginBottom: spacing.md, // Spacing above map
        },
        alertTextBlock: {
            flex: 1,
            marginRight: spacing.sm,
        },
        alertText: {
            ...typography.label,
            color: colors.text,
            fontWeight: 'bold',
        },
        alertArea: {
            ...typography.caption,
            color: colors.muted,
            marginTop: spacing.xxs,
        },
        alertButton: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.pill,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xxs,
        },
        alertButtonText: {
            ...typography.caption,
            color: colors.text,
        },
        skeletonStack: {
            gap: spacing.xs,
            marginTop: spacing.sm,
        },
    });
