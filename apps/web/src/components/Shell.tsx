import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { Activity, Bell, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleHelp, ClipboardList, Compass, History, LayoutDashboard, LogOut, Menu, Search, Settings2, ShieldCheck, Wifi, WifiOff, Wrench, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { api, apiBase } from '../api';
import { manager, useAuth } from '../auth';
import type { Notification, Role } from '../types';

const navigation:{to:string;label:string;icon:typeof LayoutDashboard;roles:Role[]}[]=[
  {to:'/',label:'Overview',icon:LayoutDashboard,roles:['Dispatcher','Supervisor','OperationsManager','Technician','Analyst']},
  {to:'/work-orders',label:'Work orders',icon:ClipboardList,roles:['Dispatcher','Supervisor','OperationsManager','Technician']},
  {to:'/schedule',label:'Schedule',icon:CalendarDays,roles:['Dispatcher','Supervisor','OperationsManager','Technician']},
  {to:'/my-jobs',label:'My workflow',icon:Wrench,roles:['Technician','Supervisor','OperationsManager','Dispatcher']},
  {to:'/supervisor',label:'Supervisor',icon:Activity,roles:['Supervisor','OperationsManager']},
  {to:'/analytics',label:'Analytics',icon:ChartNoAxesCombined,roles:['Analyst','Supervisor','OperationsManager']},
  {to:'/replay',label:'Operational replay',icon:History,roles:['Supervisor','OperationsManager']},
  {to:'/administration',label:'Administration',icon:Settings2,roles:[]},
];

export function Shell() {
  const auth=useAuth(); const navigate=useNavigate(); const location=useLocation();
  const [open,setOpen]=useState(false); const [online,setOnline]=useState(navigator.onLine); const [query,setQuery]=useState('');
  const [live,setLive]=useState(false);
  const qc=useQueryClient();
  const notifications=useQuery({queryKey:['notifications'],queryFn:()=>api<Notification[]>('/api/notifications'),refetchInterval:30000});
  const unread=notifications.data?.filter(n=>!n.acknowledgedAtUtc).length??0;
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false); window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
  useEffect(()=>setOpen(false),[location.pathname]);
  useEffect(()=>{
    let active=true;
    const connection=new HubConnectionBuilder().withUrl(`${apiBase}/hubs/notifications`,{accessTokenFactory:async()=>(await manager.getUser())?.access_token??''}).withAutomaticReconnect([0,2000,5000,10000]).configureLogging(LogLevel.Error).build();
    const refresh=()=>{void qc.invalidateQueries({queryKey:['notifications']});void qc.invalidateQueries({queryKey:['workflows']});void qc.invalidateQueries({queryKey:['reports']});};
    connection.on('notification',refresh); connection.on('NotificationReceived',refresh);
    connection.onreconnected(()=>{if(active)setLive(true);refresh();}); connection.onreconnecting(()=>{if(active)setLive(false);}); connection.onclose(()=>{if(active)setLive(false);});
    void connection.start().then(()=>{if(active)setLive(true);}).catch(()=>{if(active)setLive(false);});
    return()=>{active=false;void connection.stop();};
  },[qc]);
  const name=String(auth.user?.profile.name??auth.user?.profile.preferred_username??'Team member');
  return <div className="app-layout">
    <a className="skip-link" href="#main">Skip to main content</a>
    {open&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open?'sidebar-open':''}`}>
      <NavLink to="/" className="brand"><span className="brand-symbol"><Compass size={25}/></span><span>FieldOps <b>360</b><small>SERVICE OPERATIONS</small></span></NavLink>
      <div className="workspace-switch"><span className="workspace-avatar">N</span><span>North region<small>HVAC operations</small></span><ChevronDown size={14}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.filter(n=>auth.can(...n.roles)).map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`nav-item ${isActive?'active':''}`}><Icon size={19}/><span>{label}</span>{to==='/replay'&&<span className="nav-new">NEW</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="support-card"><ShieldCheck size={21}/><strong>Every action, accounted for.</strong><p>Secure workflows. Clear decisions. A complete operational history.</p><NavLink to="/replay">Explore replay <span>↗</span></NavLink></div><a className="help-link" href="https://www.keycloak.org/documentation" target="_blank" rel="noreferrer"><CircleHelp size={17}/>Identity & access help <span>↗</span></a></div>
      <button className="user-card" onClick={()=>void auth.logout()} aria-label="Sign out"><span className="avatar">{name.slice(0,2).toUpperCase()}</span><span><strong>{name}</strong><small>{auth.roles[0]??'Authenticated user'}</small></span><LogOut size={17}/></button>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}>{open?<X size={21}/>:<Menu size={21}/>}</button><div className="breadcrumb">Workspace <span>/</span> <strong>{navigation.find(n=>n.to===location.pathname)?.label??'Work order details'}</strong></div><div className="topbar-right"><form className="global-search" onSubmit={e=>{e.preventDefault();if(query.trim())navigate(`/work-orders?q=${encodeURIComponent(query.trim())}`);}}><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search work orders…" aria-label="Search work orders"/><kbd>↵</kbd></form><span className={`connection ${!online?'offline':''}`}>{online?<Wifi size={14}/>:<WifiOff size={14}/>}<span>{online?(live?'Live updates':'Polling updates'):'Offline'}</span></span><NavLink to="/notifications" className="notification-button icon-button" aria-label={`Notifications, ${unread} unread`}><Bell size={20}/>{unread>0&&<span>{unread>9?'9+':unread}</span>}</NavLink></div></header>
      {!online&&<div className="offline-banner" role="status"><WifiOff size={16}/>You’re offline. Saved drafts remain on this device. Reconnect before submitting.</div>}
      <main id="main" className="page-content"><Outlet/></main>
      <footer className="workspace-footer"><span>FieldOps 360 <span className="footer-dot">·</span> Connected field service</span><span>Server-authoritative workflows <ShieldCheck size={13}/></span></footer>
    </div>
  </div>;
}
