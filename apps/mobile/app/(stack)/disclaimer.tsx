import { useRouter } from 'expo-router';

import { Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function DisclaimerScreen() {
  const router = useRouter();

  return (
    <Screen title="Disclaimer" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>Reference Only</SectionTitle>
        <TextBlock>This app provides reference information from official sources.</TextBlock>
        <TextBlock muted>Follow local guidance and official instructions in emergencies.</TextBlock>
      </Card>
    </Screen>
  );
}
