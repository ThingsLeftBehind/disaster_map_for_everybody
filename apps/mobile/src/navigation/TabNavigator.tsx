import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet } from 'react-native';
import { theme } from '../theme';

import { MainScreen } from '../screens/MainScreen';
import { ListScreen } from '../screens/ListScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { QuakesScreen } from '../screens/QuakesScreen';
import { HazardScreen } from '../screens/HazardScreen';
import { AboutScreen } from '../screens/AboutScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
    return (
        <Text style={[styles.icon, focused && styles.iconFocused]}>
            {emoji}
        </Text>
    );
}

export function TabNavigator() {
    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: styles.tabBar,
                tabBarActiveTintColor: theme.colors.navActive,
                tabBarInactiveTintColor: theme.colors.navInactive,
                tabBarLabelStyle: styles.tabLabel,
            }}
        >
            <Tab.Screen
                name="Main"
                component={MainScreen}
                options={{
                    tabBarLabel: 'メイン',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
                }}
            />
            <Tab.Screen
                name="List"
                component={ListScreen}
                options={{
                    tabBarLabel: 'リスト',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
                }}
            />
            <Tab.Screen
                name="Alerts"
                component={AlertsScreen}
                options={{
                    tabBarLabel: '警報',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="⚠️" focused={focused} />,
                }}
            />
            <Tab.Screen
                name="Quakes"
                component={QuakesScreen}
                options={{
                    tabBarLabel: '地震',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="🌏" focused={focused} />,
                }}
            />
            <Tab.Screen
                name="Hazard"
                component={HazardScreen}
                options={{
                    tabBarLabel: 'ハザード',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="🗺️" focused={focused} />,
                }}
            />
            <Tab.Screen
                name="About"
                component={AboutScreen}
                options={{
                    tabBarLabel: '情報',
                    tabBarIcon: ({ focused }) => <TabIcon emoji="ℹ️" focused={focused} />,
                }}
            />
        </Tab.Navigator>
    );
}

const styles = StyleSheet.create({
    tabBar: {
        backgroundColor: theme.colors.navBackground,
        borderTopWidth: 0,
        paddingBottom: 4,
        paddingTop: 4,
        height: 60,
    },
    tabLabel: {
        fontSize: 10,
        fontWeight: '600',
    },
    icon: {
        fontSize: 20,
        opacity: 0.7,
    },
    iconFocused: {
        opacity: 1,
    },
});
