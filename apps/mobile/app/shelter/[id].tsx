import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchJson, toApiError, type ApiError } from '@/src/api/client';
import type { Shelter, ShelterDetailResponse } from '@/src/api/types';
import {
  Chip,
  EmptyState,
  ErrorState,
  ScreenContainer,
  SectionCard,
  Skeleton,
} from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';
import { capabilityChipsFromShelter } from '@/src/utils/hazardCapability';

export default function ShelterDetailScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const params = useLocalSearchParams();
  const shelterId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!shelterId) {
        setError({ message: '避難所IDが見つかりません。', status: null, kind: 'unknown' });
        return;
      }
      setIsLoading(true);
      setError(null);
      setNotice(null);
      try {
        const data = await fetchJson<ShelterDetailResponse>(`/api/shelters/${encodeURIComponent(String(shelterId))}`);
        if (!active) return;
        setShelter(data.site ?? null);
        if (data.fetchStatus !== 'OK') {
          setNotice(data.lastError ?? '更新が遅れています');
        }
      } catch (err) {
        if (!active) return;
        setShelter(null);
        setError(toApiError(err));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [shelterId]);

  const hazardChips = useMemo(() => capabilityChipsFromShelter(shelter), [shelter]);

  return (
    <ScreenContainer title="Shelter" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title={shelter?.name ?? '避難所'}>
        {isLoading ? (
          <View style={styles.skeletonStack}>
            <Skeleton width="70%" />
            <Skeleton width="40%" />
          </View>
        ) : null}
        {shelter?.address ? <Text style={styles.bodyText}>{shelter.address}</Text> : null}
        {notice ? <Text style={styles.mutedText}>{notice}</Text> : null}
        {error ? <ErrorState message={error.message} /> : null}
      </SectionCard>

      <SectionCard title="Favorite">
        <View style={styles.rowWrap}>
          <Chip label="お気に入り" selected={favorite} onPress={() => setFavorite((v) => !v)} />
        </View>
        <Text style={styles.mutedText}>この設定は端末内のみで管理されます。</Text>
      </SectionCard>

      <SectionCard title="対応ハザード">
        {hazardChips.every((chip) => !chip.supported) ? <EmptyState message="ハザード情報はありません。" /> : null}
        <View style={styles.rowWrap}>
          {hazardChips.map((chip) => (
            <Chip key={chip.key} label={chip.label} selected={chip.supported} />
          ))}
        </View>
      </SectionCard>

      {shelter?.notes ? (
        <SectionCard title="Notes">
          <Text style={styles.bodyText}>{shelter.notes}</Text>
        </SectionCard>
      ) : null}
    </ScreenContainer>
  );
}

const createStyles = (colors: { text: string; muted: string }) =>
  StyleSheet.create({
    bodyText: {
      ...typography.body,
      color: colors.text,
      marginTop: spacing.xs,
    },
    mutedText: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    rowWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    skeletonStack: {
      gap: spacing.xs,
    },
  });
