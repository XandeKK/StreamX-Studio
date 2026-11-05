import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bookmark, Check, Globe,
  ChevronDown, CircleHelp, Clapperboard, Clock3, Cpu, ExternalLink, FileVideo2,
  Film, FolderOpen, HardDrive, LayoutGrid, List, LoaderCircle, Menu, MonitorPlay,
  MoreHorizontal, Network, Play, Plus, Radio, RefreshCw, Search, Settings as SettingsIcon,
  SlidersHorizontal, Square, Terminal, Trash2, Video, X, Zap, Wifi, WifiOff,
} from 'lucide-react'
import { request, wsUrl } from './api'
import type { Recording, Settings, Stream } from './types'
import VideoPreview from './VideoPreview'

type Page = 'Dashboard' | 'Active Streams' | 'Recordings' | 'Browser' | 'Settings' | 'Logs'
type Log = { id: number; at: string; level: string; message: string }
const pages: { name: Page; icon: any }[] = [
  { name: 'Dashboard', icon: LayoutGrid }, { name: 'Active Streams', icon: Radio },
  { name: 'Recordings', icon: Film }, { name: 'Browser', icon: Globe },
  { name: 'Settings', icon: SettingsIcon }, { name: 'Logs', icon: Terminal },
]
const initialForm = { name: '', url: '', group_name: 'General', quality: 'best', container: 'mkv', auto_record: false, monitor: true }

