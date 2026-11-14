import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { Workflow } from './contracts';
import { useRuntime } from './runtime';

export function useActivity() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  return useQuery({
    queryKey: ['workflows', 'activity'],
    refetchInterval: online ? 30_000 : false,
    queryFn: async () =>
      (await requestApi<Workflow[]>('/api/workflows', await getAccessToken())).data,
  });
}
