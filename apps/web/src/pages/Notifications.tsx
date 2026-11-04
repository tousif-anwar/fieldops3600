import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@fluentui/react-components';
import { Bell, Check } from 'lucide-react';
import { api, post } from '../api';
import { dateTime, humanize } from '../format';
import { Empty, ErrorState, InlineMessage, Loading, PageHeader, Panel, Status } from '../components/common';
import type { Notification } from '../types';

export function Notifications(){
  const qc=useQueryClient();const result=useQuery({queryKey:['notifications'],queryFn:()=>api<Notification[]>('/api/notifications'),refetchInterval:30000});
  const acknowledge=useMutation({mutationFn:(id:string)=>post(`/api/notifications/${id}/acknowledge`,{}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['notifications']});}});
  return <><PageHeader eyebrow="TEAM COMMUNICATION" title="The right signal, at the right time." description="SLA warnings, escalations, and service updates for your authorized work."/><Panel title="Notifications" description="Acknowledgments are recorded in the operational history.">{result.isPending?<Loading/>:result.isError?<ErrorState error={result.error} retry={()=>void result.refetch()}/>:!result.data?.length?<Empty title="You’re all caught up" description="New stage warnings and supervisor alerts will appear here."/>:<div className="notification-list">{result.data.map(n=><article key={n.id} className={n.acknowledgedAtUtc?'acknowledged':''}><span className="notification-icon"><Bell size={20}/></span><div><strong>{n.title??humanize(n.eventType??'Service update')}</strong><p>{n.message??`Work order ${n.workOrderId}`}</p><small>{dateTime(n.createdAtUtc)}</small></div>{n.acknowledgedAtUtc?<Status value="Acknowledged"/>:<Button icon={<Check size={16}/>} disabled={acknowledge.isPending} onClick={()=>acknowledge.mutate(n.id)}>Acknowledge</Button>}</article>)}</div>}{acknowledge.isError&&<InlineMessage>{acknowledge.error.message}</InlineMessage>}</Panel></>;
}
