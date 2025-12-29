import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard } from '@/src/ui/system';
import { colors, spacing, typography } from '@/src/ui/theme';

export default function MySafetyScreen() {
  const router = useRouter();

  return (
    <ScreenContainer title="MySafetyPin" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title="自分の状態">
        <Text style={styles.bodyText}>準備中</Text>
        <Text style={styles.bodySubText}>今後のアップデートで入力できるようになります。</Text>
      </SectionCard>
      <SectionCard title="メモ">
        <Text style={styles.bodyText}>準備中</Text>
        <Text style={styles.bodySubText}>メモの保存機能は開発中です。</Text>
      </SectionCard>
      <SectionCard title="更新">
        <Text style={styles.bodyText}>準備中</Text>
        <Text style={styles.bodySubText}>更新ボタンは近日追加予定です。</Text>
      </SectionCard>
    </ScreenContainer>
  );
}

const styles = {
  bodyText: {
    ...typography.body,
    color: colors.text,
  },
  bodySubText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
};
