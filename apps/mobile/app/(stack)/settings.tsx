import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { getApiBaseUrl } from '@/src/api/client';
import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function SettingsScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown';
  const apiBaseUrl = getApiBaseUrl();

  return (
    <Screen title="Settings" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>App</SectionTitle>
        <TextBlock>Version: {version}</TextBlock>
        <TextBlock>API: {apiBaseUrl}</TextBlock>
      </Card>

      <Card>
        <SectionTitle>Information</SectionTitle>
        <Button label="Sources" variant="secondary" onPress={() => router.push('/sources')} />
        <Button label="Disclaimer" variant="secondary" onPress={() => router.push('/disclaimer')} />
      </Card>
    </Screen>
  );
}
