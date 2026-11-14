import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import type { AssignmentOffer } from '../contracts';
import { pendingOffers } from '../offers';
import { Button, Section, StatusBadge } from './components';
import { formatTime, formatTimestamp, priorityTone } from './model';
import { colors, spacing, typography } from './tokens';

export function OfferInbox({ offers, now }: { offers: AssignmentOffer[]; now: number }) {
  const router = useRouter();
  const pending = pendingOffers(offers, now);
  if (!pending.length) return null;
  return (
    <Section title="New assignment offers" description="Review the appointment before accepting. The server confirms availability.">
      <View style={{ gap: spacing.md }}>
        {pending.map(offer => (
          <Section key={offer.id} card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <StatusBadge label={offer.priority} tone={priorityTone(offer.priority)} />
              <StatusBadge label="Response needed" tone="warning" />
            </View>
            <Text style={{ ...typography.section, color: colors.ink }}>{offer.workOrderNumber} · {offer.title}</Text>
            <Text style={{ ...typography.body, color: colors.ink }}>{offer.siteAddress}</Text>
            <Text style={{ ...typography.small, color: colors.muted }}>
              {formatTimestamp(offer.startUtc)}–{formatTime(offer.endUtc)} · Expires {formatTime(offer.expiresAtUtc)}
            </Text>
            <Button title="Review offer" onPress={() => router.push({ pathname: '/offer/[id]', params: { id: offer.id } })} />
          </Section>
        ))}
      </View>
    </Section>
  );
}
