import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function QuakesScreen() {
  const router = useRouter();

  return (
    <Screen title="Quakes" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>Recent Quakes</SectionTitle>
        <TextBlock>Recent earthquake reports will appear here.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Strong Shaking</SectionTitle>
        <TextBlock>Strong shaking events will be highlighted here.</TextBlock>
      </Card>
      <Button label="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
