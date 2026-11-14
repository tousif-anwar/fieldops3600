import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { AssignmentOffer } from '../contracts';
import { Button, StatusBadge } from './components';
import { formatTime, formatTimestamp, priorityTone } from './model';
import { listStyles, textStyles } from './styles';
import { spacing } from './tokens';

export function OfferRow({ offer }: { offer: AssignmentOffer }) {
  const router = useRouter();
  return (
    <View style={listStyles.row}>
      <View style={styles.badges}>
        <StatusBadge label={offer.priority} tone={priorityTone(offer.priority)} />
        <Text style={textStyles.secondary}>Expires {formatTime(offer.expiresAtUtc)}</Text>
      </View>
      <Text style={textStyles.heading}>
        {offer.workOrderNumber} · {offer.title}
      </Text>
      <Text style={textStyles.body}>{offer.siteAddress}</Text>
      <Text style={textStyles.secondary}>
        {formatTimestamp(offer.startUtc)}–{formatTime(offer.endUtc)}
      </Text>
      <Button
        title="Review offer"
        variant="secondary"
        onPress={() => router.push({ pathname: '/offer/[id]', params: { id: offer.id } })}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
