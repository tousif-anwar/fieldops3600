import type { ReplayEvent } from './types';

export interface HistoricalState { status:string; stage:string; technicianId:string; sla:string; lastAction:string; eventCount:number; paused:boolean; completedStages:string[] }
// This reducer only reads recorded evidence. It never calls operational commands.
export function reconstruct(events:ReplayEvent[],through:number):HistoricalState {
  const state:HistoricalState={status:'No recorded state',stage:'Not started',technicianId:'Unassigned',sla:'Not started',lastAction:'—',eventCount:0,paused:false,completedStages:[]};
  for(const event of events.slice(0,Math.max(0,through+1))){
    const type=event.eventType.replace(/\.v\d+$/,'');const p=event.eventPayload??{};
    state.eventCount++;state.lastAction=event.eventType;
    if(type==='WorkOrderCreated')state.status='Created';
    if(type==='BookingCreated'||type==='TechnicianAssigned'){state.status='Assigned';state.technicianId=String(p.technicianId??state.technicianId);}
    if(type==='WorkflowStarted'){state.status='In progress';state.technicianId=String(p.technicianId??state.technicianId);}
    if(type==='StageStarted'){state.stage=String(p.stageName??p.name??`Stage ${Number(p.stageIndex??0)+1}`);state.sla='On time';state.paused=false;}
    if(type==='StageWarningRaised')state.sla='Warning';
    if(type==='StageCriticalWarningRaised')state.sla='Critical';
    if(type==='StageSLABreached')state.sla='Breached';
    if(type==='StagePaused'){state.paused=true;}
    if(type==='StageResumed'){state.paused=false;}
    if(type==='StageCompleted'){state.completedStages.push(String(p.stageName??p.name??state.stage));}
    if(type==='SupervisorOverrideApplied')state.status='Supervisor override recorded';
    if(type==='WorkflowCompleted'||type==='WorkOrderCompleted'){state.status='Completed';state.stage='All stages complete';state.paused=false;}
  }
  return state;
}

export interface ReplayFilters { type:string;service:string;actor:string;from:string;to:string;correlation:string;trace:string }
export function filterEvents(events:ReplayEvent[],filters:ReplayFilters) {
  return events.filter(e=>(!filters.type||e.eventType===filters.type)&&(!filters.service||e.sourceService===filters.service)&&(!filters.actor||e.actorId===filters.actor)&&(!filters.from||Date.parse(e.occurredAtUtc)>=Date.parse(filters.from))&&(!filters.to||Date.parse(e.occurredAtUtc)<=Date.parse(filters.to))&&(!filters.correlation||e.correlationId.toLowerCase().includes(filters.correlation.toLowerCase()))&&(!filters.trace||(e.traceId??'').toLowerCase().includes(filters.trace.toLowerCase())));
}
export function isLate(event:ReplayEvent){return !!event.receivedAtUtc&&Date.parse(event.receivedAtUtc)-Date.parse(event.occurredAtUtc)>60000;}
export function eventTone(event:ReplayEvent){return /Breach|Fail|DeadLetter/i.test(event.eventType)?'danger':/Warning|Retry/i.test(event.eventType)?'warning':/Completed/i.test(event.eventType)?'success':/Pause|Resume|Override|Assistance/i.test(event.eventType)?'intervention':'neutral';}
