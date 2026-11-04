import { useQuery } from '@tanstack/react-query';
import { requestApi } from './api';
import { useAuth } from './auth';
import type { WorkOrder, Workflow, WorkflowTemplate } from './contracts';
import { useRuntime } from './runtime';

export function useJob(id: string) {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const workOrders = useQuery({ queryKey: ['work-orders'], queryFn: async () =>
    (await requestApi<WorkOrder[]>('/api/work-orders', await getAccessToken())).data });
  const workflows = useQuery({ queryKey: ['workflows', id], enabled: !!id, refetchInterval: online ? 15_000 : false, queryFn: async () =>
    (await requestApi<Workflow[]>(`/api/workflows?workOrderId=${encodeURIComponent(id)}`, await getAccessToken())).data });
  const template = useQuery({ queryKey: ['template', 'default'], queryFn: async () =>
    (await requestApi<WorkflowTemplate>('/api/workflows/templates/default', await getAccessToken())).data });
  return { workOrders, workflows, template,
    job: workOrders.data?.find(job => job.id === id), workflow: workflows.data?.[0] };
}
