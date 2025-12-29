import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { fetchJson } from '@/src/api/client';
import type { HazardLayer, HazardLayersResponse } from '@/src/api/types';
import { Card, Screen, SectionTitle, TextBlock, Toggle } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

export default function HazardScreen() {
  const router = useRouter();
  const [layers, setLayers] = useState<HazardLayer[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      setNotice(null);
      try {
        const data = await fetchJson<HazardLayersResponse>('/api/gsi/hazard-layers');
        if (!active) return;
        setLayers(data.layers ?? []);
        if (data.fetchStatus && data.fetchStatus !== 'OK') {
          setNotice(data.lastError ?? '更新が遅れています');
        }
      } catch (err) {
        if (!active) return;
        setLayers([]);
        setError(err instanceof Error ? err.message : 'Failed to load hazard layers');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const enabledSet = useMemo(() => new Set(enabled), [enabled]);

  const toggleLayer = (key: string) => {
    setEnabled((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const emptyState = !isLoading && !error && layers.length === 0;

  return (
    <Screen title="Hazard" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>ハザードレイヤー</SectionTitle>
        {isLoading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        ) : null}
        {notice ? <TextBlock muted>{notice}</TextBlock> : null}
        {error ? <TextBlock muted>{error}</TextBlock> : null}
        {emptyState ? <TextBlock muted>レイヤー情報がありません。</TextBlock> : null}
      </Card>

      {layers.map((layer) => (
        <Card key={layer.key}>
          <View style={styles.layerRow}>
            <View style={styles.layerInfo}>
              <Text style={styles.layerTitle}>{layer.jaName ?? layer.name}</Text>
              <TextBlock muted>{layer.name}</TextBlock>
            </View>
            <Toggle
              label={enabledSet.has(layer.key) ? 'ON' : 'OFF'}
              value={enabledSet.has(layer.key)}
              onToggle={() => toggleLayer(layer.key)}
            />
          </View>
        </Card>
      ))}

      {enabled.length > 0 ? (
        <Card>
          <SectionTitle>表示について</SectionTitle>
          <TextBlock muted>選択したレイヤーは現在地図に重ねていません。次のバッチで対応します。</TextBlock>
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
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  layerInfo: {
    flex: 1,
  },
  layerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});
