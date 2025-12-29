import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionTitle, TextBlock } from '@/src/ui/kit';

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <Screen title="Settings" leftAction={{ label: 'Back', onPress: () => router.back() }}>
      <Card>
        <SectionTitle>Preferences</SectionTitle>
        <TextBlock>Notification and location controls will appear here.</TextBlock>
      </Card>
      <Card>
        <SectionTitle>About</SectionTitle>
        <TextBlock>Official sources and disclaimers are available below.</TextBlock>
      </Card>
      <Button label="Sources" variant="secondary" onPress={() => router.push('/sources')} />
      <Button label="Disclaimer" variant="secondary" onPress={() => router.push('/disclaimer')} />
    </Screen>
  );
}
