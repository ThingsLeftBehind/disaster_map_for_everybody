import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { fetchJson } from '@/src/api/client';
import type { JmaQuakeItem, JmaQuakesResponse } from '@/src/api/types';
import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

export default function QuakesScreen() {
  const router = useRouter();
  const [quakes, setQuakes] = useState<JmaQuakesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [strongCount, setStrongCount] = useState(3);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      setNotice(null);
      try {
        const data = await fetchJson<JmaQuakesResponse>('/api/jma/quakes');
        if (!active) return;
        setQuakes(data);
        if (data.fetchStatus !== 'OK') {
          setNotice(data.lastError ?? '更新が遅れています');
        }
      } catch (err) {
        if (!active) return;
        setQuakes(null);
        setError(err instanceof Error ? err.message : 'Failed to load quakes');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const items = useMemo(() => quakes?.items ?? [], [quakes]);
  const strongItems = useMemo(() => items.filter((item) => isStrongIntensity(item.maxIntensity)), [items]);
  const strongVisible = strongItems.slice(0, strongCount);
  const canShowMore = strongItems.length > strongCount && strongCount < 9;

  const emptyState = !isLoading && !error && items.length === 0;

  return (
    <Screen title="Quakes" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>最近の地震</SectionTitle>
        {isLoading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        ) : null}
        {notice ? <TextBlock muted>{notice}</TextBlock> : null}
        {error ? <TextBlock muted>{error}</TextBlock> : null}
        {emptyState ? <TextBlock muted>地震情報がありません。</TextBlock> : null}
      </Card>

      <Card>
        <SectionTitle>強い揺れ</SectionTitle>
        <TextBlock muted>{strongDescription(strongVisible.length, strongItems.length)}</TextBlock>
        {strongVisible.map((item) => (
          <QuakeCard key={item.id} item={item} />
        ))}
        {strongItems.length === 0 ? <TextBlock muted>強い揺れの記録はありません。</TextBlock> : null}
        {canShowMore ? <Button label="さらに表示" variant="secondary" onPress={() => setStrongCount((v) => Math.min(v + 3, 9))} /> : null}
      </Card>

      <Card>
        <SectionTitle>一覧</SectionTitle>
        {items.map((item) => (
          <QuakeCard key={item.id} item={item} />
        ))}
      </Card>
    </Screen>
  );
}

function QuakeCard({ item }: { item: JmaQuakeItem }) {
  return (
    <View style={styles.quakeCard}>
      <TextBlock>{item.title}</TextBlock>
      <TextBlock muted>{formatTime(item.time)}</TextBlock>
      <TextBlock muted>
        震度: {item.maxIntensity ?? '不明'} / M{item.magnitude ?? '不明'} / {item.epicenter ?? '不明'}
      </TextBlock>
    </View>
  );
}

function isStrongIntensity(value: string | null) {
  if (!value) return false;
  return /[567]/.test(value);
}

function formatTime(value: string | null) {
  if (!value) return '時刻不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function strongDescription(visibleCount: number, total: number) {
  if (total === 0) return '強い揺れ (震度5以上) のみを表示します。';
  return `表示 ${visibleCount} / ${Math.min(total, 9)} 件`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quakeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.background,
  },
});
