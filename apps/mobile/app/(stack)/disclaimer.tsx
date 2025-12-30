import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function DisclaimerScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="Disclaimer" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title="Reference Only">
        <StatusPill label="参考情報" tone="neutral" />
        <Text style={styles.bodyText}>本アプリは災害時の参考情報を提供します。</Text>
        <Text style={styles.mutedText}>必ず自治体や公式機関の指示に従ってください。</Text>
      </SectionCard>
      <SectionCard title="Availability">
        <Text style={styles.mutedText}>通信障害や提供元の都合で情報が遅延する場合があります。</Text>
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
    marginTop: spacing.xs,
  },
});
