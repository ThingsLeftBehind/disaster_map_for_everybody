import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function SourcesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="Sources" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title="Official Sources">
        <StatusPill label="JMA" tone="info" />
        <Text style={styles.bodyText}>警報・注意報、地震情報は気象庁の公式情報を使用しています。</Text>
        <StatusPill label="GSI" tone="neutral" />
        <Text style={styles.bodyText}>ハザードレイヤーは国土地理院の公開データです。</Text>
      </SectionCard>
      <SectionCard title="Notes">
        <Text style={styles.mutedText}>本アプリの情報は参考情報です。必ず自治体の指示に従ってください。</Text>
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
});
