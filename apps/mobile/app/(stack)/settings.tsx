import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { getApiBaseUrl } from '@/src/api/client';
import {
  PrimaryButton,
  ScreenContainer,
  SectionCard,
  SecondaryButton,
  StatusPill,
} from '@/src/ui/system';
import { spacing, typography, useTheme, useThemedStyles } from '@/src/ui/theme';
import { disableBackgroundAlerts, enableBackgroundAlerts, getBackgroundStatus } from '@/src/push/service';

export default function SettingsScreen() {
  const router = useRouter();
  const { themeName, setThemeName, colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown';
  const apiBaseUrl = getApiBaseUrl();
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const status = await getBackgroundStatus();
    setAlertsEnabled(status.enabled && status.started);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleEnable = useCallback(async () => {
    setIsWorking(true);
    setError(null);
    const result = await enableBackgroundAlerts();
    if (!result.ok) {
      const reason =
        result.reason === 'push-permission'
          ? '通知の許可が必要です。'
          : result.reason === 'location-foreground'
            ? '位置情報の許可が必要です。'
            : 'バックグラウンド位置情報の許可が必要です。';
      setError(reason);
    }
    await refreshStatus();
    setIsWorking(false);
  }, [refreshStatus]);

  const handleDisable = useCallback(async () => {
    setIsWorking(true);
    setError(null);
    await disableBackgroundAlerts();
    await refreshStatus();
    setIsWorking(false);
  }, [refreshStatus]);

  return (
    <ScreenContainer title="設定" leftAction={{ icon: 'chevron-left', label: '戻る', onPress: () => router.back() }}>
      <SectionCard title="表示">
        <View style={styles.row}>
          <Text style={styles.rowLabel}>ダークモード</Text>
          <Switch
            value={themeName === 'dark'}
            onValueChange={(value) => setThemeName(value ? 'dark' : 'light')}
            trackColor={{ false: colors.border, true: '#007AFF' }} // Blue for active (ios default-ish, definitely not green)
            thumbColor={'#FFFFFF'}
          />
        </View>
      </SectionCard>

      <SectionCard title="Background Alerts">
        <StatusPill label={alertsEnabled ? '有効' : '無効'} tone={alertsEnabled ? 'ok' : 'neutral'} />
        <Text style={styles.textValue}>災害通知と周辺避難所のリアルタイム更新のため、位置情報の許可が必要です。</Text>
        {error ? <Text style={styles.mutedText}>{error}</Text> : null}
        <PrimaryButton label="有効にする" onPress={handleEnable} disabled={isWorking} />
        <SecondaryButton label="無効にする" onPress={handleDisable} disabled={isWorking} />
      </SectionCard>

      <SectionCard title="App Info">
        <TextLine label="Version" value={version} />
        <TextLine label="API" value={apiBaseUrl} />
      </SectionCard>

      <SectionCard title="Links">
        <SecondaryButton label="MySafetyPinCard" onPress={() => router.push('/mysafety')} />
        <SecondaryButton label="情報ソース" onPress={() => router.push('/sources')} />
        <SecondaryButton label="免責事項" onPress={() => router.push('/disclaimer')} />
        <SecondaryButton label="注意事項" onPress={() => router.push('/notices')} />
        <SecondaryButton label="ライセンス" onPress={() => router.push('/licenses')} />
      </SectionCard>
    </ScreenContainer>
  );
}

function TextLine({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.textLine}>
      <Text style={styles.textLabel}>{label}</Text>
      <Text style={styles.textValue}>{value}</Text>
    </View>
  );
}

const createStyles = (colors: { text: string; muted: string; border: string }) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowLabel: {
      ...typography.body,
      color: colors.text,
    },
    textLine: {
      marginBottom: spacing.sm,
    },
    textLabel: {
      ...typography.label,
      color: colors.text,
    },
    textValue: {
      ...typography.body,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    mutedText: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
  });
