import FontAwesome from '@expo/vector-icons/FontAwesome';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/src/ui/theme';

function TabIcon({ name, color }: { name: ComponentProps<typeof FontAwesome>['name']; color: string }) {
  return <FontAwesome size={18} name={name} color={color} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const paddingBottom = Math.max(insets.bottom, isWeb ? 10 : 6);
  const baseHeight = isWeb ? 64 : 58;

  return (
    <Tabs
      initialRouteName="main"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: [
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            height: baseHeight + paddingBottom,
            minHeight: baseHeight + paddingBottom,
            paddingBottom,
            paddingTop: isWeb ? 8 : 6,
          },
        ],
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="main"
        options={{
          title: 'メイン',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: '避難所',
          tabBarIcon: ({ color }) => <TabIcon name="list" color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: '警報',
          tabBarIcon: ({ color }) => <TabIcon name="bell" color={color} />,
        }}
      />
      <Tabs.Screen
        name="quakes"
        options={{
          title: '地震',
          tabBarIcon: ({ color }) => <TabIcon name="bolt" color={color} />,
        }}
      />
      <Tabs.Screen
        name="hazard"
        options={{
          title: 'ハザード',
          tabBarIcon: ({ color }) => <TabIcon name="map" color={color} />,
        }}
      />
    </Tabs>
  );
}
