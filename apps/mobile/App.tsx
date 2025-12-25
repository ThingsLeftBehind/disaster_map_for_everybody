import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabNavigator } from './src/navigation/TabNavigator';

export default function App() {
    return (
        <SafeAreaProvider>
            <NavigationContainer>
                <StatusBar style="light" />
                <TabNavigator />
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
