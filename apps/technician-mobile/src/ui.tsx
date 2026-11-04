import { Link } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRuntime } from './runtime';

export const colors = { ink: '#15283b', muted: '#526477', blue: '#075fa9', blueWash: '#edf5fc',
  border: '#d6e0e9', surface: '#ffffff', canvas: '#f3f6f9', success: '#146c43',
  danger: '#a61b29', warning: '#805b08' };

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, gap: 16, paddingBottom: 50, width: '100%', maxWidth: 800, alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 18, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 18, fontWeight: '600', color: colors.ink },
  body: { fontSize: 16, color: colors.ink, lineHeight: 24 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondary: { backgroundColor: colors.surface, borderColor: colors.blue, borderWidth: 1 },
  secondaryText: { color: colors.blue, fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, color: colors.ink, backgroundColor: colors.surface },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.blueWash },
  badgeText: { fontSize: 13, fontWeight: '600', color: colors.blue },
});

export function Button({ title, onPress, disabled = false, secondary = false }: {
  title: string; onPress(): void; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button,
      secondary && styles.secondary, { opacity: disabled ? .45 : pressed ? .75 : 1 }]}>
    <Text style={secondary ? styles.secondaryText : styles.buttonText}>{title}</Text>
  </Pressable>;
}

export function Screen({ children }: React.PropsWithChildren) {
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.page}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic">
    <ConnectionBanner />{children}
    </ScrollView>
  </SafeAreaView>;
}

export function ConnectionBanner() {
  const { online, submissions, queueError } = useRuntime();
  const pending = submissions.filter(item => item.status !== 'synced').length;
  return <View accessibilityLiveRegion="polite" style={[styles.card, { padding: 12, backgroundColor: colors.blueWash }]}>
    <Text style={styles.body}>{online ? '● Online' : '○ Offline — saved work remains on this device'}{pending ? ` · ${pending} awaiting sync` : ''}</Text>
    {!online && <Text style={styles.muted}>Countdowns are estimates. Server deadlines continue while offline.</Text>}
    {queueError && <Text style={styles.error}>{queueError}</Text>}
    <View style={styles.row}>
      <Link href="/" style={styles.secondaryText}>My jobs</Link>
      <Link href="/schedule" style={styles.secondaryText}>Schedule</Link>
      <Link href="/notifications" style={styles.secondaryText}>Alerts</Link>
      <Link href="/sync" style={styles.secondaryText}>Sync</Link>
    </View>
  </View>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <View style={styles.card}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>{label}</Text></View>;
}

export function ErrorMessage({ error, retry }: { error: Error; retry?(): void }) {
  return <View accessibilityRole="alert" style={styles.card}>
    <Text style={styles.error}>{error.message}</Text>
    {retry && <Button title="Try again" secondary onPress={retry} />}
  </View>;
}

export function Badge({ children }: React.PropsWithChildren) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{children}</Text></View>;
}
