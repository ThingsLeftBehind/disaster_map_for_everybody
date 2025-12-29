import type { ReactNode } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from './theme';

type Action = {
  label: string;
  onPress: () => void;
};

type ScreenProps = {
  title: string;
  leftAction?: Action;
  rightAction?: Action;
  children?: ReactNode;
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

type TextBlockProps = {
  children: ReactNode;
  muted?: boolean;
};

export function Screen({ title, leftAction, rightAction, children }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {leftAction ? <HeaderButton label={leftAction.label} onPress={leftAction.onPress} /> : null}
        </View>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSideRight}>
          {rightAction ? <HeaderButton label={rightAction.label} onPress={rightAction.onPress} /> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({ label, onPress, variant = 'primary' }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, variant === 'primary' ? styles.buttonPrimary : styles.buttonSecondary]}
    >
      <Text style={variant === 'primary' ? styles.buttonTextPrimary : styles.buttonTextSecondary}>{label}</Text>
    </Pressable>
  );
}

export function TextBlock({ children, muted }: TextBlockProps) {
  return <Text style={muted ? styles.textMuted : styles.text}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function HeaderButton({ label, onPress }: Action) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.headerAction}>
      <Text style={styles.headerActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.title,
    color: colors.text,
  },
  headerSide: {
    minWidth: 72,
    alignItems: 'flex-start',
  },
  headerSideRight: {
    minWidth: 72,
    alignItems: 'flex-end',
  },
  headerAction: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  text: {
    ...typography.body,
    color: colors.text,
  },
  textMuted: {
    ...typography.small,
    color: colors.muted,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: colors.text,
  },
  buttonSecondary: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.text,
  },
  buttonTextPrimary: {
    ...typography.subtitle,
    color: colors.background,
  },
  buttonTextSecondary: {
    ...typography.subtitle,
    color: colors.text,
  },
});
