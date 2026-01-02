import React from 'react';
import { StyleSheet, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenContainer } from '@/src/ui/system';
import { spacing, typography, useThemedStyles } from '@/src/ui/theme';

const LICENSE_TEXT = `# Third-Party Notices

## Fonts

### Space Mono
- License: SIL Open Font License 1.1
- Where used: apps/mobile/assets/fonts/SpaceMono-Regular.ttf
- A copy of the license is provided in assets/fonts/OFL.txt
`;

export default function LicensesScreen() {
    const router = useRouter();
    const styles = useThemedStyles(createStyles);

    return (
        <ScreenContainer
            title="Licenses"
            leftAction={{ icon: 'chevron-left', label: '戻る', onPress: () => router.back() }}
        >
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.text}>{LICENSE_TEXT}</Text>
            </ScrollView>
        </ScreenContainer>
    );
}

const createStyles = (colors: { text: string; background: string }) =>
    StyleSheet.create({
        content: {
            padding: spacing.md,
        },
        text: {
            ...typography.body,
            color: colors.text,
        },
    });
