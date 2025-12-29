import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Screen, TextBlock } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

export default function NotFoundScreen() {
  return (
    <Screen title="Not Found">
      <TextBlock>This screen does not exist.</TextBlock>
      <Link href="/main" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Go to Main</Text>
        </Pressable>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.text,
  },
  buttonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
});
