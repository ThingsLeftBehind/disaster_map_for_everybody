import 'react-native-reanimated';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/src/ui/theme';
import { DrawerProvider } from '@/src/ui/drawer';
import { registerNotificationListeners } from '@/src/push/notifications';
import { triggerMainRefresh } from '@/src/push/events';
import '@/src/push/service';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const unsubscribe = registerNotificationListeners(() => {
      router.replace('/main');
      triggerMainRefresh({ reason: 'push' });
    });
    return unsubscribe;
  }, [router]);

  return (
    <DrawerProvider>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </DrawerProvider>
  );
}
