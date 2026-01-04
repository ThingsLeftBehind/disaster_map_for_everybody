import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Shelter } from '@/src/api/types';
import { EmptyState, ErrorState, SecondaryButton, Skeleton } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';
import { capabilityChipsFromShelter } from '@/src/utils/hazardCapability';

import type { FavoriteShelter } from './favorites';

const DEFAULT_VISIBLE = 10;
const MAX_VISIBLE = 20;

type Props = {
  shelters: Shelter[];
  favorites: FavoriteShelter[];
  selectedId: string | null;
  isLoading: boolean;
  error: { message?: string } | null;
  cacheLabel?: string | null;
  notice?: string | null;
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
  onRetry,
  onSelect,
  onOpenList,
}: Props) {
  const styles = useThemedStyles(createStyles);
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
  const shownCount = Math.min(visibleCount, totalCount);
  const canExpand = regularShelters.length > visibleCount && visibleCount < MAX_VISIBLE;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>近くの避難場所</Text>
        <Text style={styles.cardCount}>{shownCount}件</Text>
      </View>

      {cacheLabel ? <Text style={styles.metaText}>キャッシュ {cacheLabel}</Text> : null}
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

      {isLoading ? (
        <View style={styles.skeletonStack}>
          <Skeleton height={16} />
          <Skeleton width="80%" />
          <Skeleton width="60%" />
        </View>
      ) : null}
      {error && !isLoading ? <ErrorState message="取得できませんでした。" retryLabel="再試行" onRetry={onRetry} /> : null}
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
        <Pressable style={styles.moreButton} onPress={() => setVisibleCount((prev) => Math.min(MAX_VISIBLE, prev + 10))}>
          <Text style={styles.moreText}>もっと見る</Text>
        </Pressable>
      ) : null}

      <SecondaryButton label="一覧へ" onPress={onOpenList} />
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
  const styles = useThemedStyles(createStyles);
  const distanceLabel = formatDistance(getDistance(shelter));
  const hazardChips = capabilityChipsFromShelter(shelter).filter((chip) => chip.supported);

  return (
    <Pressable style={[styles.row, selected ? styles.rowSelected : null]} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{shelter.name ?? '避難所'}</Text>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {shelter.address ?? '住所不明'}
        </Text>
        {hazardChips.length > 0 ? (
          <View style={styles.badgeRow}>
            {hazardChips.map((chip) => (
              <View key={chip.key} style={[styles.badge, styles.badgeActive]}>
                <Text style={styles.badgeTextActive}>{chip.label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.badgeEmpty}>対応ハザード: 情報なし</Text>
        )}
      </View>
      <View style={styles.rowRight}>
        <View style={styles.distanceBlock}>
          <Text style={styles.distanceLabel}>直線距離</Text>
          <Text style={styles.distanceText}>{distanceLabel}</Text>
        </View>
        <Pressable style={styles.detailButton} onPress={onPress}>
          <Text style={styles.detailButtonText}>詳細</Text>
        </Pressable>
      </View>
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

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surface: string;
}) =>
  StyleSheet.create({
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
      ...typography.label,
      color: colors.text,
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
      alignItems: 'flex-start',
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
    rowRight: {
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      minHeight: 58,
    },
    distanceBlock: {
      alignItems: 'flex-end',
      marginTop: -2,
    },
    distanceLabel: {
      ...typography.caption,
      color: colors.muted,
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
    badgeActive: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    badgeInactive: {
      backgroundColor: colors.background,
      borderColor: colors.border,
    },
    badgeTextActive: {
      ...typography.caption,
      color: colors.background,
    },
    badgeTextInactive: {
      ...typography.caption,
      color: colors.muted,
    },
    badgeEmpty: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    detailButton: {
      backgroundColor: colors.text,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
      marginTop: spacing.xs,
    },
    detailButtonText: {
      ...typography.caption,
      color: colors.background,
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
