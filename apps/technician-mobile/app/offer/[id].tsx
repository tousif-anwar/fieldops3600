import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { AssignmentOffer } from '../../src/contracts';
import { offerDisplayStatus, offerIsActionable } from '../../src/offers';
import { useRuntime } from '../../src/runtime';
import { useOffers } from '../../src/use-offers';
import {
  Button, EmptyState, ErrorState, InlineNotice, LoadingState, Screen, Section, StatusBadge,
} from '../../src/ui';
import { formatAppointment, formatTimestamp, priorityTone, statusTone } from '../../src/ui/model';
import { colors, radii, spacing, typography } from '../../src/ui/tokens';

interface OfferResponse {
  kind: 'accept' | 'decline';
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
}

export default function OfferDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const router = useRouter();
  const client = useQueryClient();
  const offers = useOffers();
  const offer = offers.data?.find(item => item.id === id);
  const [reason, setReason] = useState('');
  const [response, setResponse] = useState<OfferResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const respond = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (operation: OfferResponse) => {
      if (!online) throw new Error('Connect to confirm your response. Offers cannot be accepted or declined offline.');
      return (await requestApi<AssignmentOffer>(`/api/assignment-offers/${encodeURIComponent(id)}/${operation.kind}`,
        await getAccessToken(), { method: 'POST', body: {
          expectedVersion: operation.expectedVersion,
          idempotencyKey: operation.idempotencyKey,
          ...(operation.kind === 'decline' ? { reason: operation.reason } : {}),
        } })).data;
    },
    onSuccess: async updated => {
      client.setQueryData<AssignmentOffer[]>(['assignment-offers'], current => current?.map(item => item.id === updated.id ? updated : item));
      await Promise.all([
        client.invalidateQueries({ queryKey: ['assignment-offers'] }),
        client.invalidateQueries({ queryKey: ['bookings'] }),
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
      setResponse(null);
    },
    onError: () => { void offers.refetch(); },
  });
  const actionable = !!offer && offerIsActionable(offer, online, now);
  const startResponse = (kind: OfferResponse['kind']) => {
    if (!offer || !actionable || respond.isPending) return;
    const operation = { kind, expectedVersion: offer.version, idempotencyKey: Crypto.randomUUID(),
      ...(kind === 'decline' ? { reason: reason.trim() } : {}) };
    setResponse(operation);
    respond.mutate(operation);
  };
  const confirm = (kind: OfferResponse['kind']) => {
    if (!offer || !actionable) return;
    Alert.alert(kind === 'accept' ? 'Accept this appointment?' : 'Decline this offer?',
      kind === 'accept' ? `${offer.workOrderNumber}: ${formatAppointment({ ...offer, workOrderId: offer.workOrderId })}. Dispatch will receive your response.`
        : 'Your reason will be recorded for dispatch so the work can be reassigned.', [
        { text: 'Keep reviewing', style: 'cancel' },
        { text: kind === 'accept' ? 'Accept appointment' : 'Decline offer', onPress: () => startResponse(kind) },
      ]);
  };
  return (
    <Screen>
      {offers.isPending && !offer ? <LoadingState label="Opening assignment offer…" /> : null}
      {offers.error && !offer ? <ErrorState error={offers.error} retry={() => { void offers.refetch(); }} /> : null}
      {offers.data && !offer ? <EmptyState title="Offer unavailable" description="This offer is unavailable to your account. Refresh your work or contact dispatch." /> : null}
      {offer ? (
        <>
          <Section title={offer.workOrderNumber} description={offer.serviceCategory}>
            <Text accessibilityRole="header" style={styles.title}>{offer.title}</Text>
            <View style={styles.badges}>
              <StatusBadge label={offerDisplayStatus(offer, now)} tone={statusTone(offerDisplayStatus(offer, now))} />
              <StatusBadge label={offer.priority} tone={priorityTone(offer.priority)} />
            </View>
          </Section>
          <Section card title="Appointment and destination">
            <Text style={styles.body}>{formatAppointment({ ...offer, workOrderId: offer.workOrderId })}</Text>
            <Text selectable style={styles.body}>{offer.siteAddress}</Text>
            <Text style={styles.small}>Offer expires {formatTimestamp(offer.expiresAtUtc)}. Times use this device’s time zone.</Text>
            <Text style={styles.small}>Accepting confirms this booking after the server rechecks qualifications, approved hours, and schedule conflicts.</Text>
          </Section>
          {offer.status === 'Accepted' ? (
            <Section card title="Assignment confirmed">
              <Text style={styles.body}>Your appointment is confirmed. Review the job and prepare for service.</Text>
              <Button title="Open assigned job" onPress={() => router.replace({ pathname: '/job/[id]', params: { id: offer.workOrderId } })} />
            </Section>
          ) : null}
          {offer.status === 'Declined' ? <InlineNotice title="Decline recorded">Dispatch can offer the appointment to another technician. Reason: {offer.reason}</InlineNotice> : null}
          {offerDisplayStatus(offer, now) === 'Expired' || offer.status === 'Revoked' ? (
            <InlineNotice tone="warning" title="This offer is closed">Ask dispatch about current availability. A closed offer cannot confirm an appointment.</InlineNotice>
          ) : null}
          {offer.status === 'Pending' && offerDisplayStatus(offer, now) !== 'Expired' ? (
            <Section title="Your response">
              {!online ? <InlineNotice tone="warning" title="Connection required">You can review this offer. Connect before accepting or declining; capacity is confirmed by the server.</InlineNotice> : null}
              {respond.error ? (
                <InlineNotice tone="warning" title="Response not confirmed">
                  {respond.error.message} Refresh the offer to check its status before leaving this screen.
                </InlineNotice>
              ) : null}
              {response && respond.isError ? (
                <>
                  <Text style={styles.small}>Retry sends your original {response.kind === 'accept' ? 'acceptance' : 'decline'} with the same operation ID.</Text>
                  <Button title="Retry original response" disabled={!online || respond.isPending}
                    onPress={() => respond.mutate(response)} />
                </>
              ) : (
                <>
                  <Button title="Accept appointment" loading={respond.isPending && response?.kind === 'accept'}
                    disabled={!actionable || respond.isPending} onPress={() => confirm('accept')} />
                  <Text style={styles.label}>Reason for declining</Text>
                  <TextInput
                    accessibilityLabel="Reason for declining"
                    style={styles.input} multiline maxLength={500} value={reason} onChangeText={setReason}
                    placeholder="Tell dispatch why this appointment will not work"
                    placeholderTextColor={colors.muted} editable={!respond.isPending}
                  />
                  <Button title="Decline with reason" variant="secondary" loading={respond.isPending && response?.kind === 'decline'}
                    disabled={!actionable || respond.isPending || reason.trim().length < 3}
                    onPress={() => confirm('decline')} />
                </>
              )}
              <Button title="Refresh offer status" variant="quiet" disabled={!online || offers.isFetching}
                onPress={() => { void offers.refetch(); }} />
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  label: { ...typography.label, color: colors.ink },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { ...typography.body, color: colors.ink, backgroundColor: colors.surface,
    minHeight: 96, textAlignVertical: 'top', padding: spacing.md, borderWidth: 1,
    borderColor: colors.borderStrong, borderRadius: radii.md },
});
