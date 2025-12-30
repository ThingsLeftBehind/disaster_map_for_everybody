import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { fetchJson, getApiBaseUrl, toApiError, type ApiError } from '@/src/api/client';
import type { HazardLayer, HazardLayersResponse } from '@/src/api/types';
import { HazardMap, type HazardMapRegion, type HazardTile } from '@/src/map/HazardMap';
import { Chip, SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { radii, spacing, typography, useTheme, useThemedStyles } from '@/src/ui/theme';

const STORAGE_KEY = 'hinanavi_hazard_layer_v1';

const DEFAULT_REGION: HazardMapRegion = {
  latitude: 35.6812,
  longitude: 139.7671,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
};

const FALLBACK_LAYERS: HazardLayer[] = [
  {
    key: 'flood',
    name: 'Flood',
    jaName: '洪水',
    tileUrl: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
    scheme: 'xyz',
    minZoom: 10,
    maxZoom: 17,
  },
  {
    key: 'landslide',
    name: 'Landslide',
    jaName: '土砂災害',
    tileUrl: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
    scheme: 'xyz',
    tiles: [
      { url: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
      { url: 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
      { url: 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
    ],
    minZoom: 10,
    maxZoom: 17,
  },
  {
    key: 'tsunami',
    name: 'Tsunami',
    jaName: '津波',
    tileUrl: '/api/tiles/tsunami/{z}/{x}/{y}.png',
    scheme: 'xyz',
    minZoom: 10,
    maxZoom: 17,
  },
  {
    key: 'liquefaction',
    name: 'Liquefaction',
    jaName: '液状化',
    tileUrl: '/api/tiles/lcm25k_2012/{z}/{x}/{y}.png',
    scheme: 'xyz',
    minZoom: 10,
    maxZoom: 16,
  },
];

const LAYER_PRIORITY = ['flood', 'landslide', 'tsunami', 'liquefaction'];

type LegendItem = {
  color: string;
  label: string;
};

type LayerMeta = {
  label: string;
  legend: LegendItem[];
  meaning: string;
  actions: string[];
  detail: {
    about: string;
    guidance: string[];
  };
};

const LAYER_META: Record<string, LayerMeta> = {
  flood: {
    label: '洪水',
    legend: [
      { color: '#E0F2FE', label: '0.5m未満' },
      { color: '#7DD3FC', label: '0.5–3m' },
      { color: '#38BDF8', label: '3–5m' },
      { color: '#0284C7', label: '5m以上' },
    ],
    meaning: '浸水の深さの想定です。',
    actions: ['高い場所へ移動', '河川から離れる', '避難情報を確認'],
    detail: {
      about: '洪水時に想定される浸水深を示します。',
      guidance: ['避難情報に従う', '早めの移動', '道路冠水に注意'],
    },
  },
  landslide: {
    label: '土砂災害',
    legend: [
      { color: '#FDE68A', label: '土石流警戒区域' },
      { color: '#F59E0B', label: '急傾斜地崩壊' },
      { color: '#B45309', label: '地すべり' },
    ],
    meaning: '土砂災害の警戒区域です。',
    actions: ['斜面から離れる', '雨が強い時は早め避難', '周囲の異変に注意'],
    detail: {
      about: '土砂災害の危険が高い区域を示します。',
      guidance: ['土砂災害警戒情報を確認', '夜間の避難は早めに判断', '避難先を事前に確認'],
    },
  },
  tsunami: {
    label: '津波',
    legend: [
      { color: '#C7D2FE', label: '1m未満' },
      { color: '#818CF8', label: '1–3m' },
      { color: '#4F46E5', label: '3–5m' },
      { color: '#312E81', label: '5m以上' },
    ],
    meaning: '津波浸水の想定範囲です。',
    actions: ['すぐ高台へ', '海岸から離れる', '避難指示に従う'],
    detail: {
      about: '津波による浸水範囲の想定を示します。',
      guidance: ['揺れを感じたら即避難', '車より徒歩を優先', '引き返さない'],
    },
  },
  liquefaction: {
    label: '液状化',
    legend: [
      { color: '#FCA5A5', label: '非常に高い' },
      { color: '#F87171', label: '高い' },
      { color: '#FBBF24', label: '中' },
      { color: '#A7F3D0', label: '低い' },
    ],
    meaning: '液状化の可能性を示します。',
    actions: ['道路の段差に注意', '建物周辺の沈下に注意', '避難経路を確認'],
    detail: {
      about: '地盤の液状化の可能性を示します。',
      guidance: ['避難時は足元に注意', '避難経路を複数確認', '倒壊の恐れから離れる'],
    },
  },
};

function buildFallbackMeta(colors: { surfaceStrong: string; statusBgWarning: string }): LayerMeta {
  return {
    label: 'ハザード',
    legend: [
      { color: colors.surfaceStrong, label: '注意' },
      { color: colors.statusBgWarning, label: '危険' },
    ],
    meaning: 'ハザード情報の参考表示です。',
    actions: ['公式情報を確認', '周囲の安全確保', '避難情報に注意'],
    detail: {
      about: 'ハザードの想定情報を示します。',
      guidance: ['自治体の指示に従う', '危険区域から離れる'],
    },
  };
}

export default function HazardScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const mapHeight = Math.max(260, Math.min(Math.round(windowHeight * 0.5), 440));

  const [layers, setLayers] = useState<HazardLayer[]>([]);
  const [selectedLayerKey, setSelectedLayerKey] = useState<string | null>(null);
  const [mapRegion, setMapRegion] = useState<HazardMapRegion>(DEFAULT_REGION);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const loadLayers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<HazardLayersResponse>('/api/gsi/hazard-layers');
      setLayers(data.layers ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setSourceUrl(data.source?.portalUrl ?? data.source?.metadataUrl ?? null);
      if (data.fetchStatus && data.fetchStatus !== 'OK') {
        setNotice(data.lastError ?? '更新が遅れています');
      }
    } catch (err) {
      setLayers([]);
      setError(toApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLayers();
  }, [loadLayers]);

  useEffect(() => {
    let active = true;
    const loadStored = async () => {
      const stored = await readStoredLayerKey();
      if (!active) return;
      setSelectedLayerKey(stored);
      setStorageReady(true);
    };
    void loadStored();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void writeStoredLayerKey(selectedLayerKey);
  }, [selectedLayerKey, storageReady]);

  const availableLayers = useMemo(() => (layers.length > 0 ? layers : FALLBACK_LAYERS), [layers]);

  const sortedLayers = useMemo(() => sortLayers(availableLayers), [availableLayers]);

  useEffect(() => {
    if (!selectedLayerKey) return;
    if (!sortedLayers.some((layer) => layer.key === selectedLayerKey)) {
      setSelectedLayerKey(null);
    }
  }, [selectedLayerKey, sortedLayers]);

  const selectedLayer = useMemo(
    () => sortedLayers.find((layer) => layer.key === selectedLayerKey) ?? null,
    [selectedLayerKey, sortedLayers]
  );

  const fallbackMeta = useMemo(() => buildFallbackMeta(colors), [colors]);

  const selectedMeta = useMemo(
    () => getLayerMeta(selectedLayerKey, selectedLayer?.jaName ?? selectedLayer?.name ?? null, fallbackMeta),
    [fallbackMeta, selectedLayerKey, selectedLayer?.jaName, selectedLayer?.name]
  );

  const layerLabel = selectedLayerKey ? selectedMeta.label : 'OFF';

  const tileSources = useMemo(() => {
    if (!selectedLayer) return [] as HazardTile[];
    return buildTileSources(selectedLayer, getApiBaseUrl());
  }, [selectedLayer]);

  const zoomLevel = useMemo(() => regionToZoom(mapRegion), [mapRegion]);

  const overlayVisible = useMemo(() => {
    if (!selectedLayerKey) return false;
    if (tileSources.length === 0) return false;
    const minZoom = selectedLayer?.minZoom ?? 0;
    const maxZoom = selectedLayer?.maxZoom ?? 24;
    return zoomLevel >= minZoom && zoomLevel <= maxZoom;
  }, [selectedLayer?.maxZoom, selectedLayer?.minZoom, selectedLayerKey, tileSources.length, zoomLevel]);

  const visibleTiles = overlayVisible ? tileSources : [];
  const zoomHint = selectedLayerKey && tileSources.length > 0 && !overlayVisible ? 'ズームすると表示されます' : null;
  const mapHints = [mapNotice, zoomHint].filter(Boolean) as string[];

  const handleSelectLayer = useCallback((key: string | null) => {
    setSelectedLayerKey(key);
  }, []);

  const handleZoomBy = useCallback((factor: number) => {
    setMapRegion((prev) => {
      const nextLat = clamp(prev.latitudeDelta * factor, 0.02, 8);
      const nextLon = clamp(prev.longitudeDelta * factor, 0.02, 8);
      return { ...prev, latitudeDelta: nextLat, longitudeDelta: nextLon };
    });
  }, []);

  const handleRecenter = useCallback(async () => {
    setMapNotice(null);
    if (Platform.OS === 'web') {
      setMapNotice('Webでは現在地を取得できません。');
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setMapNotice('位置情報がオフです。');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMapRegion({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      });
    } catch {
      setMapNotice('現在地を取得できませんでした。');
    }
  }, []);

  return (
    <TabScreen title="ハザード">
      <HazardHeader layerLabel={layerLabel} updatedAt={updatedAt} notice={notice} />
      {error ? <FetchStateBanner message="ハザード情報を取得できませんでした" onRetry={loadLayers} /> : null}

      <View style={[styles.mapContainer, { height: mapHeight }]}>
        <HazardMap region={mapRegion} tiles={visibleTiles} onRegionChangeComplete={setMapRegion} />
        <Pressable style={styles.locationButton} onPress={handleRecenter}>
          <Text style={styles.locationButtonText}>現在地へ</Text>
        </Pressable>
        <View style={styles.zoomControls}>
          <Pressable style={styles.zoomButton} onPress={() => handleZoomBy(0.7)}>
            <Text style={styles.zoomButtonText}>＋</Text>
          </Pressable>
          <Pressable style={styles.zoomButton} onPress={() => handleZoomBy(1.4)}>
            <Text style={styles.zoomButtonText}>－</Text>
          </Pressable>
        </View>
      </View>
      {mapHints.length > 0 ? (
        <View style={styles.mapHintRow}>
          {mapHints.map((hint, index) => (
            <View key={`${hint}-${index}`} style={styles.mapHint}>
              <Text style={styles.mapHintText}>{hint}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <HazardLayerChips layers={sortedLayers} selectedKey={selectedLayerKey} onSelect={handleSelectLayer} />

      {selectedLayerKey ? (
        <HazardLegendCard
          meta={selectedMeta}
          isLoading={isLoading}
          tileAvailable={tileSources.length > 0}
          onOpenDetail={() => setDetailOpen(true)}
        />
      ) : null}

      <HazardDetailSheet
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        meta={selectedMeta}
        sourceUrl={sourceUrl}
      />
    </TabScreen>
  );
}

function HazardHeader({
  layerLabel,
  updatedAt,
  notice,
}: {
  layerLabel: string;
  updatedAt: string | null;
  notice: string | null;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.headerBlock}>
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>レイヤー: {layerLabel}</Text>
        {updatedAt ? <Text style={styles.statusText}>最終更新: {formatTimeShort(updatedAt)}</Text> : null}
      </View>
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
    </View>
  );
}

function HazardLayerChips({
  layers,
  selectedKey,
  onSelect,
}: {
  layers: HazardLayer[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      <Chip label="OFF" selected={!selectedKey} onPress={() => onSelect(null)} />
      {layers.map((layer) => (
        <Chip
          key={layer.key}
          label={layer.jaName ?? layer.name}
          selected={selectedKey === layer.key}
          onPress={() => onSelect(layer.key)}
        />
      ))}
    </ScrollView>
  );
}

function HazardLegendCard({
  meta,
  isLoading,
  tileAvailable,
  onOpenDetail,
}: {
  meta: LayerMeta;
  isLoading: boolean;
  tileAvailable: boolean;
  onOpenDetail: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.legendCard}>
      <View style={styles.legendHeader}>
        <Text style={styles.legendTitle}>凡例</Text>
        <Pressable onPress={onOpenDetail}>
          <Text style={styles.legendLink}>詳細を見る</Text>
        </Pressable>
      </View>
      {isLoading ? (
        <View style={styles.legendSkeleton}>
          <Skeleton width="60%" />
          <Skeleton width="80%" />
          <Skeleton width="50%" />
        </View>
      ) : (
        <View style={styles.legendList}>
          {meta.legend.slice(0, 6).map((item) => (
            <View key={item.label} style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}
      {!tileAvailable ? <Text style={styles.noticeText}>レイヤーの地図は準備中です。</Text> : null}
      <Text style={styles.legendSubtitle}>意味 / いまやること</Text>
      <Text style={styles.legendText}>{meta.meaning}</Text>
      <View style={styles.actionList}>
        {meta.actions.map((action) => (
          <Text key={action} style={styles.actionText}>{`• ${action}`}</Text>
        ))}
      </View>
    </View>
  );
}

function HazardDetailSheet({
  visible,
  onClose,
  meta,
  sourceUrl,
}: {
  visible: boolean;
  onClose: () => void;
  meta: LayerMeta;
  sourceUrl: string | null;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>詳細</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>閉じる</Text>
            </Pressable>
          </View>
          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>このレイヤーについて</Text>
            <Text style={styles.sheetText}>{meta.detail.about}</Text>
          </View>
          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>避難の考え方</Text>
            {meta.detail.guidance.map((item) => (
              <Text key={item} style={styles.sheetText}>{`• ${item}`}</Text>
            ))}
          </View>
          {sourceUrl ? (
            <View style={styles.sheetSection}>
              <SecondaryButton label="公式情報を見る" onPress={() => Linking.openURL(sourceUrl)} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function FetchStateBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <SecondaryButton label="再試行" onPress={onRetry} />
    </View>
  );
}

function getLayerMeta(key: string | null, fallbackLabel: string | null, fallbackMeta: LayerMeta): LayerMeta {
  if (key && LAYER_META[key]) return LAYER_META[key];
  const label = fallbackLabel ?? (key ? key : fallbackMeta.label);
  return { ...fallbackMeta, label };
}

function sortLayers(layers: HazardLayer[]) {
  return [...layers].sort((a, b) => {
    const ai = LAYER_PRIORITY.indexOf(a.key);
    const bi = LAYER_PRIORITY.indexOf(b.key);
    if (ai === -1 && bi === -1) return (a.jaName ?? a.name ?? a.key).localeCompare(b.jaName ?? b.name ?? b.key);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function buildTileSources(layer: HazardLayer, baseUrl: string): HazardTile[] {
  const sources = layer.tiles && layer.tiles.length > 0 ? layer.tiles : layer.tileUrl ? [{ url: layer.tileUrl, scheme: layer.scheme ?? 'xyz' }] : [];
  return sources
    .filter((tile) => Boolean(tile.url))
    .map((tile, index) => ({
      id: `${layer.key}-${index}`,
      url: resolveTileUrl(tile.url, baseUrl),
      minZoom: layer.minZoom ?? undefined,
      maxZoom: layer.maxZoom ?? undefined,
      opacity: 0.6,
      flipY: tile.scheme === 'tms',
    }));
}

function resolveTileUrl(url: string, baseUrl: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (!baseUrl) return url;
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}${url.startsWith('/') ? '' : '/'}${url}`;
}

function regionToZoom(region: HazardMapRegion) {
  const zoom = Math.log2(360 / region.latitudeDelta);
  return Number.isFinite(zoom) ? Math.round(zoom) : 0;
}

function formatTimeShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function readStoredLayerKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return AsyncStorage.getItem(STORAGE_KEY);
}

async function writeStoredLayerKey(value: string | null) {
  if (Platform.OS === 'web') {
    try {
      if (!value) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, value);
      }
    } catch {
      return;
    }
    return;
  }
  if (!value) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, value);
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
  headerBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  statusText: {
    ...typography.caption,
    color: colors.muted,
  },
  noticeText: {
    ...typography.caption,
    color: colors.muted,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  bannerText: {
    ...typography.body,
    color: colors.text,
  },
  mapContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
    position: 'relative',
  },
  locationButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationButtonText: {
    ...typography.caption,
    color: colors.text,
  },
  zoomControls: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    gap: spacing.xs,
  },
  zoomButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  zoomButtonText: {
    ...typography.body,
    color: colors.text,
  },
  mapHintRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  mapHint: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  mapHintText: {
    ...typography.caption,
    color: colors.text,
  },
  chipRow: {
    marginTop: spacing.md,
    gap: spacing.xs,
    paddingRight: spacing.md,
    alignItems: 'center',
  },
  legendCard: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legendTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  legendLink: {
    ...typography.caption,
    color: colors.text,
  },
  legendList: {
    gap: spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendSwatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.text,
  },
  legendSubtitle: {
    ...typography.label,
    color: colors.text,
  },
  legendText: {
    ...typography.body,
    color: colors.text,
  },
  legendSkeleton: {
    gap: spacing.xs,
  },
  actionList: {
    gap: spacing.xs,
  },
  actionText: {
    ...typography.body,
    color: colors.text,
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
    gap: spacing.xs,
  },
  sheetLabel: {
    ...typography.label,
    color: colors.text,
  },
  sheetText: {
    ...typography.body,
    color: colors.text,
  },
});
