import { Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth';
import { Login } from '../src/login';
import { SessionRuntime } from '../src/runtime';
import { colors, spacing, touch, typography } from '../src/ui';

function SignOut() {
  const { logout } = useAuth();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      onPress={() => { void logout(); }}
      style={{ minHeight: touch.minimum, justifyContent: 'center', paddingHorizontal: spacing.sm }}
    >
      <Text style={{ ...typography.label, color: colors.primary }}>Sign out</Text>
    </Pressable>
  );
}

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
          headerTitleStyle: { fontWeight: '600', color: colors.ink },
          headerShadowVisible: true,
          headerRight: () => <SignOut />,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job details' }} />
        <Stack.Screen name="job/[id]/stage/[stage]" options={{ title: 'Guided service' }} />
        <Stack.Screen name="oauth/callback" options={{ headerShown: false }} />
      </Stack>
    </SessionRuntime>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
