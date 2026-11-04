import { describe,expect,it } from 'vitest';
import { eventTone,filterEvents,isLate,reconstruct,type ReplayFilters } from '../replay';
import type { ReplayEvent } from '../types';

const event=(type:string,payload:Record<string,unknown>={},extra:Partial<ReplayEvent>={}):ReplayEvent=>({eventId:crypto.randomUUID(),eventType:`${type}.v1`,eventVersion:1,workOrderId:'work-1',actorId:'tech-01',actorRole:'Technician',sourceService:'workflows',correlationId:'correlation-1',traceId:'trace-1',occurredAtUtc:'2026-11-04T13:00:00Z',recordedAtUtc:'2026-11-04T13:00:00Z',sequenceNumber:1,eventPayload:payload,schemaVersion:1,retryCount:0,processingStatus:'Processed',attempts:[],...extra});
describe('historical reconstruction',()=>{
  it('reconstructs only evidence through the selected event, including pauses and completion',()=>{
    const events=[event('WorkOrderCreated'),event('BookingCreated',{technicianId:'tech-02'}),event('WorkflowStarted'),event('StageStarted',{stageName:'Diagnosis'}),event('StageWarningRaised'),event('StagePaused'),event('StageResumed'),event('StageCompleted',{stageName:'Diagnosis'}),event('WorkflowCompleted')];
    expect(reconstruct(events,0)).toMatchObject({status:'Created',technicianId:'Unassigned',stage:'Not started',eventCount:1});
    expect(reconstruct(events,4)).toMatchObject({status:'In progress',technicianId:'tech-02',stage:'Diagnosis',sla:'Warning',eventCount:5});
    expect(reconstruct(events,5).paused).toBe(true);
    expect(reconstruct(events,6).paused).toBe(false);
    expect(reconstruct(events,8)).toMatchObject({status:'Completed',completedStages:['Diagnosis'],eventCount:9});
  });
  it('does not rewrite or reorder immutable input events',()=>{
    const events=[event('StageSLABreached',{}, {occurredAtUtc:'2026-11-04T13:30:00Z'}),event('StageStarted',{stageName:'Diagnosis'}, {occurredAtUtc:'2026-11-04T13:00:00Z'})];
    const before=JSON.stringify(events);reconstruct(events,1);expect(JSON.stringify(events)).toBe(before);
  });
  it('starts with no recorded state before the first event',()=>expect(reconstruct([event('WorkOrderCreated')],-1)).toMatchObject({eventCount:0,status:'No recorded state'}));
});
describe('replay investigation filters',()=>{
  const defaults:ReplayFilters={type:'',service:'',actor:'',from:'',to:'',correlation:'',trace:''};
  const events=[event('StageStarted'),event('StageSLABreached',{}, {sourceService:'notifications',actorId:'system',traceId:'trace-2',occurredAtUtc:'2026-11-04T13:30:00Z'})];
  it('combines service actor trace and occurrence time filters',()=>expect(filterEvents(events,{...defaults,service:'notifications',actor:'system',trace:'TRACE-2',from:'2026-11-04T13:20:00Z',to:'2026-11-04T13:40:00Z'})).toEqual([events[1]]));
  it('filters on original occurrence time rather than delayed processing',()=>{
    const late=event('StageStarted',{}, {receivedAtUtc:'2026-11-04T14:00:00Z'});
    expect(filterEvents([late],{...defaults,to:'2026-11-04T13:05:00Z'})).toEqual([late]);expect(isLate(late)).toBe(true);
  });
  it('keeps business actions separate from their delivery attempts',()=>{
    const retried=event('StageSLABreached',{}, {retryCount:2,attempts:[{attempt:1,receivedAtUtc:'2026-11-04T13:00:00Z',status:'Failed'},{attempt:2,receivedAtUtc:'2026-11-04T13:00:05Z',status:'Processed'}]});
    expect(reconstruct([retried],0).eventCount).toBe(1);expect(eventTone(retried)).toBe('danger');
  });
});
