import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth';
import { Login } from '../src/login';
import { SessionRuntime } from '../src/runtime';
import { colors, typography } from '../src/ui';

export const unstable_settings = { anchor: '(tabs)' };

function AuthenticatedApp() {
  const { session } = useAuth();
  if (!session) return <Login />;
  return (
    <SessionRuntime key={session.subject}>
      <Stack
        screenOptions={{
          headerTintColor: colors.ink,
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { ...typography.section, color: colors.ink },
          headerShadowVisible: true,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job details' }} />
        <Stack.Screen name="offer/[id]" options={{ title: 'Assignment offer' }} />
        <Stack.Screen name="job/[id]/stage/[stage]" options={{ title: 'Guided service' }} />
        <Stack.Screen name="oauth/callback" options={{ headerShown: false }} />
      </Stack>
    </SessionRuntime>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
