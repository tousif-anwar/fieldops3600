import { Alert, Text, View } from 'react-native';
import { useRuntime } from '../src/runtime';
import { Button, Screen, styles } from '../src/ui';

export default function Synchronization() {
  const { queue, submissions, synchronize, online } = useRuntime();
  const pending = submissions.filter(item => item.status !== 'synced');
  return <Screen><Text accessibilityRole="header" style={styles.title}>Synchronization</Text>
    <Text style={styles.body}>Submissions keep the same idempotency key on each retry. The server checks access, stage order, and version before accepting them.</Text>
    <Button title="Synchronize now" disabled={!online} onPress={() => { void synchronize(); }} />
    {!pending.length && <View style={styles.card}><Text style={styles.subtitle}>Everything is synchronized</Text>
      <Text style={styles.muted}>Saved drafts remain available within each job.</Text></View>}
    {pending.map(item => <View style={styles.card} key={item.id}>
      <Text style={styles.subtitle}>Stage {item.stageIndex + 1} · {item.status}</Text>
      <Text style={styles.muted}>Saved {new Date(item.clientOccurredAtUtc).toLocaleString()} · {item.attempts} delivery attempts</Text>
      {Object.entries(item.answers).map(([field, answer]) => <Text key={field} style={styles.body}>{field}: {answer}</Text>)}
      {item.lastError && <Text style={styles.error}>{item.lastError}</Text>}
      {item.status === 'conflict' && <Text style={styles.body}>The workflow changed on the server. Discard this queued submission, refresh the job, then review the current stage. Answers will never be applied to a different stage automatically.</Text>}
      {(item.status === 'failed' || item.status === 'conflict') && <Button title="Discard queued submission" secondary onPress={() => Alert.alert(
        'Discard this submission?', 'This removes only the local queued action. The server history is unchanged.',
        [{ text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void queue.discard(item.id); } }],
      )} />}
    </View>)}
    {submissions.some(item => item.status === 'synced') && <View style={styles.card}>
      <Text style={styles.subtitle}>Recent receipts</Text>
      {submissions.filter(item => item.status === 'synced').slice(-5).reverse().map(item =>
        <Text key={item.id} style={styles.muted}>Stage {item.stageIndex + 1}: accepted{item.serverReceivedAtUtc ? ` · server ${new Date(item.serverReceivedAtUtc).toLocaleString()}` : ''}</Text>)}
    </View>}
  </Screen>;
}
