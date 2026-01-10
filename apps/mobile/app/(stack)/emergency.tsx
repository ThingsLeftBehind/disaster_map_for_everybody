import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import {
  buildCacheKey,
  fetchJson,
  fetchJsonWithCache,
  getApiBaseUrl,
  toApiError,
  type ApiError,
} from '@/src/api/client';
import type {
  JmaWarningsResponse,
  Shelter,
  ShelterCommunityResponse,
  SheltersNearbyResponse,
} from '@/src/api/types';
import { getEmergencyState, updateEmergencyState, type EmergencyBaseMode, type MyArea } from '@/src/emergency/state';
import { JmaAreaMapper } from '@/src/features/warnings/areaMapping';
import { buildWarningsViewModel, type WarningDisplayItem } from '@/src/features/warnings/transform';
import { loadFavorites, saveFavorites, toFavoriteShelter, type FavoriteShelter } from '@/src/main/favorites';
import { ShelterDetailSheet } from '@/src/main/ShelterDetailSheet';
import { getPushState } from '@/src/push/state';
import { ensureHazardCoverage } from '@/src/storage/hazardCoverage';
import {
  hazardChipsFromHazards,
  hazardKeysFromHazards,
  type HazardCapabilityKey,
} from '@/src/utils/hazardCapability';
import { PrimaryButton, ScreenContainer, SecondaryButton, Skeleton } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';

const DEFAULT_RADIUS_KM = 20;
const MAX_LIMIT = 50;
const ONSITE_DISTANCE_KM = 0.1;

type LatLng = { lat: number; lon: number };

type WarningContext = {
  prefName: string | null;
  muniName: string | null;
  muniCode: string | null;
};

type VoteStatus = 'none' | 'crowded' | 'closed';

type RecommendedShelter = {
  shelter: Shelter;
  distanceKm: number;
  status: VoteStatus;
  reasons: string[];
  hazardLabels: string[];
};

