import type { AssignmentOffer } from './contracts';

export function offerIsActionable(offer: AssignmentOffer, online: boolean, now = Date.now()): boolean {
  return online && offer.status === 'Pending' && Date.parse(offer.expiresAtUtc) > now;
}

export function offerDisplayStatus(offer: AssignmentOffer, now = Date.now()): string {
  return offer.status === 'Pending' && Date.parse(offer.expiresAtUtc) <= now ? 'Expired' : offer.status;
}

export function pendingOffers(offers: AssignmentOffer[], now = Date.now()): AssignmentOffer[] {
  return offers.filter(offer => offerIsActionable(offer, true, now))
    .sort((left, right) => Date.parse(left.expiresAtUtc) - Date.parse(right.expiresAtUtc)
      || left.id.localeCompare(right.id));
}
