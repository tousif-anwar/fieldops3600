export const dateTime=(value?:string)=>value ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)) : '—';
export const time=(value?:string)=>value ? new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '—';
export const humanize=(value:string)=>value.replace(/\.v\d+$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_.]/g,' ');
export const percent=(value:number)=>`${(value<=1 ? value*100 : value).toFixed(1)}%`;
export function countdown(deadline:string|undefined,now:number,pausedAt?:string) {
  if (!deadline) return 'Not started';
  const seconds=Math.ceil((Date.parse(deadline)-(pausedAt ? Date.parse(pausedAt) : now))/1000);
  const absolute=Math.abs(seconds);
  return `${seconds<0 ? '−' : ''}${Math.floor(absolute/60).toString().padStart(2,'0')}:${(absolute%60).toString().padStart(2,'0')}`;
}
