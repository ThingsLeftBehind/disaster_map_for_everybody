import type { ReactNode } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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

type ToggleProps = {
  label: string;
  value: boolean;
  onToggle: () => void;
};

type InputProps = {
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
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

export function Toggle({ label, value, onToggle }: ToggleProps) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
    >
      <Text style={value ? styles.toggleTextOn : styles.toggleTextOff}>{label}</Text>
    </Pressable>
  );
}

export function Input({ value, placeholder, onChangeText, autoCapitalize = 'none' }: InputProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      autoCapitalize={autoCapitalize}
      style={styles.input}
    />
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
  toggle: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  toggleOn: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleOff: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  toggleTextOn: {
    color: colors.background,
    fontWeight: '600',
    fontSize: 13,
  },
  toggleTextOff: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
});