function formatBytes(n = 0) { if (!n) return '0 B'; const u = ['B','KB','MB','GB','TB']; const i = Math.min(Math.floor(Math.log(n)/Math.log(1024)), 4); return `${(n/1024**i).toFixed(i ? 1 : 0)} ${u[i]}` }
function formatTime(n = 0) { const h = Math.floor(n/3600), m = Math.floor(n%3600/60), s = n%60; return `${h ? `${String(h).padStart(2,'0')}:` : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` }
function dateLabel(value?: string | null) { return value ? new Date(value).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—' }
function StatusPill({ state }: { state: string }) { const live = ['live','recording','playing'].includes(state); return <span className={`status-pill ${live ? 'live' : state === 'reconnecting' ? 'warn' : 'idle'}`}><i/>{state === 'unknown' ? 'checking' : state}</span> }

export default function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [streams, setStreams] = useState<Stream[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [system, setSystem] = useState<any>({})
  const [backendHealth, setBackendHealth] = useState<any>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [edit, setEdit] = useState<Stream | null>(null)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [layout, setLayout] = useState<'grid'|'list'>('grid')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('date')
  const [browserUrl, setBrowserUrl] = useState('https://')
  const [player, setPlayer] = useState<Recording | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s,r,c,sy,l,h] = await Promise.all([
        request<Stream[]>('/api/streams'), request<Recording[]>('/api/recordings'),
        request<Settings>('/api/settings'), request('/api/system'), request<Log[]>('/api/logs'), request('/health'),
      ])
      setStreams(s); setRecordings(r); setSettings(c); setSystem(sy); setLogs(l); setBackendHealth(h)
    } catch { setBackendHealth({ ok: false }) }
  }, [])
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 3000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => {
    let ws: WebSocket | null = null, retry: number
    const connect = async () => {
      const token = await window.streamx?.getApiToken()
      ws = new WebSocket(wsUrl(token))
      ws.onmessage = event => {
        const message = JSON.parse(event.data)
        if (message.event === 'snapshot') { if (message.data.system) setSystem(message.data.system); return }
        if (message.event === 'system') setSystem(message.data)
        if (message.event === 'stream-status') setStreams(current => current.map(s => s.id === message.data.stream_id ? { ...s, availability: message.data } : s))
        if (message.event === 'recording' || message.event === 'recording-finished') {
          setStreams(current => current.map(s => s.id === message.data.stream_id ? { ...s, session: message.data.state === 'completed' || message.data.state === 'error' ? null : message.data } : s))
          setRecordings(current => {
            const found = current.some(r => r.id === message.data.recording_id)
            const item = { id: message.data.recording_id, stream_name: message.data.name, stream_id: message.data.stream_id, path: message.data.path || '', format: 'mkv', started_at: new Date().toISOString(), status: message.data.state, file_size: message.data.file_size, exists: Boolean(message.data.path), progress: message.data }
            return found ? current.map(r => r.id === item.id ? { ...r, ...item } : r) : [item, ...current]
          })
        }
      }
      ws.onclose = () => { retry = window.setTimeout(connect, 1800) }
    }
    connect(); return () => { clearTimeout(retry); ws?.close() }
  }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const liveCount = streams.filter(s => s.availability?.state === 'live').length
  const activeCount = streams.filter(s => s.session && !['completed','error'].includes(s.session.state)).length
  const completed = recordings.filter(r => r.status === 'completed').length
  const totalStorage = recordings.reduce((sum,r) => sum + (r.file_size || 0), 0)
  const shownStreams = useMemo(() => streams.filter(s => `${s.name} ${s.url} ${s.group_name}`.toLowerCase().includes(query.toLowerCase())), [streams, query])

  async function action(id: number, actionName: string) {
    setBusy(id)
    try { const result = await request(`/api/streams/${id}/${actionName}`, { method: actionName === 'preview' ? 'POST' : 'POST' }); if (actionName === 'preview') setToast(result.url ? 'Preview pipeline started.' : 'Preview started.'); else setToast(actionName === 'record' ? 'Recording started.' : 'Stopping and finalizing recording…'); await refresh() }
    catch (e) { setToast((e as Error).message) } finally { setBusy(null) }
  }
  async function stopPreview(id: number) { await request(`/api/streams/${id}/preview`, { method:'DELETE' }); await refresh() }
  async function probe(id: number) { setBusy(id); try { const result = await request(`/api/streams/${id}/probe`, { method:'POST' }); setToast(`Stream is available · ${result.qualities.join(', ')}`); await refresh() } catch(e) { setToast((e as Error).message); await refresh() } finally { setBusy(null) } }
  async function removeStream(s: Stream) { if (!confirm(`Remove “${s.name}” from your configured streams?`)) return; try { await request(`/api/streams/${s.id}`, {method:'DELETE'}); await refresh() } catch(e) { setToast((e as Error).message) } }
  async function removeRecording(r: Recording) { if (!confirm(`Delete “${r.stream_name}” and its recording file?`)) return; try { await request(`/api/recordings/${r.id}`, {method:'DELETE'}); await refresh() } catch(e) { setToast((e as Error).message) } }

  const navTo = (name: Page) => { setPage(name); setQuery('') }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Radio size={19}/></div><div><strong>stream<span>x</span></strong><small>STUDIO</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{pages.slice(0,4).map(item => <button key={item.name} className={`nav-item ${page===item.name?'selected':''}`} onClick={() => navTo(item.name)}><item.icon size={17}/><span>{item.name}</span>{item.name==='Active Streams' && <b>{activeCount}</b>}</button>)}</nav>
      <div className="side-divider"/><div className="workspace-label">PREFERENCES</div>
      <nav>{pages.slice(4).map(item => <button key={item.name} className={`nav-item ${page===item.name?'selected':''}`} onClick={() => navTo(item.name)}><item.icon size={17}/><span>{item.name}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="side-health"><span className="health-dot"/><div><b>Recording engine</b><small>Local · Streamlink + FFmpeg</small></div></div><div className="side-version">STREAMX STUDIO <span>v1.0.0</span></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb"><span>STUDIO</span><b>/</b>{page}</div><div className="top-actions"><div className={`engine-indicator ${!backendHealth?.ok?'offline':''}`}><i/>{!backendHealth?.ok?'ENGINE OFFLINE':!backendHealth?.streamlink?.installed||!backendHealth?.ffmpeg?'ENGINE NEEDS SETUP':'ENGINE ONLINE'}</div><button className="icon-button" title="Refresh" onClick={refresh}><RefreshCw size={15}/></button><button className="avatar">SX</button></div></header>
      {page==='Dashboard' && <Dashboard streams={streams} activeCount={activeCount} liveCount={liveCount} completed={completed} totalStorage={totalStorage} system={system} onAdd={() => { setEdit(null); setShowAdd(true) }} onPage={navTo} onAction={action} onProbe={probe} onPreviewStop={stopPreview} onEdit={(s: Stream)=>{setEdit(s);setShowAdd(true)}} onRemove={removeStream} busy={busy} layout={layout} setLayout={setLayout} query={query} setQuery={setQuery}/>}
      {page==='Active Streams' && <section className="page-content"><PageHeading eyebrow="MONITORING" title="Active streams" subtitle="Monitor availability and recording sessions independently." action={<button className="button primary" onClick={()=>{setEdit(null);setShowAdd(true)}}><Plus size={16}/>Add stream</button>}/><div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search streams…"/></div><div className="view-toggle"><button className={layout==='grid'?'on':''} onClick={()=>setLayout('grid')}><LayoutGrid size={15}/></button><button className={layout==='list'?'on':''} onClick={()=>setLayout('list')}><List size={15}/></button></div></div><StreamGrid streams={shownStreams} onAction={action} onProbe={probe} onPreviewStop={stopPreview} onEdit={s=>{setEdit(s);setShowAdd(true)}} onRemove={removeStream} busy={busy} layout={layout}/></section>}
      {page==='Recordings' && <Recordings recordings={recordings} query={query} setQuery={setQuery} sort={sort} setSort={setSort} onDelete={removeRecording} onPlay={setPlayer} onOpen={r=>window.streamx?.openPath(r.path)} />}
      {page==='Browser' && <BrowserPage url={browserUrl} setUrl={setBrowserUrl} toast={setToast}/>}
      {page==='Settings' && <SettingsPage settings={settings} onSaved={refresh} toast={setToast}/>}
      {page==='Logs' && <LogsPage logs={logs} onRefresh={refresh}/>}
    </main>
    {showAdd && <StreamModal initial={edit} onClose={()=>setShowAdd(false)} onSaved={async()=>{setShowAdd(false);await refresh()}} toast={setToast}/>}
    {player && <RecordingPlayer recording={player} onClose={()=>setPlayer(null)}/>}
    {toast && <div className="toast"><span>{toast}</span><button onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>
}

function PageHeading({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle:string;action?:ReactNode}) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div> }

function Dashboard(props:any) {
  const { streams, activeCount, liveCount, completed, totalStorage, system, onAdd, onPage, onAction, onProbe, onPreviewStop, onEdit, onRemove, busy, layout, setLayout, query, setQuery } = props
  const stats = [
    {label:'Configured sources',value:streams.length,icon:Radio,note:'Across all groups',tone:'purple'},
    {label:'Live now',value:liveCount,icon:Activity,note:liveCount ? 'Sources available' : 'No active sources',tone:'green'},
    {label:'Recording',value:activeCount,icon:Video,note:'Independent sessions',tone:'red'},
    {label:'Library',value:completed,icon:Clapperboard,note:formatBytes(totalStorage)+' stored',tone:'blue'},
  ]
  return <section className="page-content dashboard-page">
    {system.disk?.low && <div className="disk-warning"><AlertTriangle size={15}/><span>Low disk space · {formatBytes(system.disk.free)} free in your recording volume.</span><button onClick={()=>onPage('Settings')}>Review settings <ArrowUpRight size={13}/></button></div>}
    <PageHeading eyebrow="CONTROL ROOM / OVERVIEW" title="Good to see you." subtitle="Your live sources, recording sessions, and system health at a glance." action={<button className="button primary" onClick={onAdd}><Plus size={16}/>Add a stream</button>}/>
    <div className="stat-grid">{stats.map(s=><div className="stat-card" key={s.label}><div className={`stat-icon ${s.tone}`}><s.icon size={17}/></div><div className="stat-label">{s.label}<span>{s.note}</span></div><strong>{s.value}</strong></div>)}</div>
    <div className="section-head"><div><h2>Stream monitor <span className="count-badge">{streams.length}</span></h2><p>Live sources and recording activity</p></div><div className="section-tools"><div className="search-box compact"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a stream"/></div><div className="view-toggle"><button className={layout==='grid'?'on':''} onClick={()=>setLayout('grid')}><LayoutGrid size={15}/></button><button className={layout==='list'?'on':''} onClick={()=>setLayout('list')}><List size={15}/></button></div><button className="text-button" onClick={()=>onPage('Active Streams')}>View all <ArrowUpRight size={14}/></button></div></div>
    <StreamGrid streams={streams.filter((s:Stream)=>`${s.name} ${s.url} ${s.group_name}`.toLowerCase().includes(query.toLowerCase()))} onAction={onAction} onProbe={onProbe} onPreviewStop={onPreviewStop} onEdit={onEdit} onRemove={onRemove} busy={busy} layout={layout}/>
    <div className="system-row"><div className="system-title"><div className="system-icon"><Cpu size={16}/></div><div><b>System resources</b><span>Live local telemetry</span></div></div><Metric icon={Cpu} label="CPU" value={system.cpu == null ? '—' : `${Math.round(system.cpu)}%`}/><Metric icon={Activity} label="MEMORY" value={system.ram == null ? '—' : `${Math.round(system.ram)}%`}/><Metric icon={Network} label="NETWORK" value={system.network_bps == null ? '—' : `${formatBytes(system.network_bps)}/s`}/><Metric icon={HardDrive} label="DISK FREE" value={system.disk?.free ? formatBytes(system.disk.free) : '—'}/></div>
  </section>
}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:string}) { return <div className="metric"><Icon size={14}/><span>{label}</span><b>{value}</b></div> }

