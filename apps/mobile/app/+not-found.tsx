import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { PrimaryButton, ScreenContainer, SectionCard } from '@/src/ui/system';
import { colors, typography } from '@/src/ui/theme';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <ScreenContainer title="Not Found">
      <SectionCard>
        <Text style={styles.text}>This screen does not exist.</Text>
        <PrimaryButton label="Go to Main" onPress={() => router.replace('/main')} />
      </SectionCard>
    </ScreenContainer>
  );
}

const styles = {
  text: {
    ...typography.body,
    color: colors.text,
  },
};
