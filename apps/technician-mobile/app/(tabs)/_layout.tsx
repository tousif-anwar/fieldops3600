import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRuntime } from '../../src/runtime';
import { colors, typography } from '../../src/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  return ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons name={name} size={size} color={color as string | undefined} />
  );
}

export default function TabsLayout() {
  const { submissions } = useRuntime();
  const insets = useSafeAreaInsets();
  const pending = submissions.filter(item => item.status !== 'synced').length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarItemStyle: { minHeight: 56 },
        tabBarLabelStyle: { ...typography.label, fontSize: 11, lineHeight: 15 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Jobs', tabBarIcon: icon('briefcase-outline') }}
      />
      <Tabs.Screen
        name="schedule"
        options={{ title: 'Schedule', tabBarIcon: icon('calendar-outline') }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ title: 'Alerts', tabBarIcon: icon('notifications-outline') }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarIcon: icon('sync-outline'),
          tabBarBadge: pending || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onPrimary, fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
