import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth';
import { useRuntime } from '../../src/runtime';
import {
  Button, InlineNotice, Screen, ScreenHeader, Section, StatusBadge,
} from '../../src/ui';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function Account() {
  const { session, logout, error } = useAuth();
  const { online, submissions } = useRuntime();
  const pending = submissions.filter(item => item.status !== 'synced').length;
  return (
    <Screen topInset>
      <ScreenHeader
        title="Account"
        description="Your secure technician session and local work state."
      />
      <Section card title={session?.displayName ?? 'Technician'} description="Signed in to FieldOps 360">
        <View style={styles.statusRow}>
          <StatusBadge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'} />
          <StatusBadge
            label={pending ? `${pending} waiting to sync` : 'All work synced'}
            tone={pending ? 'warning' : 'success'}
          />
        </View>
        <Text style={styles.small}>
          Your access token is stored in this device’s secure storage. Drafts and queued
          submissions remain available without a connection.
        </Text>
        <Link href="/sync" style={styles.link}>Review synchronization</Link>
      </Section>
      <Section title="Device storage" description="What stays on this phone">
        <Text style={styles.body}>
          Draft answers are kept on this device so an interrupted job can be resumed.
          A queued submission is not an accepted stage until the server confirms it.
        </Text>
        <Text style={styles.small}>
          This development build uses OS-protected storage for the session, not full
          application-level encryption of draft data. Sign out on a shared device.
        </Text>
      </Section>
      {error ? <InlineNotice tone="danger" title="Secure session notice">{error}</InlineNotice> : null}
      <Button
        title="Sign out"
        variant="secondary"
        onPress={() => { void logout(); }}
        hint="Clears this device’s session and opens the identity provider sign-out page"
      />
      <Text style={styles.footer}>FieldOps 360 · Technician workspace</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  body: { ...typography.body, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  link: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  footer: { ...typography.small, color: colors.subtle, textAlign: 'center', marginTop: spacing.sm },
});
