import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { AssignmentOffer } from './contracts';
import { useRuntime } from './runtime';

export function useOffers() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  return useQuery({
    queryKey: ['assignment-offers'],
    meta: { persist: false },
    refetchInterval: online ? 15_000 : false,
    queryFn: async () => (await requestApi<AssignmentOffer[]>('/api/assignment-offers', await getAccessToken())).data,
  });
}
