import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { buildCacheKey, checkShelterVersion, fetchJson, fetchJsonWithCache, toApiError, type ApiError } from '@/src/api/client';
import type { JmaWarningsResponse, Shelter, SheltersNearbyResponse } from '@/src/api/types';
import { NearbySheltersCard } from '@/src/main/NearbySheltersCard';
import { FAVORITE_LIMIT, loadFavorites, saveFavorites, toFavoriteShelter, type FavoriteShelter } from '@/src/main/favorites';
import { ShelterDetailSheet } from '@/src/main/ShelterDetailSheet';
import { ShelterMap, type ShelterMapRegion, type ShelterMarker } from '@/src/map/ShelterMap';
import { subscribeMainRefresh } from '@/src/push/events';
import { loadLastKnownLocation } from '@/src/push/service';
import { setLastKnownLocation } from '@/src/push/state';
import { PrimaryButton, SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';

const DEFAULT_RADIUS_KM = 20;
const DEFAULT_LIMIT = 20;
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
  const mapHeight = Math.max(220, Math.min(340, Math.round(height * 0.42)));

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [favorites, setFavorites] = useState<FavoriteShelter[]>([]);
  const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [areaCode, setAreaCode] = useState(DEFAULT_AREA);
  const [warningsData, setWarningsData] = useState<JmaWarningsResponse | null>(null);
  const [warningsError, setWarningsError] = useState<ApiError | null>(null);

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

  const fetchShelters = useCallback(
    async (coords: LatLng, options?: { notice?: string | null }) => {
      setIsLoading(true);
      setError(null);
      setNotice(options?.notice ?? null);
      setUiNotice(null);
      setCacheInfo(null);
      try {
        await checkShelterVersion();
        const params = new URLSearchParams({
          lat: coords.lat.toString(),
          lon: coords.lon.toString(),
          limit: String(DEFAULT_LIMIT),
          radiusKm: String(DEFAULT_RADIUS_KM),
          hideIneligible: 'false',
        });
        const cacheKey = buildCacheKey('/api/shelters/nearby', params);
        const result = await fetchJsonWithCache<SheltersNearbyResponse>(
          `/api/shelters/nearby?${params.toString()}`,
          {},
          { key: cacheKey, kind: 'nearby' }
        );
        const data = result.data;
        const items = (data.items ?? data.sites ?? []).slice();
        items.sort((a, b) => getDistance(a) - getDistance(b));
        setShelters(items);
        setCacheInfo({ fromCache: result.fromCache, cachedAt: result.cachedAt, updatedAt: result.updatedAt });
      } catch (err) {
        setError(toApiError(err));
        setShelters([]);
      } finally {
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
      const prefCode = await reverseGeocodePrefCode(location).catch(() => null);
      if (!active || !prefCode) return;
      setAreaCode(`${prefCode}0000`);
    };
    void resolveArea();
    return () => {
      active = false;
    };
  }, [location]);

  useEffect(() => {
    let active = true;
    const loadWarnings = async () => {
      setWarningsError(null);
      try {
        const data = await fetchJson<JmaWarningsResponse>(`/api/jma/warnings?area=${areaCode}`);
        if (!active) return;
        setWarningsData(data);
      } catch (err) {
        if (!active) return;
        setWarningsError(toApiError(err));
        setWarningsData(null);
      }
    };
    void loadWarnings();
    return () => {
      active = false;
    };
  }, [areaCode]);

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

  const cacheLabel = useMemo(() => {
    const value = cacheInfo?.updatedAt ?? cacheInfo?.cachedAt ?? null;
    return value ? formatTime(value) : null;
  }, [cacheInfo]);

  const warningCount = useMemo(() => countWarnings(warningsData?.items ?? [], 'warning'), [warningsData?.items]);
  const advisoryCount = useMemo(() => countWarnings(warningsData?.items ?? [], 'advisory'), [warningsData?.items]);
  const hasAlerts = warningCount + advisoryCount > 0 && !warningsError;
  const areaLabel = warningsData?.areaName ?? '対象エリア';

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
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      return;
    }
  }, [selectedShelter]);

  const detailDistance = selectedShelter ? formatDistance(getDistance(selectedShelter)) : null;
  const noticeLabel = notice ?? uiNotice;

  return (
    <TabScreen title="避難ナビ">
      {permission !== 'granted' ? (
        <View style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>位置情報を有効にすると、避難所検索が速くなります。</Text>
          <Text style={styles.permissionText}>緊急時の通知と近くの避難所表示のために必要です。</Text>
          <SecondaryButton label="設定を開く" onPress={() => Linking.openSettings()} />
        </View>
      ) : null}

      <View style={styles.mapCard}>
        <View style={[styles.mapWrap, { height: mapHeight }]}>
          <ShelterMap region={mapRegion} markers={mapMarkers} onPressMarker={handleMarkerPress} />
        {hasAlerts ? (
          <View style={styles.alertOverlay}>
              <View style={styles.alertTextBlock}>
                <Text style={styles.alertText}>注意報 {advisoryCount}件 / 警報 {warningCount}件</Text>
                <Text style={styles.alertArea}>{areaLabel}</Text>
              </View>
              <Pressable style={styles.alertButton} onPress={() => router.push('/alerts')}>
                <Text style={styles.alertButtonText}>警報ページへ</Text>
              </Pressable>
            </View>
          ) : null}
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
        cacheLabel={cacheInfo?.fromCache ? cacheLabel : null}
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

function countWarnings(items: JmaWarningsResponse['items'], kind: 'warning' | 'advisory') {
  if (!items) return 0;
  if (kind === 'warning') {
    return items.filter((item) => item.kind.includes('警報') || item.kind.includes('特別警報')).length;
  }
  return items.filter((item) => item.kind.includes('注意報')).length;
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

function formatTime(value: string | null) {
  if (!value) return '不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

async function reverseGeocodePrefCode(coords: LatLng): Promise<string | null> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
    coords.lon
  )}&lat=${encodeURIComponent(coords.lat)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const json = await response.json();
  const muniRaw = json?.results?.muniCd ?? null;
  const { prefCode } = normalizeMuniCode(muniRaw);
  return prefCode;
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
    permissionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    permissionText: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.sm,
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
    alertOverlay: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.sm,
      right: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    alertTextBlock: {
      flex: 1,
      marginRight: spacing.sm,
    },
    alertText: {
      ...typography.label,
      color: colors.text,
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
