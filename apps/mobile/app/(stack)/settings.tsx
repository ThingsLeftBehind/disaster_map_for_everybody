import { useCallback, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { getApiBaseUrl } from '@/src/api/client';
import { Button, Card, Screen, SectionTitle, TextBlock, Toggle } from '@/src/ui/kit';
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

  const handleToggle = useCallback(() => {
    if (isWorking) return;
    if (alertsEnabled) {
      void handleDisable();
    } else {
      void handleEnable();
    }
  }, [alertsEnabled, handleDisable, handleEnable, isWorking]);

  return (
    <Screen title="Settings" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>App</SectionTitle>
        <TextBlock>Version: {version}</TextBlock>
        <TextBlock>API: {apiBaseUrl}</TextBlock>
      </Card>

      <Card>
        <SectionTitle>Background Alerts</SectionTitle>
        <TextBlock muted>災害情報の通知と周辺避難所の更新に、通知と位置情報の許可が必要です。</TextBlock>
        <Toggle label={alertsEnabled ? 'Background alerts: ON' : 'Background alerts: OFF'} value={alertsEnabled} onToggle={handleToggle} />
        <TextBlock>Status: {alertsEnabled ? 'Enabled' : 'Disabled'}</TextBlock>
        {error ? <TextBlock muted>{error}</TextBlock> : null}
        <Button label="Enable background alerts" onPress={handleEnable} disabled={isWorking} />
        <Button label="Disable background alerts" variant="secondary" onPress={handleDisable} disabled={isWorking} />
      </Card>

      <Card>
        <SectionTitle>Information</SectionTitle>
        <Button label="Sources" variant="secondary" onPress={() => router.push('/sources')} />
        <Button label="Disclaimer" variant="secondary" onPress={() => router.push('/disclaimer')} />
      </Card>
    </Screen>
  );
}
