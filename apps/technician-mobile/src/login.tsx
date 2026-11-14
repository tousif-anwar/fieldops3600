import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './auth';
import { Button, InlineNotice } from './ui';
import { borders, colors, dimensions, radii, spacing, touch, typography } from './ui/tokens';

export function Login() {
  const { loading, authenticating, error, login } = useAuth();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>
          FieldOps 360
        </Text>
        <Text style={styles.subtitle}>Technician sign-in</Text>
        <Text style={styles.body}>Use your company account to access assigned work.</Text>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Restoring session…</Text>
          </View>
        ) : (
          <Button
            title={authenticating ? 'Opening sign-in…' : 'Sign in'}
            loading={authenticating}
            onPress={() => {
              void login();
            }}
          />
        )}
        {error ? (
          <InlineNotice tone="danger" title="Sign-in failed">
            {error}
          </InlineNotice>
        ) : null}
        <View style={styles.note}>
          <Text style={styles.body}>Your password stays with your identity provider.</Text>
          <Text style={styles.body}>
            Drafts stay on this device. Queued work is accepted only after server validation.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: {
    width: '100%',
    maxWidth: dimensions.readableMax,
    alignSelf: 'center',
    padding: spacing.xxl,
    paddingTop: spacing.massive,
    gap: spacing.lg,
  },
  title: { ...typography.screenTitle, color: colors.ink },
  subtitle: { ...typography.section, color: colors.ink },
  body: { ...typography.small, color: colors.muted },
  loading: {
    minHeight: touch.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  note: {
    borderTopWidth: borders.thin,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.sm,
  },
});
