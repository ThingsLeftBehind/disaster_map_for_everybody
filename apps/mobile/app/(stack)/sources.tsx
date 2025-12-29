import { useRouter } from 'expo-router';

import { Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function SourcesScreen() {
  const router = useRouter();

  return (
    <Screen title="Sources" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>Official Sources</SectionTitle>
        <TextBlock>JMA warnings/advisories and earthquake data are from official sources.</TextBlock>
        <TextBlock>Hazard layers are provided by GSI.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Notes</SectionTitle>
        <TextBlock muted>Data is provided for reference only. Follow official guidance in emergencies.</TextBlock>
      </Card>
    </Screen>
  );
}
