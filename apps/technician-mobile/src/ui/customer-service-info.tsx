import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../api';
import { useAuth } from '../auth';
import type { CustomerServiceContext, WorkOrder } from '../contracts';
import {
  communicationConsent,
  customerContextPath,
  customerContextQueryKey,
  serviceLocationAddress,
  validateCustomerContext,
} from '../customer-context';
import { useRuntime } from '../runtime';
import { ErrorState, InlineNotice, LoadingState, Section } from './components';
import { textStyles } from './styles';
import { colors, spacing } from './tokens';

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
    queryFn: async () =>
      validateCustomerContext(
        job,
        (await requestApi<CustomerServiceContext>(path!, await getAccessToken())).data,
      ),
  });

  if (!path)
    return (
      <Section
        title={job.customerName}
        description={`${job.serviceCategory} · Work-order snapshot`}
      >
        <Text style={textStyles.body}>{job.siteAddress}</Text>
        <Text style={textStyles.secondary}>Confirm contact and access details with dispatch.</Text>
      </Section>
    );

  return (
    <Section title="Customer and location">
      {query.isPending && !query.data ? (
        online ? (
          <LoadingState label="Loading customer details…" />
        ) : (
          <InlineNotice tone="warning">
            Connect to load the linked customer and access details. The work-order address is{' '}
            {job.siteAddress}.
          </InlineNotice>
        )
      ) : query.error ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : query.data ? (
        <>
          {!online ? (
            <InlineNotice tone="warning">
              Details were loaded earlier in this session. Reconnect to confirm changes before
              contacting the customer or travelling.
            </InlineNotice>
          ) : null}
          <View style={styles.group}>
            <Text style={textStyles.heading}>{query.data.displayName}</Text>
            <Text style={textStyles.secondary}>
              {query.data.customerType} · Preferred communication: {query.data.preferredChannel}
            </Text>
          </View>
          <View style={styles.group}>
            <Text style={textStyles.label}>{query.data.location.name}</Text>
            <Text style={textStyles.body}>{serviceLocationAddress(query.data.location)}</Text>
            {query.data.location.accessNotes ? (
              <Text style={textStyles.body}>Access: {query.data.location.accessNotes}</Text>
            ) : (
              <Text style={textStyles.secondary}>No access instructions.</Text>
            )}
            {query.data.location.status !== 'Active' ? (
              <InlineNotice tone="warning">
                Location status: {query.data.location.status}. Confirm access with dispatch.
              </InlineNotice>
            ) : null}
          </View>
          <Text style={textStyles.label}>Service contacts</Text>
          {query.data.contacts.length ? (
            query.data.contacts.map((contact) => (
              <View key={contact.id} style={styles.contact}>
                <Text style={textStyles.body}>
                  {contact.fullName}
                  {contact.isPrimary ? ' · Primary' : ''}
                </Text>
                {contact.phone ? (
                  <Text selectable style={textStyles.body}>
                    {contact.phone}
                  </Text>
                ) : null}
                {contact.email ? (
                  <Text selectable style={textStyles.body}>
                    {contact.email}
                  </Text>
                ) : null}
                <Text style={textStyles.secondary}>{communicationConsent(contact)}</Text>
              </View>
            ))
          ) : (
            <Text style={textStyles.secondary}>No service contacts.</Text>
          )}
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  contact: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
