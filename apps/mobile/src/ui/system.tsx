import type { ReactNode, RefObject } from 'react';
import type { ComponentProps } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, type DimensionValue } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, useTheme, useThemedStyles } from './theme';
import { useDrawer } from './drawer';

type HeaderAction = {
  icon?: ComponentProps<typeof FontAwesome>['name'];
  label?: string;
  onPress: () => void;
};

type ScreenContainerProps = {
  title: string;
  leftAction?: HeaderAction;
  rightAction?: HeaderAction;
  children: ReactNode;
  scroll?: boolean;
};

type SectionCardProps = {
  title?: string;
  action?: HeaderAction;
  children: ReactNode;
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

type TextFieldProps = {
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  multiline?: boolean;
};

type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

type StatusTone = 'neutral' | 'ok' | 'info' | 'warning' | 'danger';

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
};

type ErrorStateProps = {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

type EmptyStateProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
};

export function ScreenContainer({
  title,
  leftAction,
  rightAction,
  children,
  scroll = true,
}: ScreenContainerProps) {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const baseHeight = Platform.OS === 'web' ? 64 : 58;
  const contentPaddingBottom = spacing.lg + baseHeight + insets.bottom;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {leftAction ? <HeaderActionButton action={leftAction} align="left" /> : null}
        </View>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSideRight}>
          {rightAction ? <HeaderActionButton action={rightAction} align="right" /> : null}
        </View>
      </View>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: contentPaddingBottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { paddingBottom: contentPaddingBottom }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function TabScreen({
  title,
  subtitle,
  titleAlign = 'left',
  children,
  scrollRef,
}: {
  title: string;
  subtitle?: string | null;
  titleAlign?: 'left' | 'center';
  children: ReactNode;
  scrollRef?: RefObject<ScrollView>;
}) {
  const { openDrawer } = useDrawer();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const baseHeight = Platform.OS === 'web' ? 64 : 58;
  const paddingBottom = Math.max(insets.bottom, Platform.OS === 'web' ? 10 : 6);
  const contentPaddingBottom = spacing.lg + baseHeight + paddingBottom;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.appBar}>
        {titleAlign === 'left' ? (
          <View style={styles.appBarTitleGroup}>
            <Text style={styles.appBarTitleLeft}>{title}</Text>
            {subtitle ? <Text style={styles.appBarSubtitle}>{subtitle}</Text> : null}
          </View>
        ) : (
          <>
            <View style={styles.appBarSide} />
            <Text style={styles.appBarTitle}>{title}</Text>
          </>
        )}
        <Pressable onPress={openDrawer} hitSlop={10} style={styles.appBarButton}>
          <FontAwesome name="bars" size={18} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.tabContent, { paddingBottom: contentPaddingBottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionCard({ title, action, children }: SectionCardProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.card}>
      {title || action ? (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {action ? <HeaderActionButton action={action} align="right" compact /> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled = false }: ButtonProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        styles.buttonPrimary,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={styles.buttonTextPrimary}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, disabled = false }: ButtonProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        styles.buttonSecondary,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={styles.buttonTextSecondary}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  value,
  placeholder,
  onChangeText,
  autoCapitalize = 'none',
  keyboardType = 'default',
  multiline = false,
}: TextFieldProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TextInput
      value={value}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      onChangeText={onChangeText}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      multiline={multiline}
      style={[styles.input, multiline ? styles.inputMultiline : null]}
    />
  );
}

export function Chip({ label, selected = false, disabled = false, onPress }: ChipProps) {
  const styles = useThemedStyles(createStyles);
  const content = (
    <View
      style={[
        styles.chip,
        selected ? styles.chipSelected : styles.chipIdle,
        disabled ? styles.chipDisabled : null,
      ]}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText}>{label}</Text>
    </View>
  );

  if (!onPress || disabled) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

export function StatusPill({ label, tone = 'neutral' }: StatusPillProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const toneStyle = getStatusToneStyles(colors)[tone];
  return (
    <View style={[styles.statusPill, toneStyle.container]}>
      <Text style={[styles.statusText, toneStyle.text]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ title = '読み込みエラー', message, retryLabel = '再試行', onRetry }: ErrorStateProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.stateWrap}>
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {onRetry ? <SecondaryButton label={retryLabel} onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title = 'データなし', message, actionLabel, onAction }: EmptyStateProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.stateWrap}>
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {actionLabel && onAction ? <SecondaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function Skeleton({ width = '100%', height = 14 }: SkeletonProps) {
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.skeleton, { width, height }]} />;
}

function HeaderActionButton({
  action,
  align,
  compact,
}: {
  action: HeaderAction;
  align: 'left' | 'right';
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable onPress={action.onPress} hitSlop={10} style={[styles.headerAction, compact ? styles.headerActionCompact : null]}>
      {action.icon ? (
        <FontAwesome name={action.icon} size={16} color={colors.text} />
      ) : null}
      {action.label ? (
        <Text style={[styles.headerActionText, align === 'right' ? styles.headerActionRight : null]}>
          {action.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function getStatusToneStyles(colors: {
  surfaceStrong: string;
  border: string;
  text: string;
  statusBgOk: string;
  statusOk: string;
  background: string;
  statusBgInfo: string;
  statusInfo: string;
  statusBgWarning: string;
  statusWarning: string;
  statusBgDanger: string;
  statusDanger: string;
}): Record<StatusTone, { container: object; text: object }> {
  return {
    neutral: {
      container: { backgroundColor: colors.surfaceStrong, borderColor: colors.border },
      text: { color: colors.text },
    },
    ok: {
      container: { backgroundColor: colors.statusBgOk, borderColor: colors.statusOk },
      text: { color: colors.background },
    },
    info: {
      container: { backgroundColor: colors.statusBgInfo, borderColor: colors.statusInfo },
      text: { color: colors.statusInfo },
    },
    warning: {
      container: { backgroundColor: colors.statusBgWarning, borderColor: colors.statusWarning },
      text: { color: colors.statusWarning },
    },
    danger: {
      container: { backgroundColor: colors.statusBgDanger, borderColor: colors.statusDanger },
      text: { color: colors.statusDanger },
    },
  };
}

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surfaceStrong: string;
  statusBgOk: string;
  statusOk: string;
  statusBgInfo: string;
  statusInfo: string;
  statusBgWarning: string;
  statusWarning: string;
  statusBgDanger: string;
  statusDanger: string;
}) =>
  StyleSheet.create({
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
    backgroundColor: colors.background,
  },
  headerTitle: {
    ...typography.title,
    color: colors.text,
  },
  headerSide: {
    minWidth: 72,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSideRight: {
    minWidth: 72,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerActionCompact: {
    paddingHorizontal: 0,
  },
  headerActionText: {
    ...typography.label,
    color: colors.text,
  },
  headerActionRight: {
    textAlign: 'right',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appBarSide: {
    width: 36,
  },
  appBarTitle: {
    ...typography.title,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  appBarTitleGroup: {
    flex: 1,
  },
  appBarTitleLeft: {
    ...typography.title,
    color: colors.text,
  },
  appBarSubtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  appBarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tabContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
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
  buttonDisabled: {
    opacity: 0.5,
  },
  chip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
  },
  chipSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipIdle: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    ...typography.label,
    color: colors.text,
  },
  chipTextSelected: {
    ...typography.label,
    color: colors.background,
  },
  statusPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusText: {
    ...typography.label,
  },
  stateWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  stateTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stateMessage: {
    ...typography.body,
    color: colors.muted,
  },
  skeleton: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: typography.body.fontSize,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
