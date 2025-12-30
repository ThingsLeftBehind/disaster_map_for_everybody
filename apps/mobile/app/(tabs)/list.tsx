import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import {
  buildCacheKey,
  checkShelterVersion,
  fetchJson,
  fetchJsonWithCache,
  toApiError,
  type ApiError,
} from '@/src/api/client';
import type {
  Municipality,
  MunicipalitiesResponse,
  Prefecture,
  PrefecturesResponse,
  Shelter,
  SheltersNearbyResponse,
  SheltersSearchResponse,
} from '@/src/api/types';
import { ShelterMap, type ShelterMapRegion, type ShelterMarker } from '@/src/map/ShelterMap';
import { setLastKnownLocation } from '@/src/push/state';
import { clearShelterCache } from '@/src/storage/shelterCache';
import { Chip, EmptyState, PrimaryButton, SecondaryButton, Skeleton, TabScreen, TextField } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';

const DEFAULT_RADIUS_KM = 30;
const DEFAULT_LIMIT = 50;
const LIMIT_OPTIONS = [20, 30, 40, 50];
const RADIUS_OPTIONS = [5, 10, 20, 30, 40, 50];
const SAVED_LIMIT = 5;
const SAVED_STORAGE_KEY = 'hinanavi_saved_shelters_v1';

const DEFAULT_MAP_REGION: ShelterMapRegion = {
  latitude: 35.6812,
  longitude: 139.7671,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

type SearchMode = 'LOCATION' | 'AREA' | 'KEYWORD';

type ViewMode = 'list' | 'map';

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

type HazardKey =
  | 'flood'
  | 'landslide'
  | 'storm_surge'
  | 'earthquake'
  | 'tsunami'
  | 'large_fire'
  | 'inland_flood'
  | 'volcano';

type FilterState = {
  hazardKeys: HazardKey[];
  radiusKm: number;
  limit: number;
  includeIneligible: boolean;
};

type SavedShelter = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  distance: number | null;
  hazards: Record<string, boolean> | null;
};

const HAZARD_OPTIONS: { key: HazardKey; label: string }[] = [
  { key: 'flood', label: '洪水' },
  { key: 'landslide', label: '土砂災害' },
  { key: 'storm_surge', label: '高潮' },
  { key: 'earthquake', label: '地震' },
  { key: 'tsunami', label: '津波' },
  { key: 'large_fire', label: '大規模火災' },
  { key: 'inland_flood', label: '内水氾濫' },
  { key: 'volcano', label: '火山' },
];

const DEFAULT_FILTERS: FilterState = {
  hazardKeys: [],
  radiusKm: DEFAULT_RADIUS_KM,
  limit: DEFAULT_LIMIT,
  includeIneligible: false,
};