function StreamGrid({streams,onAction,onProbe,onPreviewStop,onEdit,onRemove,busy,layout}:{streams:Stream[];onAction:(id:number,a:string)=>void;onProbe:(id:number)=>void;onPreviewStop:(id:number)=>void;onEdit:(s:Stream)=>void;onRemove:(s:Stream)=>void;busy:number|null;layout:'grid'|'list'}) {
  if (!streams.length) return <div className="empty-state"><div className="empty-icon"><Radio size={23}/></div><h3>No streams configured</h3><p>Add a website URL or direct stream URL to check availability and start a recording.</p></div>
  return <div className={`stream-grid ${layout}`}>{streams.map(s=><StreamCard key={s.id} stream={s} onAction={onAction} onProbe={onProbe} onPreviewStop={onPreviewStop} onEdit={onEdit} onRemove={onRemove} busy={busy===s.id}/>)}</div>
}
function StreamCard({stream:s,onAction,onProbe,onPreviewStop,onEdit,onRemove,busy}:{stream:Stream;onAction:any;onProbe:any;onPreviewStop:any;onEdit:any;onRemove:any;busy:boolean}) {
  const domain = (()=>{try{return new URL(s.url).hostname.replace(/^www\./,'')}catch{return s.url}})()
  return <article className="stream-card">
    <div className="preview-box">
      {s.preview && ['starting','playing'].includes(s.preview.state) ? <VideoPreview src={s.preview.url}/> : <div className="preview-placeholder"><div className="wave-grid"/><div className="preview-center"><div className="preview-play"><Play size={16} fill="currentColor"/></div><span>{s.availability?.state==='live'?'SOURCE AVAILABLE':'NO PREVIEW'}</span></div><div className="preview-corner">{s.availability?.state==='live'&&<><i/> LIVE SIGNAL</>}</div></div>}
      <div className="preview-top"><StatusPill state={s.availability?.state||'unknown'}/>{s.preview && <span className="preview-tag">PREVIEW {s.preview.state}</span>}</div>
      {s.preview && <button className="preview-stop" onClick={()=>onPreviewStop(s.id)} title="Stop preview"><X size={14}/></button>}
      {s.session && <div className="rec-overlay"><span><i/>REC</span><b>{formatTime(s.session.duration)}</b></div>}
    </div>
    <div className="stream-body">
      <div className="stream-title"><div className="source-avatar"><Radio size={15}/></div><div className="stream-name"><strong>{s.name}</strong><span>{domain}</span></div><button className="more-button" title="Stream options" onClick={()=>onEdit(s)}><MoreHorizontal size={17}/></button></div>
      <div className="stream-meta"><span><Bookmark size={13}/>{s.group_name || 'General'}</span><span className="quality-chip">{s.quality==='best'?'BEST':s.quality.toUpperCase()}</span><span>{s.container.toUpperCase()}</span></div>
      <div className="stream-detail-row"><span>RECORDING</span><StatusPill state={s.session?.state||'idle'}/></div>
      {s.session ? <div className="session-info"><span><Clock3 size={13}/>{formatTime(s.session.duration)}</span><span><HardDrive size={13}/>{formatBytes(s.session.file_size)}</span>{s.session.resolution&&<span>{s.session.resolution}</span>}{s.session.bitrate&&<span>{formatBytes(s.session.bitrate/8)}/s</span>}{s.session.retry_count>0&&<span className="retry-count"><RefreshCw size={12}/>{s.session.retry_count}</span>}</div> : <div className="stream-warning">{s.availability?.error ? <><AlertTriangle size={13}/><span title={s.availability.error}>{s.availability.error}</span></> : <span>{s.auto_record?'Auto-record enabled':'Monitoring '+(s.monitor?'on':'off')}</span>}</div>}
      <div className="card-actions"><button className={`button ${s.session?'stop':'primary'} small`} disabled={busy||Boolean(s.session&&['finalizing'].includes(s.session.state))} onClick={()=>onAction(s.id,s.session?'stop':'record')}>{busy?<LoaderCircle className="spin" size={14}/>:s.session?<Square size={13} fill="currentColor"/>:<CircleRecord/>}{s.session?'Stop recording':'Record'}</button><button className="button subtle small" disabled={busy} onClick={()=>s.preview?onPreviewStop(s.id):onAction(s.id,'preview')}><MonitorPlay size={14}/>{s.preview?'Close preview':'Preview'}</button><button className="icon-button mini" title="Check availability" disabled={busy} onClick={()=>onProbe(s.id)}><RefreshCw size={14}/></button><button className="icon-button mini" title="Remove stream" onClick={()=>onRemove(s)}><Trash2 size={14}/></button></div>
    </div>
  </article>
}
function CircleRecord() { return <span className="record-dot-icon"/> }