export default function EmergencyScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  const [baseMode, setBaseMode] = useState<EmergencyBaseMode>('current');
  const [myArea, setMyArea] = useState<MyArea | null>(null);
  const [favorites, setFavorites] = useState<FavoriteShelter[]>([]);

  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [location, setLocation] = useState<LatLng | null>(null);
  const [warningContext, setWarningContext] = useState<WarningContext>({
    prefName: null,
    muniName: null,
    muniCode: null,
  });

  const [recommendations, setRecommendations] = useState<RecommendedShelter[]>([]);
  const [onSiteShelter, setOnSiteShelter] = useState<Shelter | null>(null);
  const [ignoreOnSite, setIgnoreOnSite] = useState(false);

  const [detailShelter, setDetailShelter] = useState<Shelter | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusCommunity, setFocusCommunity] = useState(false);

  useEffect(() => {
    let active = true;
    getEmergencyState()
      .then((state) => {
        if (!active) return;
        setBaseMode(state.baseMode);
        setMyArea(state.myArea);
      })
      .catch(() => {
        if (!active) return;
        setBaseMode('current');
        setMyArea(null);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
  const detailDistance = detailShelter ? formatDistance(getDistance(detailShelter, location)) : null;
  const isFavorite = detailShelter ? favoriteIds.has(String(detailShelter.id)) : false;

  const handleToggleFavorite = useCallback(() => {
    if (!detailShelter) return;
    setFavorites((prev) => {
      const id = String(detailShelter.id);
      const exists = prev.find((item) => item.id === id);
      if (exists) return prev.filter((item) => item.id !== id);
      if (prev.length >= 5) return prev;
      return [...prev, toFavoriteShelter(detailShelter, null)];
    });
  }, [detailShelter]);

  const handleDirections = useCallback(async () => {
    if (!detailShelter) return;
    const destination =
      detailShelter.address ??
      (Number.isFinite(detailShelter.lat) && Number.isFinite(detailShelter.lon)
        ? `${detailShelter.lat},${detailShelter.lon}`
        : null);
    if (!destination) return;
    const origin = location ? `${location.lat},${location.lon}` : null;
    const base = 'https://www.google.com/maps/dir/?api=1';
    const url = origin
      ? `${base}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
      : `${base}&destination=${encodeURIComponent(destination)}`;
    await Linking.openURL(url);
  }, [detailShelter, location]);

  const handleShare = useCallback(async () => {
    if (!detailShelter) return;
    const lines = [detailShelter.name ?? '避難所'];
    if (detailShelter.address) lines.push(detailShelter.address);
    if (Number.isFinite(detailShelter.lat) && Number.isFinite(detailShelter.lon)) {
      lines.push(`https://www.google.com/maps/search/?api=1&query=${detailShelter.lat},${detailShelter.lon}`);
    }
    await Share.share({ message: lines.join('\n') });
  }, [detailShelter]);

  const handleBaseChange = useCallback(async (mode: EmergencyBaseMode) => {
    setBaseMode(mode);
    setActive(false);
    setRecommendations([]);
    setOnSiteShelter(null);
    setIgnoreOnSite(false);
    await updateEmergencyState((state) => ({
      ...state,
      baseMode: mode,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const handleSaveMyArea = useCallback(async () => {
    setError(null);
    try {
      const coords = await getCurrentCoords();
      if (!coords) {
        setError({ message: '位置情報を取得できませんでした。', status: null, kind: 'unknown' });
        return;
      }
      const [geo, reverse] = await Promise.all([
        reverseGeocodeResult(coords).catch(() => null),
        Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon }).catch(() => null),
      ]);
      const address = reverse && reverse.length > 0 ? reverse[0] : null;
      const prefName = address?.region ?? null;
      const muniName = address?.city ?? address?.district ?? address?.subregion ?? null;
      const nextArea: MyArea = {
        lat: coords.lat,
        lon: coords.lon,
        prefName,
        muniName,
        muniCode: geo?.muniCode ?? null,
        updatedAt: new Date().toISOString(),
      };
      setMyArea(nextArea);
      await updateEmergencyState((state) => ({
        ...state,
        myArea: nextArea,
        updatedAt: nextArea.updatedAt,
      }));
      const { items, updatedAt } = await fetchNearbyShelters({ lat: nextArea.lat, lon: nextArea.lon });
      void ensureHazardCoverage('myArea', { lat: nextArea.lat, lon: nextArea.lon }, items, updatedAt);
    } catch (err) {
      setError(toApiError(err));
    }
  }, []);

  const handleProceed = useCallback(async () => {
    setActive(true);
    setIgnoreOnSite(false);
    await loadEmergencyData({
      baseMode,
      myArea,
      setLocation,
      setWarningContext,
      setRecommendations,
      setOnSiteShelter,
      setError,
      setLoading,
      setDetailShelter,
      setDetailOpen,
    });
  }, [baseMode, myArea]);

  const handleOnSiteYes = useCallback(() => {
    if (!onSiteShelter) return;
    setDetailShelter(onSiteShelter);
    setFocusCommunity(true);
    setDetailOpen(true);
  }, [onSiteShelter]);

  const handleOnSiteNo = useCallback(() => {
    setIgnoreOnSite(true);
    setOnSiteShelter(null);
  }, []);

  const hasOnSiteMode = baseMode === 'current' && !ignoreOnSite && Boolean(onSiteShelter);

  const renderWarningTarget = useMemo(() => {
    if (baseMode === 'current') {
      const areaLabel = warningContext.prefName
        ? `${warningContext.prefName}${warningContext.muniName ?? ''}`
        : '現在地';
      return `対象: ${areaLabel}`;
    }
    const label = myArea
      ? `${myArea.prefName ?? ''}${myArea.muniName ?? ''}` || 'マイエリア'
      : 'マイエリア未設定';
    return `対象: ${label}`;
  }, [baseMode, myArea, warningContext.muniName, warningContext.prefName]);

  return (
    <ScreenContainer title="現場モード" leftAction={{ label: '戻る', onPress: () => router.back() }}>
      <View style={styles.section}>
        <View style={styles.segmentedControl}>
          <Pressable
            style={[styles.segmentButton, baseMode === 'current' ? styles.segmentButtonActive : null]}
            onPress={() => handleBaseChange('current')}
          >
            <Text style={baseMode === 'current' ? styles.segmentTextActive : styles.segmentText}>現在地</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, baseMode === 'myArea' ? styles.segmentButtonActive : null]}
            onPress={() => handleBaseChange('myArea')}
          >
            <Text style={baseMode === 'myArea' ? styles.segmentTextActive : styles.segmentText}>マイエリア</Text>
          </Pressable>
        </View>
        <Text style={styles.metaText}>{renderWarningTarget}</Text>
        {baseMode === 'myArea' && !myArea ? (
          <View style={styles.inlineRow}>
            <Text style={styles.metaText}>マイエリアが未設定です。</Text>
            <SecondaryButton label="現在地を保存" onPress={handleSaveMyArea} />
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.questionTitle}>現在、避難場所を探していますか？</Text>
        <View style={styles.actionRow}>
          <PrimaryButton label="はい" onPress={handleProceed} />
          <SecondaryButton label="いいえ" onPress={() => router.back()} />
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error.message}</Text> : null}
      {loading ? (
        <View style={styles.skeletonStack}>
          <Skeleton height={16} />
          <Skeleton width="80%" />
          <Skeleton width="60%" />
        </View>
      ) : null}

      {active && !loading ? (
        <>
          {hasOnSiteMode && onSiteShelter ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>この避難場所にいますか？</Text>
              <Text style={styles.sectionSub}>{onSiteShelter.name ?? '避難所'}</Text>
              <View style={styles.actionRow}>
                <PrimaryButton label="はい" onPress={handleOnSiteYes} />
                <SecondaryButton label="いいえ" onPress={handleOnSiteNo} />
              </View>
              <View style={styles.voteRow}>
                <Pressable
                  style={[styles.voteButton, styles.voteCrowded]}
                  onPress={() => submitVote(onSiteShelter, 'CROWDED')}
                >
                  <Text style={styles.voteText}>混雑</Text>
                </Pressable>
                <Pressable
                  style={[styles.voteButton, styles.voteClosed]}
                  onPress={() => submitVote(onSiteShelter, 'CLOSED')}
                >
                  <Text style={styles.voteText}>閉鎖</Text>
                </Pressable>
              </View>
              <Pressable style={styles.detailButton} onPress={handleOnSiteYes}>
                <Text style={styles.detailButtonText}>コメントを書く</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>おすすめの避難場所（上位3件）</Text>
              {recommendations.length === 0 ? (
                <Text style={styles.metaText}>近くの避難場所が見つかりませんでした。</Text>
              ) : (
                recommendations.map((item) => (
                  <View key={String(item.shelter.id)} style={styles.recommendCard}>
                    <View style={styles.recommendHeader}>
                      <Text style={styles.recommendTitle}>{item.shelter.name ?? '避難所'}</Text>
                      <Text style={styles.recommendDistance}>{formatDistance(item.distanceKm)}</Text>
                    </View>
                    {item.hazardLabels.length > 0 ? (
                      <View style={styles.hazardRow}>
                        {item.hazardLabels.map((label) => (
                          <View key={label} style={styles.hazardChip}>
                            <Text style={styles.hazardChipText}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.reasonList}>
                      {item.reasons.map((reason) => (
                        <Text key={reason} style={styles.reasonText}>
                          ・{reason}
                        </Text>
                      ))}
                    </View>
                    {item.status !== 'none' ? (
                      <Text style={styles.cautionText}>
                        {item.status === 'closed' ? '注意: 閉鎖の投票があります' : '注意: 混雑の投票があります'}
                      </Text>
                    ) : null}
                    {item.status === 'crowded' ? (
                      <View style={[styles.statusBadge, styles.statusCrowded]}>
                        <Text style={styles.statusText}>混雑</Text>
                      </View>
                    ) : null}
                    {item.status === 'closed' ? (
                      <View style={[styles.statusBadge, styles.statusClosed]}>
                        <Text style={styles.statusText}>閉鎖</Text>
                      </View>
                    ) : null}
                    <Pressable
                      style={styles.detailButton}
                      onPress={() => {
                        setDetailShelter(item.shelter);
                        setFocusCommunity(false);
                        setDetailOpen(true);
                      }}
                    >
                      <Text style={styles.detailButtonText}>避難所詳細</Text>
                    </Pressable>
                  </View>
                ))
              )}
              <SecondaryButton label="避難場所を探していない" onPress={() => router.back()} />
            </View>
          )}
        </>
      ) : null}

      <ShelterDetailSheet
        visible={detailOpen}
        shelter={detailShelter}
        distanceLabel={detailDistance}
        isFavorite={isFavorite}
        focusCommunity={focusCommunity}
        onClose={() => {
          setDetailOpen(false);
          setFocusCommunity(false);
        }}
        onToggleFavorite={handleToggleFavorite}
        onDirections={handleDirections}
        onShare={handleShare}
      />
    </ScreenContainer>
  );

  async function submitVote(shelter: Shelter, value: 'CROWDED' | 'CLOSED') {
    try {
      const state = await getPushState();
      if (!state.deviceId) return;
      const res = await apiRequest('/api/store/shelter/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shelterId: String(shelter.id), deviceId: state.deviceId, value }),
      });
      if (!res.ok && res.json?.error) {
        setError({ message: res.json.error, status: null, kind: 'unknown' });
      }
    } catch (err) {
      setError(toApiError(err));
    }
  }
}

async function loadEmergencyData(params: {
  baseMode: EmergencyBaseMode;
  myArea: MyArea | null;
  setLocation: (value: LatLng | null) => void;
  setWarningContext: (value: WarningContext) => void;
  setRecommendations: (value: RecommendedShelter[]) => void;
  setOnSiteShelter: (value: Shelter | null) => void;
  setError: (value: ApiError | null) => void;
  setLoading: (value: boolean) => void;
  setDetailShelter: (value: Shelter | null) => void;
  setDetailOpen: (value: boolean) => void;
}) {
  const {
    baseMode,
    myArea,
    setLocation,
    setWarningContext,
    setRecommendations,
    setOnSiteShelter,
    setError,
    setLoading,
    setDetailShelter,
    setDetailOpen,
  } = params;

  setLoading(true);
  setError(null);
  setRecommendations([]);
  setOnSiteShelter(null);

  try {
    const baseInfo = await resolveBase(baseMode, myArea);
    if (!baseInfo) {
      setError({ message: baseMode === 'myArea' ? 'マイエリアが未設定です。' : '位置情報が取得できません。', status: null, kind: 'unknown' });
      return;
    }

    const { coords, context } = baseInfo;
    setLocation(coords);
    setWarningContext(context);

    const warningItems = await fetchWarningsForContext(context);
    if (baseMode === 'myArea') {
      await updateEmergencyState((state) => ({
        ...state,
        myAreaHasWarnings: warningItems.length > 0,
        updatedAt: new Date().toISOString(),
      }));
    }

    const { items, updatedAt } = await fetchNearbyShelters(coords);
    const sorted = items.slice().sort((a, b) => getDistance(a, coords) - getDistance(b, coords));
    void ensureHazardCoverage(baseMode === 'myArea' ? 'myArea' : 'current', coords, items, updatedAt);

    if (baseMode === 'current' && sorted.length > 0) {
      const nearest = sorted[0];
      const distanceKm = getDistance(nearest, coords);
      if (Number.isFinite(distanceKm) && distanceKm <= ONSITE_DISTANCE_KM) {
        setOnSiteShelter(nearest);
      } else {
        setOnSiteShelter(null);
      }
    } else {
      setOnSiteShelter(null);
    }

    const hazardKeys = getHazardKeysFromWarnings(warningItems);
    const preferHazard = warningItems.length > 0 && hazardKeys.length > 0;
    const candidates = preferHazard
      ? sorted
          .slice()
          .sort(
            (a, b) =>
              Number(hasAnyCapability(b, hazardKeys)) - Number(hasAnyCapability(a, hazardKeys)) ||
              getDistance(a, coords) - getDistance(b, coords)
          )
      : sorted;

    const topCandidates = candidates.slice(0, 10);
    const withStatus = await Promise.all(
      topCandidates.map(async (shelter) => {
        const status = await fetchVoteStatus(shelter);
        return {
          shelter,
          distanceKm: getDistance(shelter, coords),
          status,
        };
      })
    );

    withStatus.sort((a, b) => {
      if (preferHazard) {
        const hazardDiff = Number(hasAnyCapability(b.shelter, hazardKeys)) - Number(hasAnyCapability(a.shelter, hazardKeys));
        if (hazardDiff !== 0) return hazardDiff;
      }
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return statusRank(a.status) - statusRank(b.status);
    });

    const top = withStatus.slice(0, 3).map((entry) => {
      const hazardLabels = hazardChipsFromHazards(entry.shelter.hazards ?? null)
        .filter((chip) => chip.supported)
        .map((chip) => chip.label);
      const reasons = buildReasonLines(entry, hazardLabels, preferHazard ? hazardKeys : []);
      return {
        shelter: entry.shelter,
        distanceKm: entry.distanceKm,
        status: entry.status,
        reasons,
        hazardLabels,
      };
    });

    setRecommendations(top);
    if (top.length === 0) {
      setDetailShelter(null);
      setDetailOpen(false);
    }
  } catch (err) {
    setError(toApiError(err));
    setRecommendations([]);
  } finally {
    setLoading(false);
  }
}

function buildReasonLines(
  entry: { distanceKm: number; status: VoteStatus; shelter: Shelter },
  hazardLabels: string[],
  hazardKeys: HazardCapabilityKey[]
) {
  const lines: string[] = [];
  if (hazardLabels.length > 0 && hazardKeys.length > 0) {
    lines.push(`対応：${hazardLabels.join('・')}`);
  }
  lines.push(`距離：${formatDistance(entry.distanceKm)}`);
  if (entry.status === 'none') lines.push('混雑/閉鎖の投票なし');
  if (entry.status === 'crowded') lines.push('混雑の投票あり');
  if (entry.status === 'closed') lines.push('閉鎖の投票あり');
  return lines;
}

async function fetchVoteStatus(shelter: Shelter): Promise<VoteStatus> {
  try {
    const data = await fetchJson<ShelterCommunityResponse>(`/api/store/shelter?id=${encodeURIComponent(String(shelter.id))}`);
    const summary = data.votesSummary ?? {};
    if ((summary.CLOSED ?? 0) > 0) return 'closed';
    if ((summary.CROWDED ?? 0) > 0) return 'crowded';
    return 'none';
  } catch {
    return 'none';
  }
}

function statusRank(status: VoteStatus) {
  if (status === 'closed') return 2;
  if (status === 'crowded') return 1;
  return 0;
}

function getHazardKeysFromWarnings(warnings: WarningDisplayItem[]) {
  const keys = new Set<HazardCapabilityKey>();
  warnings.forEach((item) => {
    const mapped = mapWarningToHazard(item);
    if (mapped) keys.add(mapped);
  });
  return Array.from(keys);
}

function mapWarningToHazard(item: WarningDisplayItem): HazardCapabilityKey | null {
  // Deterministic keyword mapping from JMA warning text to fixed hazard keys.
  const text = `${item.warningName} ${item.phenomenon}`;
  if (text.includes('洪水')) return 'flood';
  if (text.includes('土砂')) return 'landslide';
  if (text.includes('高潮')) return 'storm_surge';
  if (text.includes('津波')) return 'tsunami';
  if (text.includes('地震')) return 'earthquake';
  if (text.includes('大規模火災') || text.includes('火災')) return 'large_fire';
  if (text.includes('内水')) return 'inland_flood';
  if (text.includes('火山') || text.includes('噴火')) return 'volcano';
  return null;
}

function hasAnyCapability(shelter: Shelter, keys: HazardCapabilityKey[]) {
  const active = new Set(hazardKeysFromHazards(shelter.hazards ?? null));
  return keys.some((key) => active.has(key));
}

async function resolveBase(baseMode: EmergencyBaseMode, myArea: MyArea | null) {
  if (baseMode === 'myArea') {
    if (!myArea) return null;
    return {
      coords: { lat: myArea.lat, lon: myArea.lon },
      context: {
        prefName: myArea.prefName,
        muniName: myArea.muniName,
        muniCode: myArea.muniCode,
      },
    };
  }

  const coords = await getCurrentCoords();
  if (!coords) return null;
  const [geo, reverse] = await Promise.all([
    reverseGeocodeResult(coords).catch(() => null),
    Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon }).catch(() => null),
  ]);
  const address = reverse && reverse.length > 0 ? reverse[0] : null;
  const prefName = address?.region ?? null;
  const muniName = address?.city ?? address?.district ?? address?.subregion ?? null;
  return {
    coords,
    context: {
      prefName,
      muniName,
      muniCode: geo?.muniCode ?? null,
    },
  };
}

async function fetchWarningsForContext(context: WarningContext): Promise<WarningDisplayItem[]> {
  if (!context.muniCode) return [];
  const info = JmaAreaMapper.resolve(context.muniCode);
  const prefCode = context.muniCode.slice(0, 2);
  const officeCode = info.officeCode ?? `${prefCode}0000`;
  const rawClass20 = info.class20Code ?? context.muniCode;
  const normalizedClass20 = normalizeClass20(rawClass20);
  let url = `/api/jma/warnings?area=${officeCode}`;
  if (normalizedClass20) url += `&class20=${encodeURIComponent(normalizedClass20)}`;
  const data = await fetchJson<JmaWarningsResponse>(url);
  const viewModel = buildWarningsViewModel(
    { primary: data, references: [] },
    {
      muniCode: context.muniCode,
      prefName: context.prefName,
      muniName: context.muniName,
      tokyoMode: 'OTHER',
      class10Code: info.class10Code,
      officeName: info.officeName,
      class10Name: info.class10Name,
    }
  );
  return viewModel.countedWarnings;
}

async function fetchNearbyShelters(coords: LatLng) {
  const params = new URLSearchParams({
    lat: coords.lat.toString(),
    lon: coords.lon.toString(),
    limit: String(MAX_LIMIT),
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
  return { items: data.items ?? data.sites ?? [], updatedAt: data.updatedAt ?? null };
}

async function getCurrentCoords(): Promise<LatLng | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: position.coords.latitude, lon: position.coords.longitude };
}

function getDistance(shelter: Shelter, base: LatLng | null) {
  const distance = shelter.distanceKm ?? shelter.distance ?? null;
  if (typeof distance === 'number' && Number.isFinite(distance)) return distance;
  if (!base || !Number.isFinite(shelter.lat) || !Number.isFinite(shelter.lon)) return Number.POSITIVE_INFINITY;
  return haversine(base.lat, base.lon, shelter.lat, shelter.lon);
}

function formatDistance(distance: number) {
  if (!Number.isFinite(distance)) return '距離不明';
  if (distance < 1) return `${Math.round(distance * 1000)}m`;
  return `${distance.toFixed(1)}km`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

async function reverseGeocodeResult(coords: LatLng): Promise<{ prefCode: string | null; muniCode: string | null }> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
    coords.lon
  )}&lat=${encodeURIComponent(coords.lat)}`;
  const response = await fetch(url);
  const json = await response.json();
  const result = json?.results?.[0] ?? null;
  return {
    prefCode: result?.prefcode ?? null,
    muniCode: result?.muniCd ?? null,
  };
}

function normalizeClass20(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 7) return digits;
  if (digits.length === 5) return `${digits}00`;
  return null;
}

async function apiRequest(path: string, init: RequestInit) {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, init);
  const json = await response.json().catch(() => null);
  return { ok: response.ok, json };
}

const createStyles = (colors: { background: string; border: string; text: string; muted: string; surface: string }) =>
  StyleSheet.create({
    section: {
      marginBottom: spacing.lg,
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
      ...typography.caption,
      color: colors.text,
      fontWeight: '600',
    },
    metaText: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    questionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.sm,
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    errorText: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.sm,
    },
    skeletonStack: {
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    sectionCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: colors.background,
    },
    sectionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    sectionSub: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.sm,
    },
    voteRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    voteButton: {
      flex: 1,
      borderRadius: radii.pill,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderWidth: 1,
    },
    voteCrowded: {
      borderColor: '#D17C00',
      backgroundColor: '#FFF3E0',
    },
    voteClosed: {
      borderColor: '#B00020',
      backgroundColor: '#FDECEC',
    },
    voteText: {
      ...typography.label,
      color: colors.text,
    },
    recommendCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: colors.background,
    },
    recommendHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    recommendTitle: {
      ...typography.subtitle,
      color: colors.text,
      flex: 1,
      marginRight: spacing.sm,
    },
    recommendDistance: {
      ...typography.caption,
      color: colors.muted,
    },
    hazardRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    hazardChip: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.text,
      backgroundColor: colors.text,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    hazardChipText: {
      ...typography.caption,
      color: colors.background,
    },
    reasonList: {
      gap: spacing.xxs,
    },
    reasonText: {
      ...typography.caption,
      color: colors.muted,
    },
    cautionText: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    statusBadge: {
      alignSelf: 'flex-start',
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      marginTop: spacing.sm,
    },
    statusCrowded: {
      backgroundColor: '#FFF3E0',
      borderWidth: 1,
      borderColor: '#D17C00',
    },
    statusClosed: {
      backgroundColor: '#FDECEC',
      borderWidth: 1,
      borderColor: '#B00020',
    },
    statusText: {
      ...typography.caption,
      color: colors.text,
      fontWeight: '600',
    },
    detailButton: {
      alignSelf: 'flex-end',
      marginTop: spacing.sm,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xxs,
      borderWidth: 1,
      borderColor: colors.border,
    },
    detailButtonText: {
      ...typography.caption,
      color: colors.text,
    },
  });
