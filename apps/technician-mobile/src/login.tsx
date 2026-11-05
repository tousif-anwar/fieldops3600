import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './auth';
import { Button, InlineNotice } from './ui';
import { colors, radii, spacing, typography } from './ui/tokens';

export function Login() {
  const { loading, authenticating, error, login } = useAuth();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <View style={styles.mark}><Text style={styles.markText}>F</Text></View>
          <View>
            <Text style={styles.brand}>FieldOps 360</Text>
            <Text style={styles.brandSub}>Technician workspace</Text>
          </View>
        </View>
        <View style={styles.hero}>
          <Text style={styles.meta}>Field service, connected</Text>
          <Text style={styles.title}>Your next job.{'\n'}One clear step at a time.</Text>
          <Text style={styles.body}>
            Assigned work, guided service checks, and help from your team—whether
            you are at the van, on site, or finishing the last stage.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.section}>Sign in securely</Text>
          <Text style={styles.small}>
            Continue to your organization’s identity provider. This app never
            collects or stores your password.
          </Text>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.small}>Restoring your secure session…</Text>
            </View>
          ) : (
            <Button
              title={authenticating ? 'Opening secure sign in…' : 'Continue to secure sign in'}
              loading={authenticating}
              onPress={() => { void login(); }}
            />
          )}
          {error ? <InlineNotice tone="danger" title="Sign-in problem">{error}</InlineNotice> : null}
        </View>
        <View style={styles.note}>
          <View style={styles.noteRule} />
          <Text style={styles.small}>
            Drafts stay on this device. Offline submissions synchronize only after
            the server validates your access and the current workflow version.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: {
    width: '100%', maxWidth: 560, alignSelf: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl, gap: spacing.xxl,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mark: {
    width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  markText: { ...typography.title, color: colors.onPrimary },
  brand: { ...typography.section, color: colors.ink },
  brandSub: { ...typography.small, color: colors.muted },
  hero: { gap: spacing.md, paddingTop: spacing.xxl },
  meta: { ...typography.label, color: colors.primary },
  title: { ...typography.screenTitle, fontSize: 34, lineHeight: 40, color: colors.ink },
  body: { ...typography.body, color: colors.muted, maxWidth: 480 },
  card: {
    gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg,
  },
  section: { ...typography.section, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  note: { gap: spacing.md },
  noteRule: { height: 1, backgroundColor: colors.border },
});
