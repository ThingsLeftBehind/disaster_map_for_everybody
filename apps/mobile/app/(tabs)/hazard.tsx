import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function HazardScreen() {
  const router = useRouter();

  return (
    <Screen title="Hazard" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>Hazard Layers</SectionTitle>
        <TextBlock>Layers are off by default. Enable only when needed.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Layer Cautions</SectionTitle>
        <TextBlock>Always-on cautions and usage notes appear here.</TextBlock>
      </Card>
      <Button label="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
