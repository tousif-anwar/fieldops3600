import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { WorkOrder } from './contracts';
import { useRuntime } from './runtime';

export function useWorkOrders() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  return useQuery({
    queryKey: ['work-orders'],
    refetchInterval: online ? 30_000 : false,
    queryFn: async () =>
      (await requestApi<WorkOrder[]>('/api/work-orders', await getAccessToken())).data,
  });
}