export default function ListScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const [mode, setMode] = useState<SearchMode>('LOCATION');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [prefError, setPrefError] = useState<ApiError | null>(null);
  const [muniError, setMuniError] = useState<ApiError | null>(null);
  const [prefLoading, setPrefLoading] = useState(false);
  const [muniLoading, setMuniLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterDraft, setFilterDraft] = useState<FilterState>(DEFAULT_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [focusedShelterId, setFocusedShelterId] = useState<string | null>(null);
  const [savedShelters, setSavedShelters] = useState<SavedShelter[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as SavedShelter[];
        if (!active || !Array.isArray(parsed)) return;
        setSavedShelters(parsed.filter((item) => item && typeof item.id === 'string'));
      } catch {
        if (!active) return;
        setSavedShelters([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedShelters));
  }, [savedShelters]);

  const fetchNearby = useCallback(async (coords: LatLng, activeFilters: FilterState) => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    setUiNotice(null);
    setCacheInfo(null);
    try {
      await checkShelterVersion();
      const params = new URLSearchParams({
        lat: coords.lat.toString(),
        lon: coords.lon.toString(),
        limit: String(activeFilters.limit),
        radiusKm: String(activeFilters.radiusKm),
        hideIneligible: String(!activeFilters.includeIneligible),
      });
      if (activeFilters.hazardKeys.length > 0) {
        params.set('hazardTypes', activeFilters.hazardKeys.join(','));
      }
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
      setError(toApiError(err));
      setShelters([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const ensureLocation = useCallback(
    async (activeFilters: FilterState) => {
      setError(null);
      setUiNotice(null);
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
        await fetchNearby(coords, activeFilters);
      } catch (err) {
        setError(toApiError(err));
      }
    },
    [fetchNearby]
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      setPrefLoading(true);
      setPrefError(null);
      try {
        const data = await fetchJson<PrefecturesResponse>('/api/ref/municipalities');
        if (!active) return;
        setPrefectures(data.prefectures ?? []);
      } catch (err) {
        if (!active) return;
        setPrefectures([]);
        setPrefError(toApiError(err));
      } finally {
        if (active) setPrefLoading(false);
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
      setMuniLoading(true);
      setMuniError(null);
      try {
        const data = await fetchJson<MunicipalitiesResponse>(
          `/api/ref/municipalities?prefCode=${selectedPref.prefCode}`
        );
        if (!active) return;
        setMunicipalities(data.municipalities ?? []);
      } catch (err) {
        if (!active) return;
        setMunicipalities([]);
        setMuniError(toApiError(err));
      } finally {
        if (active) setMuniLoading(false);
      }
    };
    void loadMuni();
    return () => {
      active = false;
    };
  }, [selectedPref?.prefCode]);

  useEffect(() => {
    if (mode !== 'LOCATION' || !useLocation) return;
    void ensureLocation(filters);
  }, [mode, useLocation, ensureLocation]);

  useEffect(() => {
    void checkShelterVersion();
  }, []);

  const fetchByArea = useCallback(
    async (activeFilters: FilterState) => {
      if (!selectedPref?.prefCode) {
        setNotice(null);
        setError({ message: '都道府県を選択してください。', status: null, kind: 'unknown' });
        return;
      }
      setIsLoading(true);
      setError(null);
      setNotice(null);
      setUiNotice(null);
      setCacheInfo(null);
      try {
        await checkShelterVersion();
        const params = new URLSearchParams({
          mode: 'AREA',
          prefCode: selectedPref.prefCode,
          limit: String(activeFilters.limit),
          radiusKm: String(activeFilters.radiusKm),
          hideIneligible: String(!activeFilters.includeIneligible),
          includeHazardless: String(activeFilters.includeIneligible),
        });
        if (selectedMuni?.muniCode) {
          params.set('muniCode', selectedMuni.muniCode);
        }
        if (activeFilters.hazardKeys.length > 0) {
          params.set('hazardTypes', activeFilters.hazardKeys.join(','));
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
        setError(toApiError(err));
        setShelters([]);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedMuni?.muniCode, selectedPref?.prefCode]
  );

  const fetchByKeyword = useCallback(
    async (activeFilters: FilterState) => {
      if (!keyword.trim()) {
        setNotice(null);
        setError({ message: 'キーワードを入力してください。', status: null, kind: 'unknown' });
        return;
      }
      setIsLoading(true);
      setError(null);
      setNotice(null);
      setUiNotice(null);
      setCacheInfo(null);
      try {
        await checkShelterVersion();
        const params = new URLSearchParams({
          mode: 'KEYWORD',
          q: keyword.trim(),
          limit: String(activeFilters.limit),
          radiusKm: String(activeFilters.radiusKm),
          hideIneligible: String(!activeFilters.includeIneligible),
          includeHazardless: String(activeFilters.includeIneligible),
        });
        if (activeFilters.hazardKeys.length > 0) {
          params.set('hazardTypes', activeFilters.hazardKeys.join(','));
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
        setError(toApiError(err));
        setShelters([]);
      } finally {
        setIsLoading(false);
      }
    },
    [keyword]
  );

  const runSearch = useCallback(
    async (activeFilters: FilterState) => {
      if (mode === 'LOCATION') {
        if (!useLocation) {
          setError({ message: '位置情報がオフです。', status: null, kind: 'unknown' });
          return;
        }
        if (location) {
          await fetchNearby(location, activeFilters);
          return;
        }
        await ensureLocation(activeFilters);
        return;
      }
      if (mode === 'AREA') {
        await fetchByArea(activeFilters);
        return;
      }
      await fetchByKeyword(activeFilters);
    },
    [fetchByArea, fetchByKeyword, fetchNearby, location, mode, useLocation, ensureLocation]
  );

  const filteredPrefectures = useMemo(() => {
    if (!prefFilter.trim()) return prefectures;
    return prefectures.filter((p) => p.prefName.includes(prefFilter.trim()));
  }, [prefFilter, prefectures]);

  const filteredMunicipalities = useMemo(() => {
    if (!muniFilter.trim()) return municipalities.slice(0, 80);
    return municipalities.filter((m) => m.muniName.includes(muniFilter.trim())).slice(0, 80);
  }, [muniFilter, municipalities]);

  const focusedShelter = useMemo(() => {
    if (!focusedShelterId) return null;
    return shelters.find((shelter) => String(shelter.id) === focusedShelterId) ?? null;
  }, [focusedShelterId, shelters]);

  const mapRegion = useMemo<ShelterMapRegion>(() => {
    if (viewMode === 'map' && focusedShelter && Number.isFinite(focusedShelter.lat) && Number.isFinite(focusedShelter.lon)) {
      return {
        latitude: focusedShelter.lat,
        longitude: focusedShelter.lon,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }
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
    return DEFAULT_MAP_REGION;
  }, [focusedShelter, location, shelters, useLocation, viewMode]);

  const mapShelters = useMemo(
    () => shelters.filter((shelter) => Number.isFinite(shelter.lat) && Number.isFinite(shelter.lon)),
    [shelters]
  );

  const mapMarkers = useMemo<ShelterMarker[]>(() => {
    const markers: ShelterMarker[] = [];
    if (useLocation && location) {
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
  }, [location, mapShelters, useLocation]);

  const emptyState = !isLoading && !error && shelters.length === 0;
  const cacheLabel = cacheInfo?.cachedAt ?? cacheInfo?.updatedAt;

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (mode === 'LOCATION') {
      parts.push(useLocation ? '現在地周辺' : '現在地オフ');
    } else if (mode === 'AREA') {
      const prefLabel = selectedPref?.prefName ?? 'エリア未選択';
      const muniLabel = selectedMuni?.muniName ? ` ${selectedMuni.muniName}` : '';
      parts.push(`${prefLabel}${muniLabel}`);
    } else {
      parts.push(keyword.trim() ? `キーワード: ${keyword.trim()}` : 'キーワード未入力');
    }
    parts.push(`半径${filters.radiusKm}km`);
    return parts.join(' / ');
  }, [filters.radiusKm, keyword, mode, selectedMuni?.muniName, selectedPref?.prefName, useLocation]);

  const filterCount = useMemo(() => {
    let count = filters.hazardKeys.length;
    if (filters.radiusKm !== DEFAULT_RADIUS_KM) count += 1;
    if (filters.limit !== DEFAULT_LIMIT) count += 1;
    if (filters.includeIneligible) count += 1;
    return count;
  }, [filters]);

  const savedIds = useMemo(() => new Set(savedShelters.map((item) => item.id)), [savedShelters]);

  const openFilterSheet = useCallback(() => {
    setFilterDraft(filters);
    setFilterOpen(true);
  }, [filters]);

  const applyFilters = useCallback(async () => {
    setFilters(filterDraft);
    setFilterOpen(false);
    await runSearch(filterDraft);
  }, [filterDraft, runSearch]);

  const resetFilters = useCallback(() => {
    setFilterDraft(DEFAULT_FILTERS);
  }, []);

  const handleToggleHazard = useCallback((key: HazardKey) => {
    setFilterDraft((prev) => {
      const exists = prev.hazardKeys.includes(key);
      return {
        ...prev,
        hazardKeys: exists ? prev.hazardKeys.filter((item) => item !== key) : [...prev.hazardKeys, key],
      };
    });
  }, []);

  const handleUpdateRadius = useCallback((next: number) => {
    setFilterDraft((prev) => ({ ...prev, radiusKm: next }));
  }, []);

  const handleUpdateLimit = useCallback((next: number) => {
    setFilterDraft((prev) => ({ ...prev, limit: next }));
  }, []);

  const handleToggleIneligible = useCallback(() => {
    setFilterDraft((prev) => ({ ...prev, includeIneligible: !prev.includeIneligible }));
  }, []);

  const handleRetry = useCallback(() => {
    void runSearch(filters);
  }, [filters, runSearch]);

  const handleClearCache = useCallback(async () => {
    await clearShelterCache();
    setCacheInfo(null);
    setUiNotice('キャッシュを削除しました。');
  }, []);

  const handleToggleSave = useCallback((shelter: Shelter) => {
    setUiNotice(null);
    setSavedShelters((prev) => {
      const id = String(shelter.id);
      const exists = prev.some((item) => item.id === id);
      if (exists) {
        return prev.filter((item) => item.id !== id);
      }
      if (prev.length >= SAVED_LIMIT) {
        setUiNotice(`保存は最大${SAVED_LIMIT}件までです。`);
        return prev;
      }
      return [...prev, toSavedShelter(shelter)];
    });
  }, []);

  const handleOpenSaved = useCallback(() => {
    setSavedOpen(true);
  }, []);

  const handleRemoveSaved = useCallback((id: string) => {
    setSavedShelters((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleSelectSaved = useCallback(
    (id: string) => {
      setSavedOpen(false);
      router.push(`/shelter/${id}`);
    },
    [router]
  );

  const handleFocusMap = useCallback((shelter: Shelter) => {
    setFocusedShelterId(String(shelter.id));
    setViewMode('map');
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <TabScreen title="避難所">
      <View style={styles.topBar}>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <SearchModeBar mode={mode} onChange={setMode} />

      <View style={styles.modePanel}>
        {mode === 'LOCATION' ? (
          <>
            <View style={styles.inlineRow}>
              <Text style={styles.inlineLabel}>位置情報</Text>
              <View style={styles.toggleGroup}>
                <Pressable
                  style={[styles.toggleButton, useLocation ? styles.toggleButtonActive : null]}
                  onPress={() => setUseLocation(true)}
                >
                  <Text style={[styles.toggleText, useLocation ? styles.toggleTextActive : null]}>ON</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleButton, !useLocation ? styles.toggleButtonActive : null]}
                  onPress={() => setUseLocation(false)}
                >
                  <Text style={[styles.toggleText, !useLocation ? styles.toggleTextActive : null]}>OFF</Text>
                </Pressable>
              </View>
            </View>
            {permission === 'denied' && useLocation ? (
              <InlineBanner
                message="位置情報がオフです。"
                actionLabel="設定を開く"
                onAction={() => Linking.openSettings()}
              />
            ) : null}
            <SecondaryButton
              label={location ? '再検索' : '現在地を取得'}
              onPress={() => (location ? fetchNearby(location, filters) : ensureLocation(filters))}
            />
          </>
        ) : null}

        {mode === 'AREA' ? (
          <>
            <Pressable style={styles.selectorRow} onPress={() => setPrefListOpen(true)}>
              <Text style={styles.selectorLabel}>都道府県</Text>
              <Text style={styles.selectorValue}>{selectedPref?.prefName ?? '選択してください'}</Text>
            </Pressable>
            <Pressable style={styles.selectorRow} onPress={() => setMuniListOpen(true)}>
              <Text style={styles.selectorLabel}>市区町村</Text>
              <Text style={styles.selectorValue}>{selectedMuni?.muniName ?? '未選択'}</Text>
            </Pressable>
            <PrimaryButton label="検索" onPress={() => void fetchByArea(filters)} />
          </>
        ) : null}

        {mode === 'KEYWORD' ? (
          <>
            <TextField value={keyword} placeholder="例: 体育館, 公民館" onChangeText={setKeyword} />
            <PrimaryButton label="検索" onPress={() => void fetchByKeyword(filters)} />
          </>
        ) : null}
      </View>

      <View style={styles.controlRow}>
        <Pressable style={styles.filterButton} onPress={openFilterSheet}>
          <Text style={styles.filterText}>{filterCount > 0 ? `フィルタ (${filterCount})` : 'フィルタ'}</Text>
        </Pressable>
        <View style={styles.viewToggle}>
          <Pressable
            style={[styles.viewToggleButton, viewMode === 'list' ? styles.viewToggleActive : null]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'list' ? styles.viewToggleTextActive : null]}>リスト</Text>
          </Pressable>
          <Pressable
            style={[styles.viewToggleButton, viewMode === 'map' ? styles.viewToggleActive : null]}
            onPress={() => setViewMode('map')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'map' ? styles.viewToggleTextActive : null]}>地図</Text>
          </Pressable>
        </View>
      </View>

      {viewMode === 'map' ? (
        <View style={styles.mapSection}>
          {error ? <InlineBanner message="取得できませんでした。" actionLabel="再試行" onAction={handleRetry} /> : null}
          {isLoading ? <MapSkeleton /> : null}
          {!isLoading ? (
            Platform.OS === 'web' ? (
              <View style={styles.mapFallback}>
                <Text style={styles.mapFallbackTitle}>地図はこの端末では簡易表示です。</Text>
                <Text style={styles.mapFallbackText}>リスト表示をご利用ください。</Text>
              </View>
            ) : (
              <View style={styles.mapWrap}>
                <ShelterMap
                  region={mapRegion}
                  markers={mapMarkers}
                  onPressMarker={(id: string) => {
                    if (id === 'current') return;
                    router.push(`/shelter/${id}`);
                  }}
                />
              </View>
            )
          ) : null}
          <View style={styles.mapActions}>
            <SecondaryButton label="この条件で検索" onPress={() => void runSearch(filters)} />
          </View>
        </View>
      ) : (
        <View style={styles.resultsSection}>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {cacheLabel ? `キャッシュ: ${formatTime(cacheLabel)}（オフライン時に利用）` : 'キャッシュなし'}
            </Text>
            <View style={styles.metaActions}>
              <Pressable style={styles.metaButton} onPress={handleClearCache}>
                <Text style={styles.metaButtonText}>キャッシュ削除</Text>
              </Pressable>
              <Pressable style={styles.metaButton} onPress={handleOpenSaved}>
                <Text style={styles.metaButtonText}>保存一覧 {savedShelters.length}/{SAVED_LIMIT}</Text>
              </Pressable>
            </View>
          </View>
          {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
          {uiNotice ? <Text style={styles.noticeText}>{uiNotice}</Text> : null}
          {error ? <InlineBanner message="取得できませんでした。" actionLabel="再試行" onAction={handleRetry} /> : null}
          {isLoading ? <ListSkeleton /> : null}
          {emptyState ? <EmptyState message="該当する避難所が見つかりませんでした。" /> : null}
          {!isLoading ? (
            <ShelterList
              shelters={shelters}
              selectedHazards={filters.hazardKeys}
              savedIds={savedIds}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              onToggleSave={handleToggleSave}
              onFocusMap={handleFocusMap}
              onOpenDetail={(id) => router.push(`/shelter/${id}`)}
            />
          ) : null}
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        draft={filterDraft}
        onToggleHazard={handleToggleHazard}
        onUpdateRadius={handleUpdateRadius}
        onUpdateLimit={handleUpdateLimit}
        onToggleIneligible={handleToggleIneligible}
        onReset={resetFilters}
        onApply={applyFilters}
      />

      <SavedSheltersSheet
        visible={savedOpen}
        onClose={() => setSavedOpen(false)}
        items={savedShelters}
        onRemove={handleRemoveSaved}
        onSelect={handleSelectSaved}
      />

      <PickerModal
        visible={prefListOpen}
        title="都道府県を選択"
        filterValue={prefFilter}
        onChangeFilter={setPrefFilter}
        items={filteredPrefectures.map((pref) => ({ id: pref.prefCode, label: pref.prefName }))}
        isLoading={prefLoading}
        error={prefError}
        onClose={() => setPrefListOpen(false)}
        onSelect={(id) => {
          const pref = prefectures.find((p) => p.prefCode === id) ?? null;
          setSelectedPref(pref);
          setSelectedMuni(null);
          setPrefListOpen(false);
        }}
      />
      <PickerModal
        visible={muniListOpen}
        title="市区町村を選択"
        filterValue={muniFilter}
        onChangeFilter={setMuniFilter}
        items={filteredMunicipalities.map((muni) => ({ id: muni.muniCode, label: muni.muniName }))}
        isLoading={muniLoading}
        error={muniError}
        onClose={() => setMuniListOpen(false)}
        onSelect={(id) => {
          const muni = municipalities.find((m) => m.muniCode === id) ?? null;
          setSelectedMuni(muni);
          setMuniListOpen(false);
        }}
      />
    </TabScreen>
  );
}

function SearchModeBar({ mode, onChange }: { mode: SearchMode; onChange: (next: SearchMode) => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.segmentedControl}>
      {(
        [
          { value: 'LOCATION', label: '現在地' },
          { value: 'AREA', label: 'エリア' },
          { value: 'KEYWORD', label: 'キーワード' },
        ] as const
      ).map((item) => (
        <Pressable
          key={item.value}
          style={[styles.segmentButton, mode === item.value ? styles.segmentButtonActive : null]}
          onPress={() => onChange(item.value)}
        >
          <Text style={[styles.segmentText, mode === item.value ? styles.segmentTextActive : null]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ShelterList({
  shelters,
  selectedHazards,
  savedIds,
  expandedIds,
  onToggleExpand,
  onToggleSave,
  onFocusMap,
  onOpenDetail,
}: {
  shelters: Shelter[];
  selectedHazards: HazardKey[];
  savedIds: Set<string>;
  expandedIds: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onToggleSave: (shelter: Shelter) => void;
  onFocusMap: (shelter: Shelter) => void;
  onOpenDetail: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.listStack}>
      {shelters.map((shelter) => (
        <ShelterCard
          key={String(shelter.id)}
          shelter={shelter}
          selectedHazards={selectedHazards}
          saved={savedIds.has(String(shelter.id))}
          expanded={!!expandedIds[String(shelter.id)]}
          onToggleExpand={() => onToggleExpand(String(shelter.id))}
          onToggleSave={() => onToggleSave(shelter)}
          onFocusMap={() => onFocusMap(shelter)}
          onOpenDetail={() => onOpenDetail(String(shelter.id))}
        />
      ))}
    </View>
  );
}

function ShelterCard({
  shelter,
  selectedHazards,
  saved,
  expanded,
  onToggleExpand,
  onToggleSave,
  onFocusMap,
  onOpenDetail,
}: {
  shelter: Shelter;
  selectedHazards: HazardKey[];
  saved: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleSave: () => void;
  onFocusMap: () => void;
  onOpenDetail: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const hazardBadges = getShelterHazardBadges(shelter, selectedHazards);
  const distanceLabel = formatDistance(getDistance(shelter));

  return (
    <View style={styles.card}>
      <Pressable onPress={onToggleExpand} style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{shelter.name ?? '避難所'}</Text>
          <Text style={styles.cardAddress} numberOfLines={1} ellipsizeMode="tail">
            {shelter.address ?? '住所不明'}
          </Text>
          {hazardBadges.length > 0 ? (
            <View style={styles.badgeRow}>
              {hazardBadges.map((label) => (
                <View key={label} style={styles.badge}>
                  <Text style={styles.badgeText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.badgeEmpty}>ハザード情報なし</Text>
          )}
        </View>
        <Text style={styles.cardDistance}>{distanceLabel}</Text>
      </Pressable>
      <View style={styles.cardActions}>
        <Pressable style={styles.actionButton} onPress={onFocusMap}>
          <Text style={styles.actionText}>地図</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, saved ? styles.actionButtonActive : null]} onPress={onToggleSave}>
          <Text style={[styles.actionText, saved ? styles.actionTextActive : null]}>{saved ? '保存済み' : '保存'}</Text>
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.cardDetail}>
          <Text style={styles.detailLabel}>対応ハザード</Text>
          <Text style={styles.detailText}>{formatHazardList(shelter) ?? '情報なし'}</Text>
          {shelter.notes ? (
            <>
              <Text style={styles.detailLabel}>メモ</Text>
              <Text style={styles.detailText}>{shelter.notes}</Text>
            </>
          ) : null}
          <Pressable onPress={onOpenDetail} style={styles.detailButton}>
            <Text style={styles.detailButtonText}>詳細を見る</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FilterSheet({
  visible,
  onClose,
  draft,
  onToggleHazard,
  onUpdateRadius,
  onUpdateLimit,
  onToggleIneligible,
  onReset,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  draft: FilterState;
  onToggleHazard: (key: HazardKey) => void;
  onUpdateRadius: (next: number) => void;
  onUpdateLimit: (next: number) => void;
  onToggleIneligible: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 60 && gesture.vy >= 0.3) onClose();
        },
      }),
    [onClose]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard} {...panResponder.panHandlers}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>フィルタ</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>閉じる</Text>
            </Pressable>
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>ハザード対応</Text>
            <View style={styles.hazardGrid}>
              {HAZARD_OPTIONS.map((item) => (
                <Chip
                  key={item.key}
                  label={item.label}
                  selected={draft.hazardKeys.includes(item.key)}
                  onPress={() => onToggleHazard(item.key)}
                />
              ))}
            </View>
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>候補数</Text>
            <Stepper
              value={draft.limit}
              options={LIMIT_OPTIONS}
              onChange={onUpdateLimit}
              unit="件"
            />
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>半径（km）</Text>
            <Stepper
              value={draft.radiusKm}
              options={RADIUS_OPTIONS}
              onChange={onUpdateRadius}
              unit="km"
            />
          </View>

          <View style={styles.sheetSection}>
            <Pressable style={styles.checkboxRow} onPress={onToggleIneligible}>
              <View style={[styles.checkbox, draft.includeIneligible ? styles.checkboxChecked : null]}>
                <View style={draft.includeIneligible ? styles.checkboxDot : null} />
              </View>
              <Text style={styles.checkboxLabel}>不適合も含める</Text>
            </Pressable>
          </View>

          <View style={styles.sheetFooter}>
            <SecondaryButton label="リセット" onPress={onReset} />
            <PrimaryButton label="適用" onPress={onApply} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SavedSheltersSheet({
  visible,
  onClose,
  items,
  onRemove,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  items: SavedShelter[];
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 60 && gesture.vy >= 0.3) onClose();
        },
      }),
    [onClose]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard} {...panResponder.panHandlers}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>保存一覧</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>閉じる</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            {items.length === 0 ? (
              <Text style={styles.sheetEmpty}>保存済みの避難所はありません。</Text>
            ) : null}
            {items.map((item) => (
              <View key={item.id} style={styles.savedRow}>
                <Pressable style={styles.savedText} onPress={() => onSelect(item.id)}>
                  <Text style={styles.savedTitle}>{item.name}</Text>
                  <Text style={styles.savedAddress} numberOfLines={1}>
                    {item.address ?? '住所不明'}
                  </Text>
                </Pressable>
                <Pressable style={styles.savedRemove} onPress={() => onRemove(item.id)}>
                  <Text style={styles.savedRemoveText}>削除</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerModal({
  visible,
  title,
  filterValue,
  onChangeFilter,
  items,
  isLoading,
  error,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  filterValue: string;
  onChangeFilter: (value: string) => void;
  items: { id: string; label: string }[];
  isLoading: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>閉じる</Text>
            </Pressable>
          </View>
          <TextField value={filterValue} placeholder="絞り込み" onChangeText={onChangeFilter} />
          {isLoading ? (
            <View style={styles.skeletonStack}>
              <Skeleton height={14} />
              <Skeleton width="70%" />
            </View>
          ) : null}
          {error ? <InlineBanner message="取得できませんでした。" /> : null}
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            {items.map((item) => (
              <Pressable key={item.id} onPress={() => onSelect(item.id)} style={styles.modalItem}>
                <Text style={styles.modalItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InlineBanner({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      {actionLabel && onAction ? <SecondaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

function Stepper({
  value,
  options,
  onChange,
  unit,
}: {
  value: number;
  options: number[];
  onChange: (next: number) => void;
  unit: string;
}) {
  const styles = useThemedStyles(createStyles);
  const index = options.indexOf(value);
  const canDown = index > 0;
  const canUp = index >= 0 && index < options.length - 1;

  return (
    <View style={styles.stepperRow}>
      <Pressable
        style={[styles.stepperButton, !canDown ? styles.stepperDisabled : null]}
        onPress={() => (canDown ? onChange(options[index - 1]) : null)}
      >
        <Text style={styles.stepperButtonText}>-</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{`${value}${unit}`}</Text>
      <Pressable
        style={[styles.stepperButton, !canUp ? styles.stepperDisabled : null]}
        onPress={() => (canUp ? onChange(options[index + 1]) : null)}
      >
        <Text style={styles.stepperButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

function ListSkeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <Skeleton width="60%" />
          <Skeleton width="80%" />
          <Skeleton width="40%" />
        </View>
      ))}
    </View>
  );
}

function MapSkeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.mapSkeleton}>
      <Skeleton width="70%" />
      <Skeleton width="40%" />
    </View>
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

function toSavedShelter(shelter: Shelter): SavedShelter {
  return {
    id: String(shelter.id),
    name: shelter.name ?? '避難所',
    address: shelter.address ?? null,
    lat: Number.isFinite(shelter.lat) ? shelter.lat : null,
    lon: Number.isFinite(shelter.lon) ? shelter.lon : null,
    distance: Number.isFinite(getDistance(shelter)) ? getDistance(shelter) : null,
    hazards: shelter.hazards ?? null,
  };
}

function getShelterHazardBadges(shelter: Shelter, selected: HazardKey[]) {
  const flags = shelter.hazards ?? {};
  if (selected.length > 0) {
    return selected.filter((key) => Boolean(flags?.[key])).map((key) => hazardLabel(key));
  }
  const active = HAZARD_OPTIONS.filter((option) => Boolean(flags?.[option.key]));
  return active.slice(0, 2).map((option) => option.label);
}

function formatHazardList(shelter: Shelter) {
  const flags = shelter.hazards ?? {};
  const labels = HAZARD_OPTIONS.filter((option) => Boolean(flags?.[option.key])).map((option) => option.label);
  if (labels.length === 0) return null;
  return labels.join(' / ');
}

function hazardLabel(key: HazardKey) {
  return HAZARD_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surface: string;
  surfaceStrong: string;
}) =>
  StyleSheet.create({
  topBar: {
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.background,
  },
  segmentText: {
    ...typography.caption,
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  modePanel: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  inlineLabel: {
    ...typography.label,
    color: colors.text,
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleText: {
    ...typography.caption,
    color: colors.text,
  },
  toggleTextActive: {
    color: colors.background,
  },
  selectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  selectorLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  selectorValue: {
    ...typography.body,
    color: colors.text,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  filterButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filterText: {
    ...typography.caption,
    color: colors.text,
  },
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  viewToggleButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  viewToggleActive: {
    backgroundColor: colors.background,
  },
  viewToggleText: {
    ...typography.caption,
    color: colors.muted,
  },
  viewToggleTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  mapSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  mapWrap: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    height: 320,
  },
  mapFallback: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  mapFallbackTitle: {
    ...typography.label,
    color: colors.text,
  },
  mapFallbackText: {
    ...typography.caption,
    color: colors.muted,
  },
  mapActions: {
    alignSelf: 'flex-start',
  },
  resultsSection: {
    marginTop: spacing.md,
  },
  metaRow: {
    gap: spacing.xs,
  },
  metaText: {
    ...typography.caption,
    color: colors.muted,
  },
  metaActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  metaButtonText: {
    ...typography.caption,
    color: colors.text,
  },
  noticeText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  listStack: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  cardAddress: {
    ...typography.caption,
    color: colors.muted,
  },
  cardDistance: {
    ...typography.label,
    color: colors.text,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  badgeText: {
    ...typography.caption,
    color: colors.text,
  },
  badgeEmpty: {
    ...typography.caption,
    color: colors.muted,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  actionButtonActive: {
    borderColor: colors.text,
    backgroundColor: colors.text,
  },
  actionText: {
    ...typography.caption,
    color: colors.text,
  },
  actionTextActive: {
    color: colors.background,
  },
  cardDetail: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  detailText: {
    ...typography.small,
    color: colors.text,
  },
  detailButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  detailButtonText: {
    ...typography.caption,
    color: colors.text,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  bannerText: {
    ...typography.small,
    color: colors.text,
  },
  skeletonList: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  mapSkeleton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetCard: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Platform.OS === 'web' ? '90%' : '85%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  sheetClose: {
    ...typography.caption,
    color: colors.text,
  },
  sheetSection: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sheetLabel: {
    ...typography.label,
    color: colors.text,
  },
  hazardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: colors.text,
    backgroundColor: colors.text,
  },
  checkboxDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background,
  },
  checkboxLabel: {
    ...typography.body,
    color: colors.text,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sheetList: {
    maxHeight: 360,
  },
  sheetListContent: {
    paddingBottom: spacing.md,
  },
  sheetEmpty: {
    ...typography.caption,
    color: colors.muted,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  savedText: {
    flex: 1,
    gap: spacing.xs,
  },
  savedTitle: {
    ...typography.body,
    color: colors.text,
  },
  savedAddress: {
    ...typography.caption,
    color: colors.muted,
  },
  savedRemove: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  savedRemoveText: {
    ...typography.caption,
    color: colors.text,
  },
  modalItem: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalItemText: {
    ...typography.body,
    color: colors.text,
  },
  skeletonStack: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  stepperDisabled: {
    opacity: 0.4,
  },
  stepperButtonText: {
    ...typography.body,
    color: colors.text,
  },
  stepperValue: {
    ...typography.body,
    color: colors.text,
    minWidth: 64,
    textAlign: 'center',
  },
});
