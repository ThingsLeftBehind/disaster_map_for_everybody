import { useRouter } from 'expo-router';

import { Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function DisclaimerScreen() {
  const router = useRouter();

  return (
    <Screen title="Disclaimer" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>Reference Only</SectionTitle>
        <TextBlock>This app provides reference information for emergency support.</TextBlock>
        <TextBlock muted>Always follow official instructions from local authorities.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Availability</SectionTitle>
        <TextBlock muted>Data may be delayed or unavailable during outages.</TextBlock>
      </Card>
    </Screen>
  );
}
