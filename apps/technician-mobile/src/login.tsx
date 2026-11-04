import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './auth';
import { Button, colors, styles } from './ui';

export function Login() {
  const { loading, authenticating, error, login } = useAuth();
  return <SafeAreaView style={[styles.page, { justifyContent: 'center' }]}>
    <View style={[styles.content, { gap: 24 }]}>
      <View style={{ backgroundColor: colors.blue, padding: 16, borderRadius: 18, alignSelf: 'flex-start' }}>
        <Text style={{ fontSize: 30, fontWeight: '800', color: 'white' }}>F360</Text>
      </View>
      <Text style={styles.muted}>FIELD SERVICE, CONNECTED</Text>
      <Text style={[styles.title, { fontSize: 38 }]}>Your next job.{"\n"}One clear step at a time.</Text>
      <Text style={styles.body}>Assigned work, guided service forms, and help from your team—wherever the day takes you.</Text>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Technician sign in</Text>
        <Text style={styles.muted}>Continue to your organization’s secure sign-in page. Your password is never collected by this app.</Text>
        {loading ? <ActivityIndicator color={colors.blue} />
          : <Button title={authenticating ? 'Opening secure sign in…' : 'Sign in securely'}
            disabled={authenticating} onPress={() => { void login(); }} />}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </View>
      <Text style={styles.muted}>Drafts stay on this device. Offline submissions synchronize only after the server validates your access and the current workflow version.</Text>
    </View>
  </SafeAreaView>;
}
