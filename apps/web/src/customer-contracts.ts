export interface CustomerContact {
  id?: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  emailConsent: boolean;
  phoneConsent: boolean;
}
export interface ServiceLocation {
  id?: string;
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  countryCode: string;
  accessNotes?: string | null;
  status: "Active" | "Archived";
}
export interface CustomerInput {
  displayName: string;
  customerType: "Residential" | "Commercial";
  teamId: string;
  status: "Active" | "Archived";
  preferredChannel: "None" | "Email" | "Phone";
  contacts: CustomerContact[];
  locations: ServiceLocation[];
}
export interface Customer extends CustomerInput {
  id: string;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CustomerChange {
  id: string;
  customerId: string;
  version: number;
  actorId: string;
  occurredAtUtc: string;
  eventType: string;
  changedFields: string[];
}
export interface CustomerServiceContext {
  customerId: string;
  displayName: string;
  customerType: string;
  preferredChannel: string;
  version: number;
  location: ServiceLocation;
  contacts: CustomerContact[];
}
export function locationAddress(location: ServiceLocation) {
  return [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.region,
    location.postalCode,
    location.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}
