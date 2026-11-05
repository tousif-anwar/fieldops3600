import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { Booking } from './contracts';

export function useBookings() {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ['bookings'],
    queryFn: async () => (await requestApi<Booking[]>('/api/bookings', await getAccessToken())).data,
  });
}
