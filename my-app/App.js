import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider } from './src/context/SessionContext';
import DashboardScreen from './src/screens/DashboardScreen';
import SessionScreen   from './src/screens/SessionScreen';
import CheckinScreen   from './src/screens/CheckinScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerShown:      false,
              animation:        'slide_from_right',
              contentStyle:     { backgroundColor: '#05050A' },
            }}
            initialRouteName="Dashboard"
          >
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="Session"   component={SessionScreen} />
            <Stack.Screen
              name="Checkin"
              component={CheckinScreen}
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
