import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function DisclaimerScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="免責事項" leftAction={{ icon: 'chevron-left', label: '戻る', onPress: () => router.back() }}>
      <SectionCard title="利用規約・免責">
        <StatusPill label="参考情報" tone="neutral" />
        <Text style={styles.bodyText}>
          本アプリが提供する情報は、災害時の参考情報としての利用を想定しています。
          システムの不具合、通信状況、データ提供元の遅延等により、最新の状況と異なる場合があります。
        </Text>
        <Text style={styles.bodyText}>
          避難行動の判断においては、必ず自治体からの避難指示・勧告や、防災無線の情報、周囲の状況を優先してください。
          本アプリの利用により生じたいかなる損害についても、開発者は責任を負いかねます。
        </Text>
      </SectionCard>
      <SectionCard title="データの正確性">
        <Text style={styles.mutedText}>
          表示されるハザードマップや避難所情報は、国や自治体の公開データに基づきますが、実際の災害状況は刻一刻と変化するため、誤差が生じる可能性があることを予めご了承ください。
        </Text>
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
