import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function NoticesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="Notices" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title="Notices">
        <StatusPill label="準備中" tone="neutral" />
        <Text style={styles.bodyText}>運用のお知らせは今後追加予定です。</Text>
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
    ...typography.caption,
    color: colors.muted,
  },
});
