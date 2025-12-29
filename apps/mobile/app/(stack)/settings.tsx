import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { colors, spacing, typography } from '@/src/ui/theme';
import { disableBackgroundAlerts, enableBackgroundAlerts, getBackgroundStatus } from '@/src/push/service';

export default function SettingsScreen() {
  const router = useRouter();
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
    <ScreenContainer title="Settings" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <SectionCard title="Background Alerts">
        <StatusPill label={alertsEnabled ? '有効' : '無効'} tone={alertsEnabled ? 'ok' : 'neutral'} />
        <TextLine label="説明" value="災害通知と周辺避難所の更新に通知と位置情報の許可が必要です。" />
        {error ? <Text style={styles.mutedText}>{error}</Text> : null}
        <PrimaryButton label="有効にする" onPress={handleEnable} disabled={isWorking} />
        <SecondaryButton label="無効にする" onPress={handleDisable} disabled={isWorking} />
      </SectionCard>

      <SectionCard title="App Info">
        <TextLine label="Version" value={version} />
        <TextLine label="API" value={apiBaseUrl} />
      </SectionCard>

      <SectionCard title="Links">
        <SecondaryButton label="Sources" onPress={() => router.push('/sources')} />
        <SecondaryButton label="Disclaimer" onPress={() => router.push('/disclaimer')} />
      </SectionCard>
    </ScreenContainer>
  );
}

function TextLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.textLine}>
      <Text style={styles.textLabel}>{label}</Text>
      <Text style={styles.textValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