function StreamModal({initial,onClose,onSaved,toast}:{initial:Stream|null;onClose:()=>void;onSaved:()=>void;toast:(x:string)=>void}) {
  const [form,setForm] = useState<any>(initial ? {...initial} : {...initialForm})
  const [checking,setChecking] = useState(false)
  const [compat,setCompat] = useState<any>(null)
  const [saving,setSaving] = useState(false)
  const change=(key:string,value:any)=>setForm((old:any)=>({...old,[key]:value}))
  async function check() { setChecking(true);setCompat(null);try { const r=await request('/api/probe',{method:'POST',body:JSON.stringify({url:form.url})});setCompat(r);toast(`Compatible source · ${r.qualities.join(', ')}`) } catch(e) { setCompat({error:(e as Error).message});toast((e as Error).message) } finally { setChecking(false) } }
  async function save(e:FormEvent) { e.preventDefault();setSaving(true);try { await request(initial?`/api/streams/${initial.id}`:'/api/streams',{method:initial?'PUT':'POST',body:JSON.stringify(form)});onSaved() } catch(e) {toast((e as Error).message)}finally{setSaving(false)} }
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={save}>
    <div className="modal-head"><div><div className="eyebrow">SOURCE CONFIGURATION</div><h2>{initial?'Edit stream':'Add a stream'}</h2><p>Save a source, check Streamlink support, then select recording preferences.</p></div><button className="icon-button" type="button" onClick={onClose}><X size={17}/></button></div>
    <label className="field-label">Stream name<input required maxLength={120} value={form.name} onChange={e=>change('name',e.target.value)} placeholder="e.g. Studio A · Main feed"/></label>
    <label className="field-label">Website or direct stream URL<input required type="url" value={form.url} onChange={e=>{change('url',e.target.value);setCompat(null)}} placeholder="https://…"/></label>
    <button type="button" className="button subtle check-button" onClick={check} disabled={!form.url||checking}>{checking?<LoaderCircle className="spin" size={15}/>:<Zap size={15}/>}Check Streamlink compatibility</button>
    {compat && <div className={`compat-result ${compat.error?'failed':'success'}`}>{compat.error?<><AlertTriangle size={15}/>{compat.error}</>:<><Check size={15}/><span>Source detected <small>Available: {compat.qualities.join(', ')}</small></span></>}</div>}
    <div className="form-grid"><label className="field-label">Group<input value={form.group_name} onChange={e=>change('group_name',e.target.value)} placeholder="General"/></label><label className="field-label">Preferred quality<select value={form.quality} onChange={e=>change('quality',e.target.value)}>{['best','1080p','720p','480p','worst'].map(q=><option key={q} value={q}>{q==='best'?'Best available':q}</option>)}{compat?.qualities?.filter((q:string)=>!['best','worst'].includes(q)).map((q:string)=><option key={q} value={q}>{q}</option>)}</select></label><label className="field-label">Recording format<select value={form.container} onChange={e=>change('container',e.target.value)}><option value="mkv">Matroska · MKV</option><option value="mp4">MPEG-4 · MP4</option><option value="ts">MPEG-TS · TS</option></select></label></div>
    <div className="toggle-row"><div><b>Monitor this source</b><span>Check availability on the configured interval</span></div><input type="checkbox" checked={form.monitor} onChange={e=>change('monitor',e.target.checked)}/></div>
    <div className="toggle-row"><div><b>Automatically record when live</b><span>Start a recording when this source becomes available</span></div><input type="checkbox" checked={form.auto_record} onChange={e=>change('auto_record',e.target.checked)}/></div>
    <div className="modal-actions"><button className="button subtle" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>} {initial?'Save changes':'Save source'}</button></div>
  </form></div>
}

