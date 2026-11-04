import { useState } from 'react';
import { Button } from '@fluentui/react-components';
import { ArrowUpRight } from 'lucide-react';

export function TraceEvidence({traceId,correlationId}:{traceId?:string;correlationId:string}){
  const [status,setStatus]=useState<'unchecked'|'checking'|'available'|'missing'|'unreachable'>('unchecked');
  const jaeger=import.meta.env.VITE_JAEGER_URL??'http://localhost:16686';
  const check=async()=>{
    if(!traceId)return;setStatus('checking');
    try{
      const response=await fetch(`${jaeger}/api/traces/${encodeURIComponent(traceId)}`,{credentials:'omit',signal:AbortSignal.timeout(5000)});
      if(response.status===404){setStatus('missing');return;}
      if(!response.ok){setStatus('unreachable');return;}
      const body=await response.json();setStatus(Array.isArray(body.data)&&body.data.length?'available':'missing');
    }catch{setStatus('unreachable');}
  };
  return <div className="trace-card"><h4>Trace correlation</h4>{traceId?<><code>{traceId}</code>{status==='available'?<a href={`${jaeger}/trace/${encodeURIComponent(traceId)}`} target="_blank" rel="noreferrer">Open trace in Jaeger <ArrowUpRight size={14}/></a>:<Button size="small" appearance="subtle" disabled={status==='checking'} onClick={()=>void check()}>{status==='checking'?'Checking trace…':'Check trace availability'}</Button>}{status==='missing'?<small>No trace is available for this identifier. It may have expired from Jaeger or been omitted by trace sampling. The audit metadata remains available.</small>:status==='unreachable'?<small>The trace service could not be checked from this browser. <a href={jaeger} target="_blank" rel="noreferrer">Open Jaeger</a> and search the retained identifier.</small>:<small>Trace retention is separate from immutable event retention. Availability is checked before opening a specific trace.</small>}</>:<p>No trace was captured for this event.</p>}<small className="trace-correlation">Correlation <code>{correlationId}</code></small></div>;
}
