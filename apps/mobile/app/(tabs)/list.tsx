import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function ListScreen() {
  const router = useRouter();

  return (
    <Screen title="List" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>Search</SectionTitle>
        <TextBlock>Search by prefecture, municipality, or keyword.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>Filters</SectionTitle>
        <TextBlock>Hazard filters will appear here.</TextBlock>
      </Card>
      <Button label="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
