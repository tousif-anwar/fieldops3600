import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CustomerServiceContext,
  WorkOrder,
} from "../../apps/technician-mobile/src/contracts";
import {
  communicationConsent,
  customerContextPath,
  customerContextQueryKey,
  serviceLocationAddress,
  validateCustomerContext,
} from "../../apps/technician-mobile/src/customer-context";

const job: WorkOrder = {
  id: "work-order-1",
  number: "WO-1",
  title: "Cooling inspection",
  customerName: "Snapshot name",
  siteAddress: "Snapshot address",
  customerId: "customer-1",
  serviceLocationId: "location-1",
  serviceCategory: "HVAC",
  priority: "Normal",
  status: "Assigned",
  teamId: "team-1",
  technicianId: "technician-1",
  createdAtUtc: "2026-11-05T12:00:00Z",
  version: 1,
};
const context: CustomerServiceContext = {
  customerId: "customer-1",
  displayName: "Current customer",
  customerType: "Business",
  preferredChannel: "Phone",
  version: 2,
  location: {
    id: "location-1",
    name: "North site",
    addressLine1: "1 Example Avenue",
    addressLine2: null,
    city: "Test City",
    region: "NY",
    postalCode: "10001",
    countryCode: "US",
    accessNotes: "Check in at reception.",
    status: "Active",
  },
  contacts: [
    {
      id: "contact-1",
      fullName: "Synthetic Contact",
      phone: "+1-555-0100",
      email: "contact@example.test",
      isPrimary: true,
      emailConsent: false,
      phoneConsent: true,
    },
  ],
};

test("customer details require a linked location and an explicit work-order scope", () => {
  assert.equal(
    customerContextPath(job),
    "/api/customers/customer-1/service-context?workOrderId=work-order-1",
  );
  assert.equal(customerContextPath({ ...job, customerId: null }), null);
  assert.equal(customerContextPath({ ...job, serviceLocationId: null }), null);
  assert.equal(
    customerContextPath({
      ...job,
      customerId: undefined,
      serviceLocationId: undefined,
    }),
    null,
  );
});

test("scope identifiers are encoded as path and query values", () => {
  const path = customerContextPath({
    ...job,
    id: "work&other=2",
    customerId: "customer/path",
  });
  assert.equal(
    path,
    "/api/customers/customer%2Fpath/service-context?workOrderId=work%26other%3D2",
  );
});

test("customer cache entries cannot be reused for a different work order or location", () => {
  assert.notDeepEqual(
    customerContextQueryKey(job),
    customerContextQueryKey({ ...job, id: "other-order" }),
  );
  assert.notDeepEqual(
    customerContextQueryKey(job),
    customerContextQueryKey({ ...job, serviceLocationId: "other-location" }),
  );
  assert.notDeepEqual(
    customerContextQueryKey(job),
    customerContextQueryKey({ ...job, customerId: "other-customer" }),
  );
});

test("a mismatched customer or location response is rejected before displaying contact information", () => {
  assert.equal(validateCustomerContext(job, context), context);
  assert.throws(
    () =>
      validateCustomerContext(job, {
        ...context,
        customerId: "other-customer",
      }),
    /Refresh the job/,
  );
  assert.throws(
    () =>
      validateCustomerContext(job, {
        ...context,
        location: { ...context.location, id: "other-location" },
      }),
    /Refresh the job/,
  );
  assert.throws(
    () => validateCustomerContext({ ...job, customerId: null }, context),
    /Refresh the job/,
  );
});

test("the location address omits missing optional lines without losing locality", () => {
  assert.equal(
    serviceLocationAddress(context.location),
    "1 Example Avenue\nTest City, NY, 10001\nUS",
  );
  assert.equal(
    serviceLocationAddress({ ...context.location, addressLine2: "Suite 2" }),
    "1 Example Avenue\nSuite 2\nTest City, NY, 10001\nUS",
  );
});

test("each communication consent remains explicit rather than inferred from contact data", () => {
  assert.equal(
    communicationConsent(context.contacts[0]),
    "Email consent: not given · Phone consent: given",
  );
  assert.equal(
    communicationConsent({
      ...context.contacts[0],
      phoneConsent: false,
      emailConsent: true,
    }),
    "Email consent: given · Phone consent: not given",
  );
});
