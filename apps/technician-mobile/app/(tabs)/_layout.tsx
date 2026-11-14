import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRuntime } from '../../src/runtime';
import { colors, spacing, touch, typography } from '../../src/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  return ({ focused, size }: { focused: boolean; size: number }) => (
    <Ionicons name={name} size={size} color={focused ? colors.primary : colors.subtle} />
  );
}

export default function TabsLayout() {
  const { submissions } = useRuntime();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const pending = submissions.filter((item) => item.status !== 'synced').length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height:
            touch.minimum + typography.caption.lineHeight * Math.max(1, fontScale) + insets.bottom,
          paddingTop: spacing.xs,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
        tabBarItemStyle: { minHeight: touch.minimum },
        tabBarLabelStyle: { ...typography.caption },
        tabBarAllowFontScaling: true,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
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
          tabBarBadgeStyle: {
            backgroundColor: colors.danger,
            color: colors.onPrimary,
            fontSize: typography.caption.fontSize,
          },
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
