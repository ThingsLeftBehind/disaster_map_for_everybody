import FontAwesome from '@expo/vector-icons/FontAwesome';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Platform, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/src/ui/theme';

function TabIcon({ name, color, focused }: { name: ComponentProps<typeof FontAwesome>['name']; color: string; focused: boolean }) {
  // We handle color in the container for active state, but here we just pass it through
  // Actually, we need to handle the specialized styling for the active tab (Circle/Background)
  // But wait, the requirement is "Background BLACK", "Icon+Label WHITE".
  // The standard TabBar doesn't easily support "Background Color per Tab" unless we use a custom button or trickery.
  // OR we can rely on `tabBarActiveBackgroundColor` if it applies to the item.
  // Let's rely on standard props first, but `tabBarActiveBackgroundColor` affects the whole tab item height.
  // Let's try standard props: activeBackgroundColor='#000000', inactiveBackgroundColor='transparent'.
  return <FontAwesome size={20} name={name} color={color} style={{ marginBottom: 2 }} />;
}

export default function TabLayout() {
  const { colors, themeName } = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const paddingBottom = Math.max(insets.bottom, isWeb ? 10 : 6);
  const baseHeight = isWeb ? 64 : 58;
  // C0: Dark Mode & C3: Active Tab Styling
  // Requirement:
  // Active: Background BLACK, Icon+Label WHITE.
  // Inactive: Background Transparent/White (Light) or Black (Dark), Icon+Label Black (Light) or White (Dark).
  // "Dark mode inverse":
  // Light Mode: Active=BlackBG/WhiteText. Inactive=WhiteBG/BlackText.
  // Dark Mode: Active=WhiteBG/BlackText (Inverse of BlackBG)? Or still BlackBG/WhiteText?
  // "When inactive: background transparent/white (light), black text/icon; dark mode inverse."
  //    -> Light Inactive: White BG, Black Text.
  //    -> Dark Inactive: Black BG, White Text.
  // "Active: background BLACK, icon+label WHITE." (This sounds like a fixed high-contrast look, or maybe it inverts too?)
  // Let's assume Active is ALWAYS high contrast against the Inactive.
  // If Dark Mode Inactive is Black BG, having Active also be Black BG wouldn't work.
  // Interpretation: active state should stand out.
  // Light Mode: Active = Black BG, White Text. Inactive = White BG, Black Text.
  // Dark Mode: Active = White BG, Black Text. Inactive = Black BG, White Text. (True Inverse)

  const isDark = themeName === 'dark';

  const activeBg = isDark ? '#FFFFFF' : '#000000';
  const activeFg = isDark ? '#000000' : '#FFFFFF';

  const inactiveBg = isDark ? '#000000' : '#FFFFFF';
  const inactiveFg = isDark ? '#FFFFFF' : '#000000';

  return (
    <Tabs
      initialRouteName="main"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeFg,
        tabBarInactiveTintColor: inactiveFg,
        tabBarActiveBackgroundColor: activeBg,
        tabBarInactiveBackgroundColor: inactiveBg,
        tabBarStyle: [
          {
            backgroundColor: inactiveBg,
            borderTopColor: colors.border,
            height: baseHeight + paddingBottom,
            paddingBottom,
            paddingTop: isWeb ? 0 : 0, // Reset padding to fill background
          },
        ],
        tabBarItemStyle: {
          // Ensure the background color fills the tab
          paddingTop: isWeb ? 8 : 6,
          // We might need margin adjustment
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginBottom: 4,
        },
      }}
    >
      <Tabs.Screen
        name="main"
        options={{
          title: 'メイン',
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: '避難所',
          tabBarIcon: ({ color, focused }) => <TabIcon name="list" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: '警報',
          tabBarIcon: ({ color, focused }) => <TabIcon name="bell" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="quakes"
        options={{
          title: '地震',
          tabBarIcon: ({ color, focused }) => <TabIcon name="bolt" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="hazard"
        options={{
          title: 'ハザード',
          tabBarIcon: ({ color, focused }) => <TabIcon name="map" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
