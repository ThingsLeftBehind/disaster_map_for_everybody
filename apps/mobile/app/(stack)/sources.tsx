import { useRouter } from 'expo-router';

import { Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function SourcesScreen() {
  const router = useRouter();

  return (
    <Screen title="Sources" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>Official Sources</SectionTitle>
        <TextBlock>JMA warnings and earthquake data are from official sources.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Notes</SectionTitle>
        <TextBlock>Data is provided for reference only.</TextBlock>
      </Card>
    </Screen>
  );
}
