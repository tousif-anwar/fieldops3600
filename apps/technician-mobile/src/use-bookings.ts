import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { Booking } from './contracts';
import { useRuntime } from './runtime';

export function useBookings() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  return useQuery({
    queryKey: ['bookings'],
    refetchInterval: online ? 30_000 : false,
    queryFn: async () =>
      (await requestApi<Booking[]>('/api/bookings', await getAccessToken())).data,
  });
}
