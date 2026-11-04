import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, onlineManager, useQueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { requestApi } from './api';
import { useAuth } from './auth';
import { OfflineQueue, type Submission } from './offline/queue';

interface Runtime {
  online: boolean;
  queue: OfflineQueue;
  submissions: Submission[];
  queueError: string | null;
  synchronize(): Promise<void>;
}

const RuntimeContext = createContext<Runtime | null>(null);

function OfflineProvider({ children }: React.PropsWithChildren) {
  const { session, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const owner = session!.subject;
  const queue = useMemo(() => {
    const key = `fieldops.queue.v1.${encodeURIComponent(owner)}`;
    return new OfflineQueue(owner, {
      read: async () => JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as Submission[],
      write: async items => AsyncStorage.setItem(key, JSON.stringify(items)),
    }, {
      send: async item => {
        const token = await getAccessToken(owner);
        const receipt = await requestApi(`/api/workflows/${encodeURIComponent(item.workflowId)}/submit`, token, {
          method: 'POST', body: {
            expectedVersion: item.expectedVersion, idempotencyKey: item.id,
            answers: item.answers, clientOccurredAtUtc: item.clientOccurredAtUtc, offline: item.createdOffline,
          },
        });
        await queryClient.invalidateQueries();
        return { serverReceivedAtUtc: receipt.serverReceivedAtUtc };
      },
    });
  }, [owner, getAccessToken, queryClient]);

  useEffect(() => {
    const refresh = () => {
      void queue.list().then(items => { setSubmissions(items); setQueueError(null); })
        .catch(cause => setQueueError(cause instanceof Error ? cause.message : 'Local queue could not be read.'));
    };
    refresh();
    return queue.subscribe(refresh);
  }, [queue]);

  useEffect(() => NetInfo.addEventListener(state => {
    const connected = state.isConnected === true && state.isInternetReachable !== false;
    setOnline(connected);
    onlineManager.setOnline(connected);
  }), []);

  useEffect(() => {
    const synchronize = () => { void queue.flush(online).catch(cause => setQueueError(String(cause))); };
    synchronize();
    const timer = setInterval(synchronize, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') synchronize(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [queue, online]);

  return <RuntimeContext.Provider value={{ online, queue, submissions, queueError,
    synchronize: () => queue.flush(online) }}>{children}</RuntimeContext.Provider>;
}

export function SessionRuntime({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const owner = session!.subject;
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: {
    staleTime: 30_000, gcTime: 7 * 24 * 3600_000, retry: 1,
  } } }), [owner]);
  const persister = useMemo(() => createAsyncStoragePersister({
    storage: AsyncStorage, key: `fieldops.query.v1.${encodeURIComponent(owner)}`, throttleTime: 1000,
  }), [owner]);
  return <PersistQueryClientProvider client={client} persistOptions={{ persister,
    buster: 'fieldops-v1', maxAge: 7 * 24 * 3600_000,
    dehydrateOptions: { shouldDehydrateQuery: query => query.state.status === 'success'
      && query.meta?.persist !== false },
  }}><OfflineProvider>{children}</OfflineProvider></PersistQueryClientProvider>;
}

export function useRuntime(): Runtime {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('SessionRuntime is required.');
  return value;
}
