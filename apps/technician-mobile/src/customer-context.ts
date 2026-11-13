import type { CustomerServiceContext, WorkOrder } from './contracts';

export function customerContextPath(job: WorkOrder): string | null {
  if (!job.customerId || !job.serviceLocationId) return null;
  return `/api/customers/${encodeURIComponent(job.customerId)}/service-context?workOrderId=${encodeURIComponent(job.id)}`;
}

export function customerContextQueryKey(job: WorkOrder) {
  return ['customer-service-context', job.id, job.customerId, job.serviceLocationId] as const;
}

export function validateCustomerContext(job: WorkOrder, context: CustomerServiceContext): CustomerServiceContext {
  if (!job.customerId || !job.serviceLocationId
    || context.customerId !== job.customerId || context.location?.id !== job.serviceLocationId) {
    throw new Error('The customer or service location changed. Refresh the job before viewing these details.');
  }
  return context;
}

export function serviceLocationAddress(location: CustomerServiceContext['location']): string {
  return [location.addressLine1, location.addressLine2,
    [location.city, location.region, location.postalCode].filter(Boolean).join(', '),
    location.countryCode].filter(value => value?.trim()).join('\n');
}

export function communicationConsent(contact: CustomerServiceContext['contacts'][number]): string {
  return `Email consent: ${contact.emailConsent ? 'given' : 'not given'} · Phone consent: ${contact.phoneConsent ? 'given' : 'not given'}`;
}
