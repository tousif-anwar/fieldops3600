import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../api';
import { useAuth } from '../auth';
import type { CustomerServiceContext, WorkOrder } from '../contracts';
import {
  communicationConsent, customerContextPath, customerContextQueryKey,
  serviceLocationAddress, validateCustomerContext,
} from '../customer-context';
import { useRuntime } from '../runtime';
import { ErrorState, InlineNotice, LoadingState, Section } from './components';
import { colors, spacing, typography } from './tokens';

export function CustomerServiceInfo({ job }: { job: WorkOrder }) {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const path = customerContextPath(job);
  const query = useQuery({
    queryKey: customerContextQueryKey(job),
    enabled: !!path,
    // Contacts and access instructions stay in this account's current screen memory.
    // They are excluded from the persisted offline query cache and removed on exit.
    meta: { persist: false },
    gcTime: 0,
    staleTime: 0,
    refetchInterval: online ? 30_000 : false,
    retry: false,
    queryFn: async () => validateCustomerContext(job,
      (await requestApi<CustomerServiceContext>(path!, await getAccessToken())).data),
  });

  if (!path) return (
    <Section card title={job.customerName} description={`${job.serviceCategory} · Work-order snapshot`}>
      <Text style={styles.body}>{job.siteAddress}</Text>
      <Text style={styles.small}>
        This historical job has no linked customer and service location. Ask dispatch to confirm contact and access details.
      </Text>
    </Section>
  );

  return (
    <Section card title="Customer and service location">
      {query.isPending && !query.data ? (
        online ? <LoadingState label="Loading customer details…" /> : (
          <InlineNotice tone="warning">Connect to load the linked customer and access details. The work-order address is {job.siteAddress}.</InlineNotice>
        )
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : query.data ? (
        <>
          {!online ? <InlineNotice tone="warning">Details were loaded earlier in this session. Reconnect to confirm changes before contacting the customer or travelling.</InlineNotice> : null}
          <View style={styles.group}>
            <Text style={styles.heading}>{query.data.displayName}</Text>
            <Text style={styles.small}>{query.data.customerType} · Preferred communication: {query.data.preferredChannel}</Text>
          </View>
          <View style={styles.group}>
            <Text style={styles.label}>{query.data.location.name}</Text>
            <Text style={styles.body}>{serviceLocationAddress(query.data.location)}</Text>
            {query.data.location.accessNotes ? (
              <Text style={styles.body}>Access: {query.data.location.accessNotes}</Text>
            ) : <Text style={styles.small}>No access instructions have been recorded.</Text>}
            {query.data.location.status !== 'Active' ? (
              <InlineNotice tone="warning">Location status: {query.data.location.status}. Confirm access with dispatch.</InlineNotice>
            ) : null}
          </View>
          <Text style={styles.label}>Service contacts</Text>
          {query.data.contacts.length ? query.data.contacts.map(contact => (
            <View key={contact.id} style={styles.contact}>
              <Text style={styles.body}>{contact.fullName}{contact.isPrimary ? ' · Primary' : ''}</Text>
              {contact.phone ? <Text selectable style={styles.body}>{contact.phone}</Text> : null}
              {contact.email ? <Text selectable style={styles.body}>{contact.email}</Text> : null}
              <Text style={styles.small}>{communicationConsent(contact)}</Text>
            </View>
          )) : <Text style={styles.small}>No service contacts have been recorded.</Text>}
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  heading: { ...typography.section, color: colors.ink },
  label: { ...typography.label, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  contact: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
