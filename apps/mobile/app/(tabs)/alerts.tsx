import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function AlertsScreen() {
  const router = useRouter();

  return (
    <Screen title="Alerts" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>JMA Warnings</SectionTitle>
        <TextBlock>Warnings, advisories, and special warnings will appear here.</TextBlock>
        <TextBlock muted>Tokyo mainland and islands are grouped separately.</TextBlock>
      </Card>
      <Button label="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
