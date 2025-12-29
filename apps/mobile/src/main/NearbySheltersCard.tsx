import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Shelter } from '@/src/api/types';
import { EmptyState, ErrorState, SecondaryButton, Skeleton } from '@/src/ui/system';
import { colors, radii, spacing, typography } from '@/src/ui/theme';

import type { FavoriteShelter } from './favorites';

const DEFAULT_VISIBLE = 10;
const MAX_VISIBLE = 30;

type Props = {
  shelters: Shelter[];
  favorites: FavoriteShelter[];
  selectedId: string | null;
  isLoading: boolean;
  error: { message?: string } | null;
  cacheLabel?: string | null;
  notice?: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onRetry: () => void;
  onSelect: (shelter: Shelter) => void;
  onOpenList: () => void;
};

export function NearbySheltersCard({
  shelters,
  favorites,
  selectedId,
  isLoading,
  error,
  cacheLabel,
  notice,
  open,
  onToggleOpen,
  onRetry,
  onSelect,
  onOpenList,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE);

  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE);
  }, [shelters]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
  const favoriteShelters = useMemo(
    () => shelters.filter((shelter) => favoriteIds.has(String(shelter.id))).slice(0, 3),
    [favoriteIds, shelters]
  );
  const regularShelters = useMemo(
    () => shelters.filter((shelter) => !favoriteIds.has(String(shelter.id))),
    [favoriteIds, shelters]
  );

  const totalCount = shelters.length;
  const visibleShelters = regularShelters.slice(0, Math.min(visibleCount, regularShelters.length));
  const canExpand = regularShelters.length > visibleCount && visibleCount < MAX_VISIBLE;

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={onToggleOpen}>
        <View>
          <Text style={styles.cardTitle}>近くの避難場所</Text>
          <Text style={styles.cardCount}>{totalCount}件</Text>
        </View>
        <Text style={styles.toggleText}>{open ? '閉じる' : '開く'}</Text>
      </Pressable>

      {cacheLabel ? <Text style={styles.metaText}>キャッシュ {cacheLabel}</Text> : null}
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

      {!open ? null : (
        <>
          {isLoading ? (
            <View style={styles.skeletonStack}>
              <Skeleton height={16} />
              <Skeleton width="80%" />
              <Skeleton width="60%" />
            </View>
          ) : null}
          {error && !isLoading ? (
            <ErrorState message="取得できませんでした。" retryLabel="再試行" onRetry={onRetry} />
          ) : null}
          {!isLoading && !error && totalCount === 0 ? (
            <EmptyState message="近くの避難所が見つかりませんでした。" />
          ) : null}

          {favoriteShelters.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupTitle}>保存済み</Text>
              {favoriteShelters.map((shelter) => (
                <ShelterRow
                  key={`fav-${shelter.id}`}
                  shelter={shelter}
                  selected={selectedId === String(shelter.id)}
                  onPress={() => onSelect(shelter)}
                />
              ))}
            </View>
          ) : null}

          {visibleShelters.map((shelter) => (
            <ShelterRow
              key={String(shelter.id)}
              shelter={shelter}
              selected={selectedId === String(shelter.id)}
              onPress={() => onSelect(shelter)}
            />
          ))}

          {canExpand ? (
            <Pressable style={styles.moreButton} onPress={() => setVisibleCount(Math.min(MAX_VISIBLE, totalCount))}>
              <Text style={styles.moreText}>もっと見る</Text>
            </Pressable>
          ) : null}

          <SecondaryButton label="一覧へ" onPress={onOpenList} />
        </>
      )}
    </View>
  );
}

function ShelterRow({
  shelter,
  selected,
  onPress,
}: {
  shelter: Shelter;
  selected: boolean;
  onPress: () => void;
}) {
  const distanceLabel = formatDistance(getDistance(shelter));
  const hazardLabels = getHazardLabels(shelter);

  return (
    <Pressable style={[styles.row, selected ? styles.rowSelected : null]} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{shelter.name ?? '避難所'}</Text>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {shelter.address ?? '住所不明'}
        </Text>
        {hazardLabels.length > 0 ? (
          <View style={styles.badgeRow}>
            {hazardLabels.map((label) => (
              <View key={label} style={styles.badge}>
                <Text style={styles.badgeText}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <Text style={styles.distanceText}>{distanceLabel}</Text>
    </Pressable>
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

function getHazardLabels(shelter: Shelter) {
  const flags = shelter.hazards ?? {};
  const active = HAZARD_OPTIONS.filter((option) => Boolean(flags?.[option.key]));
  return active.slice(0, 2).map((option) => option.label);
}

const HAZARD_OPTIONS = [
  { key: 'flood', label: '洪水' },
  { key: 'landslide', label: '土砂' },
  { key: 'storm_surge', label: '高潮' },
  { key: 'earthquake', label: '地震' },
  { key: 'tsunami', label: '津波' },
  { key: 'large_fire', label: '大規模火災' },
  { key: 'inland_flood', label: '内水' },
  { key: 'volcano', label: '火山' },
] as const;

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  cardCount: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  toggleText: {
    ...typography.caption,
    color: colors.muted,
  },
  metaText: {
    ...typography.caption,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  noticeText: {
    ...typography.caption,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  skeletonStack: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  group: {
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupTitle: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  rowAddress: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  distanceText: {
    ...typography.label,
    color: colors.text,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  badge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeText: {
    ...typography.caption,
    color: colors.text,
  },
  moreButton: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  moreText: {
    ...typography.label,
    color: colors.text,
  },
});
