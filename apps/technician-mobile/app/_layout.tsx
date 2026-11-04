import { Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth';
import { Login } from '../src/login';
import { SessionRuntime } from '../src/runtime';
import { colors } from '../src/ui';

function AuthenticatedApp() {
  const { session, logout } = useAuth();
  if (!session) return <Login />;
  return <SessionRuntime key={session.subject}><Stack screenOptions={{
    headerTintColor: colors.ink,
    headerTitleStyle: { fontWeight: '600' },
    headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Sign out"
      onPress={() => { void logout(); }} style={{ padding: 12 }}><Text style={{ color: colors.blue }}>Sign out</Text></Pressable>,
  }}>
    <Stack.Screen name="index" options={{ title: 'FieldOps 360' }} />
    <Stack.Screen name="schedule" options={{ title: 'Today’s schedule' }} />
    <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    <Stack.Screen name="sync" options={{ title: 'Synchronization' }} />
    <Stack.Screen name="job/[id]" options={{ title: 'Job details' }} />
    <Stack.Screen name="job/[id]/stage/[stage]" options={{ title: 'Guided service' }} />
    <Stack.Screen name="oauth/callback" options={{ headerShown: false }} />
  </Stack></SessionRuntime>;
}

export default function RootLayout() {
  return <SafeAreaProvider><AuthProvider><AuthenticatedApp /></AuthProvider></SafeAreaProvider>;
}
