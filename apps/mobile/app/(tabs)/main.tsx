import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { buildCacheKey, checkShelterVersion, fetchJsonWithCache, toApiError, type ApiError } from '@/src/api/client';
import type { Shelter, SheltersNearbyResponse } from '@/src/api/types';
import { NearbySheltersCard } from '@/src/main/NearbySheltersCard';
import { FAVORITE_LIMIT, loadFavorites, saveFavorites, toFavoriteShelter, type FavoriteShelter } from '@/src/main/favorites';
import { ShelterDetailSheet } from '@/src/main/ShelterDetailSheet';
import { ShelterMap, type ShelterMapRegion, type ShelterMarker } from '@/src/map/ShelterMap';
import { subscribeMainRefresh } from '@/src/push/events';
import { loadLastKnownLocation } from '@/src/push/service';
import { setLastKnownLocation } from '@/src/push/state';
import { ErrorState, PrimaryButton, SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { colors, radii, spacing, typography } from '@/src/ui/theme';

const DEFAULT_RADIUS_KM = 20;
const DEFAULT_LIMIT = 20;
const DEFAULT_MAP_REGION: ShelterMapRegion = {
  latitude: 35.6812,
  longitude: 139.7671,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

type PermissionState = 'unknown' | 'granted' | 'denied';
type LocationMode = 'current' | 'last' | 'cache';

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
  const mapHeight = Math.max(240, Math.min(360, Math.round(height * 0.42)));

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [locationMode, setLocationMode] = useState<LocationMode>('current');
  const [favorites, setFavorites] = useState<FavoriteShelter[]>([]);
  const [nearbyOpen, setNearbyOpen] = useState(true);
  const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mapFocus, setMapFocus] = useState<ShelterMapRegion | null>(null);

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
    async (coords: LatLng, options?: { notice?: string | null; source?: LocationMode }) => {
      setIsLoading(true);
      setError(null);
      setNotice(options?.notice ?? null);
      setUiNotice(null);
      setCacheInfo(null);
      setLocationMode(options?.source ?? 'current');
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
        if (result.fromCache) {
          setLocationMode('cache');
        }
        if (!result.fromCache && data.fetchStatus !== 'OK') {
          setNotice(data.lastError ?? '更新が遅れています');
        }
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
        await fetchShelters(coords, { source: 'current' });
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

  const refreshFromPush = useCallback(async () => {
    const permissionStatus = await Location.getForegroundPermissionsAsync();
    if (permissionStatus.status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (position?.coords) {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        setLocation(coords);
        await setLastKnownLocation(coords);
        await fetchShelters(coords, { source: 'current' });
        return;
      }
    }

    const last = await loadLastKnownLocation();
    if (last) {
      setLocation(last);
      await fetchShelters(last, { notice: '保存済みの位置で表示しています。', source: 'last' });
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

  useEffect(() => {
    if (location) {
      setMapFocus(null);
    }
  }, [location]);

  const mapRegion = useMemo<ShelterMapRegion>(() => {
    if (mapFocus) return mapFocus;
    if (!location) return DEFAULT_MAP_REGION;
    return {
      latitude: location.lat,
      longitude: location.lon,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }, [location, mapFocus]);

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

  const locationModeLabel = useMemo(() => {
    if (locationMode === 'cache') return 'キャッシュ';
    if (locationMode === 'last') return '最後の位置';
    return '現在地';
  }, [locationMode]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
  const isFavorite = selectedShelterId ? favoriteIds.has(selectedShelterId) : false;

  const handleReseek = useCallback(() => {
    if (location) {
      void fetchShelters(location, { source: 'current' });
      return;
    }
    void refreshFromPush();
  }, [fetchShelters, location, refreshFromPush]);

  const handleSelectShelter = useCallback((shelter: Shelter) => {
    setSelectedShelterId(String(shelter.id));
    setNearbyOpen(true);
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

  const handleFocusMap = useCallback(() => {
    if (!selectedShelter) return;
    if (!Number.isFinite(selectedShelter.lat) || !Number.isFinite(selectedShelter.lon)) return;
    setMapFocus({
      latitude: selectedShelter.lat,
      longitude: selectedShelter.lon,
      latitudeDelta: 0.03,
      longitudeDelta: 0.03,
    });
  }, [selectedShelter]);

  const detailDistance = selectedShelter ? formatDistance(getDistance(selectedShelter)) : null;
  const noticeLabel = notice ?? uiNotice;

  return (
    <TabScreen title="避難ナビ" titleAlign="left" subtitle={locationModeLabel}>
      <View style={styles.mapCard}>
        <View style={[styles.mapWrap, { height: mapHeight }]}>
          <ShelterMap region={mapRegion} markers={mapMarkers} onPressMarker={handleMarkerPress} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>位置情報 {permission === 'granted' ? 'ON' : 'OFF'}</Text>
        </View>
        {permission === 'denied' ? (
          <ErrorState
            message="位置情報の許可が必要です。"
            retryLabel="設定を開く"
            onRetry={() => Linking.openSettings()}
          />
        ) : null}
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
        open={nearbyOpen}
        onToggleOpen={() => setNearbyOpen((prev) => !prev)}
        onRetry={handleReseek}
        onSelect={handleSelectShelter}
        onOpenList={() => router.push('/list')}
      />

      <View style={styles.alertsCard}>
        <Text style={styles.alertsTitle}>警報・注意報</Text>
        <SecondaryButton label="警報を見る" onPress={() => router.push('/alerts')} />
      </View>

      <ShelterDetailSheet
        visible={detailOpen}
        shelter={selectedShelter}
        distanceLabel={detailDistance}
        isFavorite={isFavorite}
        onClose={() => setDetailOpen(false)}
        onToggleFavorite={handleToggleFavorite}
        onFocusMap={handleFocusMap}
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

function formatTime(value: string | null) {
  if (!value) return '不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
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
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  metaText: {
    ...typography.caption,
    color: colors.muted,
  },
  skeletonStack: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  alertsCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  alertsTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.xs,
  },
});
