import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { buildCacheKey, checkShelterVersion, fetchJsonWithCache } from '@/src/api/client';
import type { SheltersNearbyResponse, Shelter } from '@/src/api/types';
import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

type PermissionState = 'unknown' | 'granted' | 'denied';

type LatLng = {
  lat: number;
  lon: number;
};

const DEFAULT_RADIUS_KM = 20;
const DEFAULT_LIMIT = 20;

export default function MainScreen() {
  const router = useRouter();
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ fromCache: boolean; cachedAt: string | null; updatedAt: string | null } | null>(null);

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
        setIsLocating(false);
        await fetchShelters(coords);
      } catch (err) {
        if (!active) return;
        setIsLocating(false);
        setError(err instanceof Error ? err.message : 'Failed to fetch location');
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void checkShelterVersion();
  }, []);

  const fetchShelters = async (coords: LatLng) => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
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
      if (!result.fromCache && data.fetchStatus !== 'OK') {
        setNotice(data.lastError ?? '更新が遅れています');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shelters');
      setShelters([]);
    } finally {
      setIsLoading(false);
    }
  };

  const mapRegion = useMemo(() => {
    if (!location) return null;
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

  const emptyState = !isLoading && !error && shelters.length === 0 && permission === 'granted' && location;

  return (
    <Screen title="Main" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>現在地周辺</SectionTitle>
        {permission === 'denied' ? (
          <>
            <TextBlock>位置情報がオフになっています。周辺の避難所を表示できません。</TextBlock>
            <Button label="設定を開く" onPress={() => Linking.openSettings()} variant="secondary" />
          </>
        ) : null}
        {permission !== 'denied' && (isLocating || isLoading) ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        ) : null}
        {error ? <TextBlock muted>{error}</TextBlock> : null}
        {cacheInfo?.fromCache ? (
          <TextBlock muted>キャッシュ表示 · 最終更新: {formatTime(cacheInfo.updatedAt ?? cacheInfo.cachedAt)}</TextBlock>
        ) : null}
        {notice ? <TextBlock muted>{notice}</TextBlock> : null}
        {emptyState ? <TextBlock muted>近くの避難所が見つかりませんでした。</TextBlock> : null}
        {permission === 'granted' && location ? (
          <Button label="再検索" variant="secondary" onPress={() => fetchShelters(location)} />
        ) : null}
      </Card>

      {mapRegion ? (
        <Card>
          <SectionTitle>地図</SectionTitle>
          <View style={styles.mapWrap}>
            <MapView style={styles.map} region={mapRegion}>
              <Marker
                coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }}
                title="現在地"
                pinColor={colors.text}
              />
              {mapShelters.map((shelter) => (
                <Marker
                  key={String(shelter.id)}
                  coordinate={{ latitude: shelter.lat, longitude: shelter.lon }}
                  title={shelter.name ?? '避難所'}
                  description={shelter.address ?? ''}
                  onPress={() => router.push(`/shelter/${shelter.id}`)}
                />
              ))}
            </MapView>
          </View>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>近くの避難所</SectionTitle>
        {shelters.map((shelter) => (
          <Button
            key={String(shelter.id)}
            label={`${shelter.name ?? '避難所'} · ${formatDistance(getDistance(shelter))}`}
            variant="secondary"
            onPress={() => router.push(`/shelter/${shelter.id}`)}
          />
        ))}
        {shelters.length === 0 && permission === 'granted' && !isLoading ? (
          <TextBlock muted>近くの避難所が見つかりませんでした。</TextBlock>
        ) : null}
      </Card>
    </Screen>
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
  mapWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: {
    height: 240,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