function Recordings({recordings,query,setQuery,sort,setSort,onDelete,onPlay,onOpen}:{recordings:Recording[];query:string;setQuery:(x:string)=>void;sort:string;setSort:(x:string)=>void;onDelete:(r:Recording)=>void;onPlay:(r:Recording)=>void;onOpen:(r:Recording)=>void}) {
  const items=[...recordings].filter(r=>`${r.stream_name} ${r.path}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='name'?a.stream_name.localeCompare(b.stream_name):sort==='size'?b.file_size-a.file_size:sort==='date'?b.started_at.localeCompare(a.started_at):0)
  return <section className="page-content"><PageHeading eyebrow="MEDIA LIBRARY" title="Recordings" subtitle="Browse completed captures and check live recording progress." action={<div className="library-count"><Film size={15}/>{recordings.length} FILES</div>}/><div className="toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search recordings…"/></div><label className="sort-select"><SlidersHorizontal size={14}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="date">Newest first</option><option value="name">Name</option><option value="size">File size</option></select><ChevronDown size={13}/></label></div>
    {!items.length?<div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>No recordings yet</h3><p>Started recordings will appear here. Stop a session to finalize its media file.</p></div>:<div className="recording-list">{items.map(r=><div className="recording-row" key={r.id}><div className={`file-cover ${r.status==='recording'?'recording':''}`}><FileVideo2 size={23}/>{r.status==='recording'&&<i/>}</div><div className="recording-info"><strong>{r.stream_name}</strong><span>{dateLabel(r.started_at)} <i/> {r.format.toUpperCase()} {r.error&&<em title={r.error}>· {r.error}</em>}</span></div><StatusPill state={r.status}/><div className="recording-duration">{r.progress?formatTime(r.progress.duration):r.ended_at?formatTime(Math.floor((new Date(r.ended_at).getTime()-new Date(r.started_at).getTime())/1000)):'—'}</div><div className="recording-size">{formatBytes(r.file_size)}</div><div className="recording-actions">{r.exists&&r.status==='completed'&&<button className="icon-button mini" title="Play recording" onClick={()=>onPlay(r)}><Play size={14}/></button>}{r.path&&<button className="icon-button mini" title="Open file location" onClick={()=>onOpen(r)}><FolderOpen size={14}/></button>}{!r.progress&&<button className="icon-button mini danger-hover" title="Delete recording" onClick={()=>onDelete(r)}><Trash2 size={14}/></button>}</div></div>)}</div>}</section>
}

function SettingsPage({settings,onSaved,toast}:{settings:Settings|null;onSaved:()=>void;toast:(x:string)=>void}) {
  const [form,setForm]=useState<any>(settings||{}),[saving,setSaving]=useState(false),[diagnostics,setDiagnostics]=useState<any>(null)
  useEffect(()=>{if(settings)setForm(settings)},[settings])
  async function save(e:FormEvent){e.preventDefault();setSaving(true);try{const data=await request('/api/settings',{method:'PUT',body:JSON.stringify({...form,max_recordings:Number(form.max_recordings),retry_seconds:Number(form.retry_seconds),monitor_seconds:Number(form.monitor_seconds),low_disk_gb:Number(form.low_disk_gb),segment_minutes:Number(form.segment_minutes||0)})});setForm(data);onSaved();toast('Settings saved.')}catch(e){toast((e as Error).message)}finally{setSaving(false)}}
  async function diag(){try{setDiagnostics(await request('/api/diagnostics'))}catch(e){toast((e as Error).message)}}
  return <section className="page-content"><PageHeading eyebrow="CONFIGURATION" title="Settings" subtitle="Set recording behavior, storage location, and system limits."/><form onSubmit={save} className="settings-layout"><div className="settings-panel"><div className="settings-panel-title"><div><h2>Recording</h2><p>Defaults used by new recording sessions</p></div><SlidersHorizontal size={17}/></div><label className="field-label">Default recording folder<div className="input-with-action"><input required value={form.recording_dir||''} onChange={e=>setForm({...form,recording_dir:e.target.value})}/><button type="button" className="button subtle small" onClick={()=>window.streamx?.openPath(form.recording_dir).then(x=>x&&toast(x))}><FolderOpen size={14}/>Open</button></div></label><label className="field-label">Maximum simultaneous recordings <span className="field-hint">{form.max_recordings||4} sessions</span><input type="number" min="1" step="1" value={form.max_recordings||4} onChange={e=>setForm({...form,max_recordings:e.target.value})}/><span className="range-labels"><span>Limited by your machine and this value</span></span></label><label className="field-label">Reconnect interval <select value={form.retry_seconds||10} onChange={e=>setForm({...form,retry_seconds:e.target.value})}>{[5,10,15,30,60,120].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></label><label className="field-label">Stream monitoring interval <select value={form.monitor_seconds||30} onChange={e=>setForm({...form,monitor_seconds:e.target.value})}>{[15,30,60,120,300].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></label><label className="field-label">Low disk warning threshold <select value={form.low_disk_gb||5} onChange={e=>setForm({...form,low_disk_gb:e.target.value})}>{[1,2,5,10,20,50].map(n=><option key={n} value={n}>{n} GB available</option>)}</select></label><label className="field-label">Recording segment length <select value={form.segment_minutes||0} onChange={e=>setForm({...form,segment_minutes:e.target.value})}><option value="0">One file until stopped</option>{[30,60,120,240,480].map(n=><option key={n} value={n}>{n<60?n+" minutes":n/60+" hours"}</option>)}</select></label><div className="form-actions"><button className="button primary" disabled={saving}>{saving?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}Save settings</button></div></div><div className="settings-panel diagnostic-panel"><div className="settings-panel-title"><div><h2>System diagnostics</h2><p>Dependency availability on this machine</p></div><Activity size={17}/></div><div className="diagnostic-item"><span>Streamlink</span><b className={diagnostics?.streamlink?.installed?'good':'unknown'}>{diagnostics?.streamlink?.installed?`Installed · ${diagnostics.streamlink.version}`:'Not checked'}</b></div><div className="diagnostic-item"><span>FFmpeg</span><b>{diagnostics?.ffmpeg?'Available':'Not checked'}</b></div><div className="diagnostic-item"><span>FFprobe</span><b>{diagnostics?.ffprobe?'Available':'Not checked'}</b></div><div className="diagnostic-item"><span>SQLite database</span><b className="diagnostic-path">{diagnostics?.database||'Not checked'}</b></div><div className="diagnostic-item"><span>System metrics</span><b>{diagnostics?.psutil?'Available':'Basic mode'}</b></div><button type="button" className="button subtle full-button" onClick={diag}><RefreshCw size={14}/>Run dependency check</button></div></form></section>
}

function BrowserPage({url,setUrl,toast}:{url:string;setUrl:(s:string)=>void;toast:(s:string)=>void}) { return <section className="page-content"><PageHeading eyebrow="WEB SOURCE BROWSER" title="Browser" subtitle="Open a site in a separate Chromium window and navigate with its normal login flow."/><div className="browser-panel"><div className="browser-icon"><Globe size={23}/></div><h2>Embedded source browser</h2><p>Use regular site navigation to view public or authorized streams. Browser playback does not bypass DRM, paywalls, or access controls, and browser video is not captured by the recorder.</p><form className="browser-form" onSubmit={e=>{e.preventDefault();window.streamx?.openBrowser(url).catch(err=>toast(err.message))}}><input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://site.example/live"/><button className="button primary"><ExternalLink size={15}/>Open browser window</button></form><div className="browser-note"><Check size={14}/>Website navigation happens in its own isolated Chromium window. It does not share browser cookies with Streamlink.</div></div></section> }

function LogsPage({logs,onRefresh}:{logs:Log[];onRefresh:()=>void}) { return <section className="page-content"><PageHeading eyebrow="SYSTEM ACTIVITY" title="Logs" subtitle="Stream checks, reconnect attempts, recording events, and backend status." action={<button className="button subtle" onClick={onRefresh}><RefreshCw size={14}/>Refresh</button>}/><div className="logs-table"><div className="log-header"><span>TIME</span><span>LEVEL</span><span>MESSAGE</span></div>{logs.map(log=><div className="log-row" key={log.id}><time>{new Date(log.at+'Z').toLocaleString()}</time><span className={`log-level ${log.level}`}>{log.level}</span><span>{log.message}</span></div>)}{!logs.length&&<div className="log-empty">No events recorded yet.</div>}</div></section> }

function RecordingPlayer({recording,onClose}:{recording:Recording;onClose:()=>void}) { const [src,setSrc]=useState(''); useEffect(()=>{window.streamx?.getApiToken().then(token=>setSrc(`http://127.0.0.1:8765/api/recordings/${recording.id}/file?token=${encodeURIComponent(token)}`))},[recording.id]); return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="player-modal"><div className="player-heading"><div><b>{recording.stream_name}</b><span>{dateLabel(recording.started_at)} · {recording.format.toUpperCase()}</span></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><video src={src||undefined} controls autoPlay/></div></div> }
