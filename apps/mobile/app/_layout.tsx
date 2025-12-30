import 'react-native-reanimated';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from '@/src/ui/theme';
import { DrawerProvider } from '@/src/ui/drawer';
import { registerNotificationListeners } from '@/src/push/notifications';
import { triggerMainRefresh } from '@/src/push/events';
import '@/src/push/service';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

function RootLayoutInner() {
  const router = useRouter();
  const { colors, themeName } = useTheme();

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
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} backgroundColor={colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </DrawerProvider>
  );
}
