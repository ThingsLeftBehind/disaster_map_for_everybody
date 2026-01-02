import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ScreenContainer, SectionCard, StatusPill } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

export default function NoticesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <ScreenContainer title="注意事項" leftAction={{ icon: 'chevron-left', label: '戻る', onPress: () => router.back() }}>
      <SectionCard title="運用上の注意">
        <StatusPill label="Beta" tone="info" />
        <Text style={styles.bodyText}>
          本アプリは現在開発・運用テスト段階の機能を含みます。
          予告なく機能が変更されたり、メンテナンスのためにサービスが停止する場合があります。
        </Text>
      </SectionCard>
      <SectionCard title="位置情報">
        <Text style={styles.mutedText}>
          現在地周辺の避難所や警報を表示するために位置情報を利用しますが、
          プライバシー保護のため、位置情報は端末内および一時的な検索クエリとしてのみ使用され、
          サーバー等に保存・追跡されることはありません。
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
    ...typography.caption,
    color: colors.muted,
  },
});
