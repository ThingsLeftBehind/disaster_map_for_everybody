import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { buildCacheKey, checkShelterVersion, fetchJson, fetchJsonWithCache } from '@/src/api/client';
import type {
  Municipality,
  MunicipalitiesResponse,
  Prefecture,
  PrefecturesResponse,
  Shelter,
  SheltersNearbyResponse,
  SheltersSearchResponse,
} from '@/src/api/types';
import { setLastKnownLocation } from '@/src/push/state';
import { Button, Card, Input, Screen, SectionTitle, TextBlock, Toggle } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

type SearchMode = 'LOCATION' | 'AREA' | 'KEYWORD';

type PermissionState = 'unknown' | 'granted' | 'denied';

type LatLng = {
  lat: number;
  lon: number;
};

const DEFAULT_RADIUS_KM = 30;
const DEFAULT_LIMIT = 50;

export default function ListScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>('LOCATION');
  const [useLocation, setUseLocation] = useState(true);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [prefectures, setPrefectures] = useState<Prefecture[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [prefListOpen, setPrefListOpen] = useState(false);
  const [muniListOpen, setMuniListOpen] = useState(false);
  const [prefFilter, setPrefFilter] = useState('');
  const [muniFilter, setMuniFilter] = useState('');
  const [selectedPref, setSelectedPref] = useState<Prefecture | null>(null);
  const [selectedMuni, setSelectedMuni] = useState<Municipality | null>(null);
  const [keyword, setKeyword] = useState('');
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ fromCache: boolean; cachedAt: string | null; updatedAt: string | null } | null>(null);

  const fetchNearby = useCallback(async (coords: LatLng) => {
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
      setShelters(sortShelters(data.items ?? data.sites ?? []));
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
  }, []);

  const ensureLocation = useCallback(async () => {
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
      setLocation(coords);
      await setLastKnownLocation(coords);
      await fetchNearby(coords);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch location');
    }
  }, [fetchNearby]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchJson<PrefecturesResponse>('/api/ref/municipalities');
        if (!active) return;
        setPrefectures(data.prefectures ?? []);
      } catch {
        if (!active) return;
        setPrefectures([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadMuni = async () => {
      if (!selectedPref?.prefCode) {
        setMunicipalities([]);
        return;
      }
      try {
        const data = await fetchJson<MunicipalitiesResponse>(`/api/ref/municipalities?prefCode=${selectedPref.prefCode}`);
        if (!active) return;
        setMunicipalities(data.municipalities ?? []);
      } catch {
        if (!active) return;
        setMunicipalities([]);
      }
    };
    void loadMuni();
    return () => {
      active = false;
    };
  }, [selectedPref?.prefCode]);

  useEffect(() => {
    if (mode !== 'LOCATION' || !useLocation) return;
    void ensureLocation();
  }, [mode, useLocation, ensureLocation]);

  useEffect(() => {
    void checkShelterVersion();
  }, []);

  const fetchByArea = async () => {
    if (!selectedPref?.prefCode) {
      setNotice(null);
      setError('都道府県を選択してください。');
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotice(null);
    setCacheInfo(null);
    try {
      await checkShelterVersion();
      const params = new URLSearchParams({
        mode: 'AREA',
        prefCode: selectedPref.prefCode,
        limit: String(DEFAULT_LIMIT),
      });
      if (selectedMuni?.muniCode) {
        params.set('muniCode', selectedMuni.muniCode);
      }
      const cacheKey = buildCacheKey('/api/shelters/search', params);
      const result = await fetchJsonWithCache<SheltersSearchResponse>(
        `/api/shelters/search?${params.toString()}`,
        {},
        { key: cacheKey, kind: 'search' }
      );
      const data = result.data;
      setShelters(sortShelters(data.items ?? data.sites ?? []));
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

  const fetchByKeyword = async () => {
    if (!keyword.trim()) {
      setNotice(null);
      setError('キーワードを入力してください。');
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotice(null);
    setCacheInfo(null);
    try {
      await checkShelterVersion();
      const params = new URLSearchParams({
        mode: 'KEYWORD',
        q: keyword.trim(),
        limit: String(DEFAULT_LIMIT),
      });
      const cacheKey = buildCacheKey('/api/shelters/search', params);
      const result = await fetchJsonWithCache<SheltersSearchResponse>(
        `/api/shelters/search?${params.toString()}`,
        {},
        { key: cacheKey, kind: 'search' }
      );
      const data = result.data;
      setShelters(sortShelters(data.items ?? data.sites ?? []));
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

  const filteredPrefectures = useMemo(() => {
    if (!prefFilter.trim()) return prefectures;
    return prefectures.filter((p) => p.prefName.includes(prefFilter.trim()));
  }, [prefFilter, prefectures]);

  const filteredMunicipalities = useMemo(() => {
    if (!muniFilter.trim()) return municipalities.slice(0, 80);
    return municipalities.filter((m) => m.muniName.includes(muniFilter.trim())).slice(0, 80);
  }, [muniFilter, municipalities]);

  const mapRegion = useMemo(() => {
    if (useLocation && location) {
      return {
        latitude: location.lat,
        longitude: location.lon,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      };
    }
    const first = shelters.find((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (first) {
      return {
        latitude: first.lat,
        longitude: first.lon,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }
    return null;
  }, [location, shelters, useLocation]);

  const mapShelters = useMemo(
    () => shelters.filter((shelter) => Number.isFinite(shelter.lat) && Number.isFinite(shelter.lon)),
    [shelters]
  );

  const emptyState = !isLoading && !error && shelters.length === 0;

  return (
    <Screen title="List" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>検索モード</SectionTitle>
        <View style={styles.segmentedRow}>
          <ModeButton label="現在地周辺" active={mode === 'LOCATION'} onPress={() => setMode('LOCATION')} />
          <ModeButton label="エリア" active={mode === 'AREA'} onPress={() => setMode('AREA')} />
          <ModeButton label="キーワード" active={mode === 'KEYWORD'} onPress={() => setMode('KEYWORD')} />
        </View>
        <Toggle label={useLocation ? '現在地: ON' : '現在地: OFF'} value={useLocation} onToggle={() => setUseLocation((v) => !v)} />
        {permission === 'denied' && useLocation ? (
          <>
            <TextBlock>位置情報がオフです。現在地検索には許可が必要です。</TextBlock>
            <Button label="設定を開く" variant="secondary" onPress={() => Linking.openSettings()} />
          </>
        ) : null}
        {mode === 'LOCATION' && useLocation && permission !== 'denied' ? (
          <Button label="周辺を再検索" variant="secondary" onPress={() => (location ? fetchNearby(location) : ensureLocation())} />
        ) : null}
      </Card>

      {mode === 'AREA' ? (
        <Card>
          <SectionTitle>エリア選択</SectionTitle>
          <Button
            label={selectedPref ? `都道府県: ${selectedPref.prefName}` : '都道府県を選択'}
            variant="secondary"
            onPress={() => setPrefListOpen((v) => !v)}
          />
          {prefListOpen ? (
            <>
              <Input value={prefFilter} placeholder="都道府県を絞り込み" onChangeText={setPrefFilter} />
              <View style={styles.listWrap}>
                {filteredPrefectures.map((pref) => (
                  <Pressable
                    key={pref.prefCode}
                    style={styles.listItem}
                    onPress={() => {
                      setSelectedPref(pref);
                      setSelectedMuni(null);
                      setPrefListOpen(false);
                    }}
                  >
                    <TextBlock>{pref.prefName}</TextBlock>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Button
            label={selectedMuni ? `市区町村: ${selectedMuni.muniName}` : '市区町村を選択 (任意)'}
            variant="secondary"
            onPress={() => setMuniListOpen((v) => !v)}
          />
          {muniListOpen ? (
            <>
              <Input value={muniFilter} placeholder="市区町村を絞り込み" onChangeText={setMuniFilter} />
              <View style={styles.listWrap}>
                {filteredMunicipalities.map((muni) => (
                  <Pressable
                    key={muni.muniCode}
                    style={styles.listItem}
                    onPress={() => {
                      setSelectedMuni(muni);
                      setMuniListOpen(false);
                    }}
                  >
                    <TextBlock>{muni.muniName}</TextBlock>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Button label="検索" onPress={fetchByArea} />
        </Card>
      ) : null}

      {mode === 'KEYWORD' ? (
        <Card>
          <SectionTitle>キーワード検索</SectionTitle>
          <Input value={keyword} placeholder="例: 体育館, 公民館" onChangeText={setKeyword} />
          <Button label="検索" onPress={fetchByKeyword} />
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        </Card>
      ) : null}

      {notice ? (
        <Card>
          <TextBlock muted>{notice}</TextBlock>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <TextBlock muted>{error}</TextBlock>
        </Card>
      ) : null}

      {mapRegion ? (
        <Card>
          <SectionTitle>地図</SectionTitle>
          <View style={styles.mapWrap}>
            <MapView style={styles.map} region={mapRegion}>
              {useLocation && location ? (
                <Marker
                  coordinate={{ latitude: location.lat, longitude: location.lon }}
                  title="現在地"
                  pinColor={colors.text}
                />
              ) : null}
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
        <SectionTitle>検索結果</SectionTitle>
        {cacheInfo?.fromCache ? (
          <TextBlock muted>キャッシュ表示 · 最終更新: {formatTime(cacheInfo.updatedAt ?? cacheInfo.cachedAt)}</TextBlock>
        ) : null}
        {shelters.map((shelter) => (
          <Button
            key={String(shelter.id)}
            label={`${shelter.name ?? '避難所'} · ${formatDistance(getDistance(shelter))}`}
            variant="secondary"
            onPress={() => router.push(`/shelter/${shelter.id}`)}
          />
        ))}
        {emptyState ? <TextBlock muted>該当する避難所が見つかりませんでした。</TextBlock> : null}
      </Card>
    </Screen>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active ? styles.modeButtonActive : styles.modeButtonIdle]}>
      <Text style={[styles.modeButtonText, active ? styles.modeButtonTextActive : styles.modeButtonTextIdle]}>{label}</Text>
    </Pressable>
  );
}

function sortShelters(items: Shelter[]) {
  return items
    .slice()
    .sort((a, b) => getDistance(a) - getDistance(b) || String(a.id).localeCompare(String(b.id)));
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
  segmentedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  modeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
  },
  modeButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  modeButtonIdle: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.background,
  },
  modeButtonTextIdle: {
    color: colors.text,
  },
  mapWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: {
    height: 220,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  listWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.md,
    maxHeight: 240,
  },
  listItem: {
    paddingVertical: spacing.xs,
  },
});
