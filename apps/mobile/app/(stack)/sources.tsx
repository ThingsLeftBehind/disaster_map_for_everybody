import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function SourcesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="情報ソース" leftAction={{ icon: 'chevron-left', label: '戻る', onPress: () => router.back() }}>
      <SectionCard title="公式情報">
        <View style={styles.sourceRow}>
          <StatusPill label="JMA" tone="info" />
          <Text style={styles.bodyText}>気象庁 (Japan Meteorological Agency){'\n'}警報・注意報、地震情報など</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.sourceRow}>
          <StatusPill label="GSI" tone="neutral" />
          <Text style={styles.bodyText}>国土地理院 (Geospatial Information Authority){'\n'}ハザードマップレイヤー、地図データ</Text>
        </View>
      </SectionCard>
      <SectionCard title="その他">
        <Text style={styles.mutedText}>本アプリは上記公式情報を利用して表示していますが、防災決定の際は必ず自治体の公式指示に従ってください。</Text>
      </SectionCard>
    </ScreenContainer>
  );
}

const createStyles = (colors: { text: string; muted: string }) => ({
  bodyText: {
    ...typography.body,
    color: colors.text,
    marginTop: spacing.xs,
  },
  mutedText: {
    ...typography.body,
    color: colors.muted,
  },
  sourceRow: {
    marginBottom: spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: colors.muted,
    opacity: 0.2,
    marginVertical: spacing.sm,
  },
});
