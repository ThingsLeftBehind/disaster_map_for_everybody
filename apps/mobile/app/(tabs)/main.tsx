import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function MainScreen() {
  const router = useRouter();

  return (
    <Screen title="Main" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>Nearby Shelters</SectionTitle>
        <TextBlock>Waiting for location. Nearby shelters will appear here.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Map</SectionTitle>
        <TextBlock>Map placeholder for nearby shelters.</TextBlock>
      </Card>
      <Button label="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
