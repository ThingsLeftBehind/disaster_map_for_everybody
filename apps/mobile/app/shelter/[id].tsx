import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchJson } from '@/src/api/client';
import type { Shelter, ShelterDetailResponse } from '@/src/api/types';
import { Card, Screen, SectionTitle, TextBlock, Toggle } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

export default function ShelterDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const shelterId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!shelterId) {
        setError('避難所IDが見つかりません。');
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
        setError(err instanceof Error ? err.message : 'Failed to load shelter');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [shelterId]);

  const hazardKeys = useMemo(() => {
    const flags = shelter?.hazards ?? {};
    return Object.entries(flags)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
  }, [shelter?.hazards]);

  return (
    <Screen title="Shelter" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>{shelter?.name ?? '避難所'}</SectionTitle>
        <TextBlock>{shelter?.address ?? '住所不明'}</TextBlock>
        {isLoading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        ) : null}
        {notice ? <TextBlock muted>{notice}</TextBlock> : null}
        {error ? <TextBlock muted>{error}</TextBlock> : null}
      </Card>

      <Card>
        <SectionTitle>お気に入り</SectionTitle>
        <Toggle label={favorite ? 'お気に入り: ON' : 'お気に入り: OFF'} value={favorite} onToggle={() => setFavorite((v) => !v)} />
        <TextBlock muted>この設定は保存されません。</TextBlock>
      </Card>

      <Card>
        <SectionTitle>ハザード</SectionTitle>
        {hazardKeys.length === 0 ? <TextBlock muted>ハザード情報はありません。</TextBlock> : null}
        {hazardKeys.map((key) => (
          <TextBlock key={key}>{key}</TextBlock>
        ))}
      </Card>

      {shelter?.notes ? (
        <Card>
          <SectionTitle>備考</SectionTitle>
          <TextBlock>{shelter.notes}</TextBlock>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
