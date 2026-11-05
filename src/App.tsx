import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, AlertTriangle, Archive, ArrowDownToLine, ArrowUpRight, Check, ChevronDown,
  CircleHelp, Clock3, Cpu, ExternalLink, FileVideo2, Film, FolderOpen, Gauge, Globe,
  HardDrive, LayoutGrid, List, LoaderCircle, Maximize, MonitorPlay, MoreHorizontal,
  Network, Pause, Play, Plus, Radio, RefreshCw, Search, Settings as SettingsIcon,
  SlidersHorizontal, Square, Terminal, Trash2, Video, Volume2, Wifi, WifiOff, X,
} from 'lucide-react'
import { request, wsUrl } from './api'
import type { PlaybackSession, Recording, Settings, Stream } from './types'
import VideoPreview from './VideoPreview'
import TimeShiftPlayer from './TimeShiftPlayer'

type Page = 'Dashboard' | 'Live Streams' | 'Recordings' | 'Playback Library' | 'Stream Manager' | 'Settings' | 'Browser' | 'Logs'
type Log = { id: number; at: string; level: string; message: string }
type SystemInfo = { cpu?: number | null; ram?: number | null; network_bps?: number | null; disk?: { free: number; total: number; low: boolean } }
const navigation: { label: Page; icon: typeof LayoutGrid }[] = [
  { label: 'Dashboard', icon: LayoutGrid }, { label: 'Live Streams', icon: Radio },
  { label: 'Recordings', icon: Video }, { label: 'Playback Library', icon: Film },
  { label: 'Stream Manager', icon: SlidersHorizontal }, { label: 'Settings', icon: SettingsIcon },
]
const initialStream = { name: '', url: '', group_name: 'General', quality: 'best', container: 'mkv', auto_record: false, monitor: true }
const playbackKey = 'streamx-playback-positions'

function bytes(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}
function duration(value = 0) {
  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
function dateText(value?: string | null) { return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' }
function State({ value, kind }: { value: string; kind?: string }) {
  const state = value || 'unknown'
  const tone = kind || (['recording', 'live', 'playing', 'completed'].includes(state) ? 'good' : ['reconnecting', 'starting', 'stopping'].includes(state) ? 'warm' : state === 'error' || state === 'offline' ? 'bad' : 'neutral')
  return <span className={`state-tag ${tone}`}><i/>{state.replaceAll('_', ' ')}</span>
}
function SectionHeading({ kicker, title, subtitle, actions }: { kicker: string; title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="section-heading"><div><div className="kicker">{kicker}</div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>
}

export default function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [streams, setStreams] = useState<Stream[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [system, setSystem] = useState<SystemInfo>({})
  const [logs, setLogs] = useState<Log[]>([])
  const [backendHealth, setBackendHealth] = useState<any>(null)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<Stream | null | false>(false)
  const [playingRecording, setPlayingRecording] = useState<Recording | null>(null)
  const [positions, setPositions] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem(playbackKey) || '{}') } catch { return {} }
  })

  const refresh = useCallback(async () => {
    try {
      const [nextStreams, nextRecordings, nextSettings, nextSystem, nextLogs, health] = await Promise.all([
        request<Stream[]>('/api/streams'), request<Recording[]>('/api/recordings'), request<Settings>('/api/settings'),
        request<SystemInfo>('/api/system'), request<Log[]>('/api/logs'), request('/health'),
      ])
      setStreams(nextStreams); setRecordings(nextRecordings); setSettings(nextSettings); setSystem(nextSystem); setLogs(nextLogs); setBackendHealth(health)
    } catch { setBackendHealth({ ok: false }) }
  }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => clearInterval(timer) }, [refresh])
  useEffect(() => {
    let socket: WebSocket | null = null
    let retry = 0
    let closed = false
    const connect = async () => {
      const token = await window.streamx?.getApiToken()
      if (closed) return
      socket = new WebSocket(wsUrl(token))
      socket.onmessage = event => {
        const message = JSON.parse(event.data)
        if (message.event === 'system') setSystem(message.data)
        if (message.event === 'stream-status' || message.event === 'recording' || message.event === 'recording-finished') void refresh()
      }
      socket.onclose = () => { if (!closed) retry = window.setTimeout(connect, 1800) }
    }
    void connect()
    return () => { closed = true; clearTimeout(retry); socket?.close() }
  }, [refresh])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer) }, [toast])

  const liveCount = streams.filter(stream => stream.availability?.state === 'live').length
  const recordingCount = streams.filter(stream => stream.session && !['completed', 'error'].includes(stream.session.state)).length
  const playbackCount = streams.filter(stream => stream.timeshift && ['starting', 'playing', 'stopping'].includes(stream.timeshift.state)).length
  const completedCount = recordings.filter(recording => recording.status === 'completed').length
  const storage = recordings.reduce((total, recording) => total + recording.file_size, 0)
  const visibleStreams = useMemo(() => streams.filter(stream => `${stream.name} ${stream.url} ${stream.group_name}`.toLowerCase().includes(query.toLowerCase())), [streams, query])
  const selected = streams.find(stream => stream.id === selectedId) || null

  async function streamAction(stream: Stream, action: 'record' | 'stop' | 'preview' | 'timeshift' | 'probe') {
    setBusy(stream.id)
    try {
      if (action === 'probe') {
        const result = await request<{ qualities: string[] }>(`/api/streams/${stream.id}/probe`, { method: 'POST' })
        setToast(`Source available · ${result.qualities.join(' · ')}`)
      } else {
        const method = action === 'preview' || action === 'record' || action === 'timeshift' ? 'POST' : 'POST'
        await request(`/api/streams/${stream.id}/${action}`, { method })
        setToast(action === 'record' ? 'Recording started.' : action === 'stop' ? 'Recording is finalizing.' : action === 'preview' ? 'Preview feed requested.' : 'Independent playback feed requested.')
      }
      await refresh()
    } catch (error) { setToast((error as Error).message) }
    finally { setBusy(null) }
  }
  async function stopPreview(stream: Stream) {
    try { await request(`/api/streams/${stream.id}/preview`, { method: 'DELETE' }); await refresh() }
    catch (error) { setToast((error as Error).message) }
  }
  async function stopTimeShift(stream: Stream) {
    try { await request(`/api/streams/${stream.id}/timeshift`, { method: 'DELETE' }); await refresh() }
    catch (error) { setToast((error as Error).message) }
  }
  async function removeStream(stream: Stream) {
    if (!window.confirm(`Remove “${stream.name}” from Stream Manager?`)) return
    try { await request(`/api/streams/${stream.id}`, { method: 'DELETE' }); setSelectedId(null); await refresh() }
    catch (error) { setToast((error as Error).message) }
  }
  async function removeRecording(recording: Recording) {
    if (!window.confirm(`Delete “${recording.stream_name}” and its media file? This cannot be undone.`)) return
    try { await request(`/api/recordings/${recording.id}`, { method: 'DELETE' }); await refresh() }
    catch (error) { setToast((error as Error).message) }
  }
  function savePosition(recordingId: number, position: number) {
    const next = { ...positions, [recordingId]: position }
    setPositions(next)
    localStorage.setItem(playbackKey, JSON.stringify(next))
  }
  function navigate(name: Page) { setPage(name); setQuery('') }

  return <div className="studio-shell">
    <header className="top-navigation">
      <button className="brand-lockup" onClick={() => navigate('Dashboard')} aria-label="StreamX Studio dashboard">
        <span className="brand-emblem"><Radio size={19}/></span><span className="brand-word">STREAM<span>X</span><small>STUDIO</small></span>
      </button>
      <nav className="main-navigation" aria-label="Main navigation">
        {navigation.map(item => <button key={item.label} className={`nav-link ${page === item.label ? 'active' : ''}`} onClick={() => navigate(item.label)}><item.icon size={15}/>{item.label}</button>)}
      </nav>
      <div className="nav-right">
        <button className={`engine-status ${backendHealth?.ok ? 'online' : 'offline'}`} onClick={() => navigate('Settings')}><i/>{backendHealth?.ok ? 'ENGINE READY' : 'ENGINE OFFLINE'}</button>
        <span className="nav-divider"/><button className="utility-link" onClick={() => navigate('Browser')} title="Open site browser"><Globe size={16}/></button><button className="utility-link" onClick={() => navigate('Logs')} title="Open activity log"><Terminal size={15}/></button>
        <button className="utility-link" onClick={refresh} title="Refresh status"><RefreshCw size={15}/></button>
        <span className="profile-mark">SX</span>
      </div>
    </header>

    <main className="workspace">
      {page === 'Dashboard' && <Dashboard streams={visibleStreams} allCount={streams.length} liveCount={liveCount} recordingCount={recordingCount} playbackCount={playbackCount} completedCount={completedCount} storage={storage} system={system} query={query} setQuery={setQuery} layout={layout} setLayout={setLayout} busy={busy} onAdd={() => setEditor(null)} onOpen={setSelectedId} onAction={streamAction} onStopPreview={stopPreview} onStopPlayback={stopTimeShift} onEdit={(stream: Stream) => setEditor(stream)} onRemove={removeStream} onPage={navigate}/>}
      {page === 'Live Streams' && <StreamPage title="Live stream monitor" kicker="SIGNAL MONITOR" subtitle="Watch source health and independently manage preview, capture, and playback sessions." streams={visibleStreams} query={query} setQuery={setQuery} layout={layout} setLayout={setLayout} busy={busy} onAdd={() => setEditor(null)} onOpen={setSelectedId} onAction={streamAction} onStopPreview={stopPreview} onStopPlayback={stopTimeShift} onEdit={(stream: Stream) => setEditor(stream)} onRemove={removeStream}/>}
      {page === 'Stream Manager' && <ManagerPage streams={visibleStreams} query={query} setQuery={setQuery} onAdd={() => setEditor(null)} onEdit={(stream: Stream) => setEditor(stream)} onRemove={removeStream} onOpen={setSelectedId}/>}
      {page === 'Recordings' && <RecordingPage recordings={recordings} query={query} setQuery={setQuery} positions={positions} onPlay={setPlayingRecording} onDelete={removeRecording} onOpen={(path: string) => window.streamx?.openPath(path)}/>}
      {page === 'Playback Library' && <PlaybackLibrary recordings={recordings} query={query} setQuery={setQuery} positions={positions} onPlay={setPlayingRecording} onDelete={removeRecording} onOpen={(path: string) => window.streamx?.openPath(path)}/>}
      {page === 'Settings' && <SettingsPage settings={settings} backendHealth={backendHealth} onSaved={refresh} toast={setToast} onOpenFolder={(path: string) => window.streamx?.openPath(path)}/>}
      {page === 'Browser' && <BrowserPage toast={setToast}/>}
      {page === 'Logs' && <LogsPage logs={logs} onRefresh={refresh}/>}
    </main>

    {editor !== false && <StreamEditor stream={editor || null} onClose={() => setEditor(false)} onSaved={async () => { setEditor(false); await refresh() }} toast={setToast}/>}
    {selected && <StreamDetails stream={selected} system={system} onClose={() => { if (selected.timeshift) void stopTimeShift(selected); setSelectedId(null) }} onAction={streamAction} onStopPreview={stopPreview} onStopPlayback={stopTimeShift} onEdit={() => { setSelectedId(null); setEditor(selected) }} onRemove={() => void removeStream(selected)}/>}
    {playingRecording && <RecordingPlayer recording={playingRecording} startAt={positions[playingRecording.id] || 0} onPosition={value => savePosition(playingRecording.id, value)} onClose={() => setPlayingRecording(null)}/>}
    {toast && <div className="toast"><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss"><X size={15}/></button></div>}
  </div>
}

function Dashboard(props: any) {
  const { streams, allCount, liveCount, recordingCount, playbackCount, completedCount, storage, system, query, setQuery, layout, setLayout, busy, onAdd, onOpen, onAction, onStopPreview, onStopPlayback, onEdit, onRemove, onPage } = props
  const stats = [
    { name: 'SOURCES', value: allCount, icon: Radio, note: 'Configured inputs', tone: 'violet' },
    { name: 'ONLINE', value: liveCount, icon: Activity, note: 'Signal available', tone: 'green' },
    { name: 'RECORDING', value: recordingCount, icon: Video, note: 'Independent captures', tone: 'red' },
    { name: 'PLAYBACK', value: playbackCount, icon: MonitorPlay, note: 'Time-shift sessions', tone: 'blue' },
    { name: 'COMPLETED', value: completedCount, icon: Archive, note: 'In media library', tone: 'gold' },
    { name: 'STORAGE', value: bytes(storage), icon: HardDrive, note: 'Recording media', tone: 'violet' },
    { name: 'DISK FREE', value: bytes(system.disk?.free || 0), icon: Gauge, note: 'Current volume', tone: 'green' },
    { name: 'NETWORK', value: `${bytes(system.network_bps || 0)}/s`, icon: Network, note: 'System throughput', tone: 'blue' },
    { name: 'CPU / RAM', value: `${system.cpu ?? '—'}% / ${system.ram ?? '—'}%`, icon: Cpu, note: 'System load', tone: 'gold' },
  ]
  return <>
    <SectionHeading kicker="BROADCAST CONTROL / 01" title="Control room" subtitle="A live view of your sources, recordings, and playback sessions."
      actions={<><button className="button secondary" onClick={() => onPage('Playback Library')}><Film size={15}/>Playback library</button><button className="button primary" onClick={onAdd}><Plus size={16}/>Add source</button></>}/>
    {system.disk?.low && <div className="disk-alert"><AlertTriangle size={17}/><span>Low disk space</span><small>{bytes(system.disk.free)} available on the recording volume</small><button className="text-link" onClick={() => onPage('Settings')}>Review settings <ArrowUpRight size={14}/></button></div>}
    <div className="telemetry-grid">{stats.map(item => <div className="telemetry-card" key={item.name}><div className={`telemetry-icon ${item.tone}`}><item.icon size={16}/></div><span className="telemetry-label">{item.name}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}</div>
    <div className="monitor-heading"><div><div className="kicker">MULTI-SOURCE MONITOR</div><h2>Live sources <span>{streams.length}</span></h2><p>Click any monitor for detailed controls and independent playback.</p></div><div className="monitor-tools"><SearchBox value={query} onChange={setQuery}/><LayoutToggle layout={layout} setLayout={setLayout}/></div></div>
    <StreamGrid streams={streams} layout={layout} busy={busy} onOpen={onOpen} onAction={onAction} onStopPreview={onStopPreview} onStopPlayback={onStopPlayback} onEdit={onEdit} onRemove={onRemove}/>
    <div className="system-strip"><div className="system-strip-title"><span className="online-pulse"/><div><strong>System telemetry</strong><small>Live local machine metrics</small></div></div><Metric label="CPU" value={system.cpu == null ? '—' : `${system.cpu}%`}/><Metric label="MEMORY" value={system.ram == null ? '—' : `${system.ram}%`}/><Metric label="NETWORK" value={`${bytes(system.network_bps || 0)}/s`}/><Metric label="FREE SPACE" value={bytes(system.disk?.free || 0)}/></div>
  </>
}

function StreamPage({ title, kicker, subtitle, streams, query, setQuery, layout, setLayout, busy, onAdd, onOpen, onAction, onStopPreview, onStopPlayback, onEdit, onRemove }: any) {
  return <>
    <SectionHeading kicker={kicker} title={title} subtitle={subtitle} actions={<button className="button primary" onClick={onAdd}><Plus size={15}/>Add source</button>}/>
    <div className="monitor-tools wide"><SearchBox value={query} onChange={setQuery} placeholder="Find a source by name, group, or URL"/><LayoutToggle layout={layout} setLayout={setLayout}/></div>
    <StreamGrid streams={streams} layout={layout} busy={busy} onOpen={onOpen} onAction={onAction} onStopPreview={onStopPreview} onStopPlayback={onStopPlayback} onEdit={onEdit} onRemove={onRemove}/>
  </>
}

function SearchBox({ value, onChange, placeholder = 'Search sources…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-field"><Search size={15}/><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/>{value && <button onClick={() => onChange('')} aria-label="Clear search"><X size={13}/></button>}</label>
}
function LayoutToggle({ layout, setLayout }: { layout: 'grid' | 'list'; setLayout: (value: 'grid' | 'list') => void }) {
  return <div className="layout-toggle"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} title="Grid view"><LayoutGrid size={15}/></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} title="List view"><List size={15}/></button></div>
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="strip-metric"><span>{label}</span><strong>{value}</strong></div> }

function StreamGrid({ streams, layout, busy, onOpen, onAction, onStopPreview, onStopPlayback, onEdit, onRemove }: any) {
  if (!streams.length) return <div className="empty-monitor"><div className="empty-icon"><Radio size={24}/></div><h3>No sources in this view</h3><p>Add a Streamlink website or direct stream URL to start monitoring.</p></div>
  return <div className={`stream-grid ${layout}`}>{streams.map((stream: Stream) => <StreamCard key={stream.id} stream={stream} busy={busy === stream.id} onOpen={() => onOpen(stream.id)} onAction={(action: string) => onAction(stream, action)} onStopPreview={() => onStopPreview(stream)} onStopPlayback={() => onStopPlayback(stream)} onEdit={() => onEdit(stream)} onRemove={() => onRemove(stream)}/>)}</div>
}

function StreamCard({ stream, busy, onOpen, onAction, onStopPreview, onStopPlayback, onEdit, onRemove }: any) {
  const recording = stream.session && !['completed', 'error'].includes(stream.session.state)
  const preview = stream.preview && ['starting', 'playing', 'reconnecting'].includes(stream.preview.state)
  const playback = stream.timeshift && ['starting', 'playing', 'stopping'].includes(stream.timeshift.state)
  const url = (() => { try { return new URL(stream.url).host } catch { return stream.url } })()
  return <article className="stream-card">
    <div className="monitor-screen" onClick={onOpen} role="button" tabIndex={0} onKeyDown={event => event.key === 'Enter' && onOpen()}>
      {preview ? <VideoPreview src={stream.preview.url} showControls={false}/> : <div className="monitor-placeholder"><div className="signal-grid"/><div className="placeholder-center"><span className="placeholder-icon"><Radio size={22}/></span><span>{stream.availability?.state === 'live' ? 'SOURCE ONLINE' : 'MONITOR STANDBY'}</span><small>{stream.availability?.state === 'live' ? 'Preview is not running' : 'Start a preview to inspect the feed'}</small></div><div className="monitor-time">{new Date().toLocaleTimeString([], { hour12: false })}</div></div>}
      <div className="monitor-overlays"><State value={stream.availability?.state || 'unknown'} kind={stream.availability?.state === 'live' ? 'good' : 'neutral'}/>{recording && <State value="recording"/>}{playback && <span className="playback-chip"><Play size={10}/>PLAYBACK</span>}</div>
      {!preview && <button className="monitor-preview-button" onClick={event => { event.stopPropagation(); onAction('preview') }} title="Start independent preview"><Play size={14}/></button>}
      <button className="monitor-expand" onClick={event => { event.stopPropagation(); onOpen() }} title="Open stream details"><Maximize size={13}/></button>
    </div>
    <div className="stream-card-body">
      <div className="stream-card-title"><div className="source-glyph"><Radio size={15}/></div><div className="stream-title-text"><strong>{stream.name}</strong><small>{url} <span>·</span> {stream.group_name || 'General'}</small></div><button className="dots-button" onClick={onEdit} title="Configure stream"><MoreHorizontal size={17}/></button></div>
      <div className="stream-metrics"><div><span>QUALITY</span><strong>{stream.quality === 'best' ? 'BEST AVAILABLE' : stream.quality}</strong></div><div><span>RESOLUTION</span><strong>{stream.session?.resolution || '—'}</strong></div><div><span>BITRATE</span><strong>{stream.session?.bitrate ? `${Math.round(stream.session.bitrate / 1000)} kb/s` : '—'}</strong></div></div>
      <div className="recording-info-row"><span className={recording ? 'recording-state' : ''}><i/>{recording ? `${stream.session.state} · ${duration(stream.session.duration)}` : 'No active recording'}</span><span>{recording ? bytes(stream.session.file_size) : ''}</span></div>
      {(stream.availability?.error || stream.preview?.error) && <div className="source-error" title={stream.availability?.error || stream.preview?.error}><AlertTriangle size={12}/>{stream.preview?.error || stream.availability.error}</div>}
      <div className="stream-actions">
        {recording ? <button className="action-button stop" onClick={() => onAction('stop')} disabled={busy}><Square size={13}/>Stop</button> : <button className="action-button record" onClick={() => onAction('record')} disabled={busy}><span className="rec-dot"/>Record</button>}
        <button className="action-button" onClick={onOpen}><MonitorPlay size={14}/>Open player</button>
        <button className="action-icon" onClick={onEdit} title="Configure"><SlidersHorizontal size={14}/></button>
      </div>
      {preview && <button className="preview-stop-link" onClick={onStopPreview}>Close live preview</button>}
      {playback && <button className="preview-stop-link" onClick={onStopPlayback}>Close time-shift buffer</button>}
    </div>
  </article>
}

function StreamDetails({ stream, system, onClose, onAction, onStopPreview, onStopPlayback, onEdit, onRemove }: any) {
  const recording = stream.session && !['completed', 'error'].includes(stream.session.state)
  const playback: PlaybackSession | null = stream.timeshift || null
  const preview = stream.preview && ['starting', 'playing', 'reconnecting'].includes(stream.preview.state)
  const [busy, setBusy] = useState(false)
  async function action(name: string) {
    setBusy(true)
    try { await onAction(stream, name) } finally { setBusy(false) }
  }
  return <div className="detail-scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="detail-window">
      <header className="detail-header"><div><div className="kicker">SOURCE DETAIL / {String(stream.id).padStart(3, '0')}</div><h2>{stream.name}</h2><span>{stream.url}</span></div><div className="detail-head-actions"><State value={stream.availability?.state || 'unknown'}/><button className="icon-button" title="Close details" onClick={onClose}><X size={18}/></button></div></header>
      <div className="detail-layout">
        <div className="detail-primary">
          {playback?.url ? <TimeShiftPlayer src={playback.url} state={playback.state} error={playback.error} bufferMinutes={playback.buffer_minutes} onClose={() => onStopPlayback(stream)}/> : preview ? <div className="detail-preview"><VideoPreview src={stream.preview.url} mutedByDefault={false}/><div className="detail-preview-label"><span className="live-mark on"><i/>LIVE PREVIEW</span><button className="button compact" onClick={() => onStopPreview(stream)}>Stop preview</button></div></div> : <div className="detail-placeholder"><span><MonitorPlay size={28}/></span><strong>{stream.preview?.state === 'error' ? 'Preview could not start' : 'Live monitor is ready'}</strong><small>{stream.preview?.error || 'Open an independent preview, or start time-shift playback while your recording continues.'}</small><div><button className="button secondary" onClick={() => void action('preview')} disabled={busy}><Play size={14}/>{stream.preview?.state === 'error' ? 'Retry preview' : 'Start preview'}</button><button className="button primary" onClick={() => void action('timeshift')} disabled={busy}><Clock3 size={14}/>Open time-shift player</button></div></div>}
          <div className="detail-transport"><div><span className="kicker">RECORDING PIPELINE</span><strong>{recording ? 'Capturing source' : 'Not recording'}</strong></div>{recording ? <button className="button stop-button" onClick={() => void action('stop')} disabled={busy}><Square size={13}/>Stop recording</button> : <button className="button record-button" onClick={() => void action('record')} disabled={busy}><span className="rec-dot"/>Start recording</button>}</div>
          <div className="detail-tiles"><DetailTile icon={<Clock3 size={15}/>} label="ELAPSED" value={recording ? duration(stream.session.duration) : '—'}/><DetailTile icon={<Gauge size={15}/>} label="BITRATE" value={stream.session?.bitrate ? `${Math.round(stream.session.bitrate / 1000)} kb/s` : '—'}/><DetailTile icon={<MonitorPlay size={15}/>} label="VIDEO MODE" value={stream.session?.resolution || 'Awaiting probe'}/><DetailTile icon={<HardDrive size={15}/>} label="WRITTEN" value={bytes(stream.session?.file_size || 0)}/><DetailTile icon={<Network size={15}/>} label="HOST NETWORK" value={`${bytes(system?.network_bps || 0)}/s`}/></div>
        </div>
        <aside className="detail-rail">
          <div className="rail-panel"><div className="rail-title"><span>STREAM HEALTH</span><Activity size={14}/></div><div className="rail-row"><span>Availability</span><State value={stream.availability?.state || 'unknown'}/></div><div className="rail-row"><span>Recording</span><State value={recording ? stream.session.state : 'stopped'}/></div><div className="rail-row"><span>Playback</span><State value={playback?.state || 'closed'}/></div><div className="rail-row"><span>Selected quality</span><strong>{stream.quality}</strong></div><div className="rail-row"><span>Container</span><strong>{stream.container.toUpperCase()}</strong></div><div className="available-qualities"><span>AVAILABLE QUALITIES</span><strong>{stream.availability?.qualities?.join(' · ') || 'Not checked yet'}</strong></div><button className="button secondary full-width" onClick={() => void action('probe')} disabled={busy}><RefreshCw size={14}/>Check compatibility</button></div>
          <div className="rail-panel"><div className="rail-title"><span>PROCESS CONTROLS</span><SlidersHorizontal size={14}/></div><p>Recording and playback use independent acquisition sessions. Player controls never pause, seek, or restart the recording process.</p><button className="button secondary full-width" onClick={onEdit}><SlidersHorizontal size={14}/>Configure source</button><button className="text-danger" onClick={onRemove}><Trash2 size={14}/>Remove source</button></div>
          {stream.session?.path && <div className="rail-panel"><div className="rail-title"><span>RECORDING FILE</span><FolderOpen size={14}/></div><p className="path-preview">{stream.session.path}</p><button className="button secondary full-width" onClick={() => window.streamx?.openPath(stream.session.path)}><FolderOpen size={14}/>Open recording folder</button></div>}
        </aside>
      </div>
    </section>
  </div>
}
function DetailTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="detail-tile"><span>{icon}{label}</span><strong>{value}</strong></div> }

function ManagerPage({ streams, query, setQuery, onAdd, onEdit, onRemove, onOpen }: any) {
  return <>
    <SectionHeading kicker="SOURCE CONFIGURATION" title="Stream manager" subtitle="Organize sources, quality preferences, monitoring, and automatic recording." actions={<button className="button primary" onClick={onAdd}><Plus size={15}/>Add source</button>}/>
    <div className="panel manager-panel"><div className="panel-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Search name, group, or URL"/><span className="panel-count">{streams.length} SOURCES</span></div>
      <div className="manager-table"><div className="manager-head"><span>SOURCE</span><span>GROUP</span><span>QUALITY</span><span>FORMAT</span><span>MONITOR</span><span>AUTO REC</span><span>ACTIONS</span></div>{streams.map((stream: Stream) => <div className="manager-row" key={stream.id}><button className="managed-source" onClick={() => onOpen(stream.id)}><span className="source-glyph"><Radio size={14}/></span><span><strong>{stream.name}</strong><small>{stream.url}</small></span></button><span>{stream.group_name || 'General'}</span><span>{stream.quality}</span><span>{stream.container.toUpperCase()}</span><State value={stream.availability?.state || 'unknown'}/><span>{stream.auto_record ? 'Enabled' : '—'}</span><span className="manager-actions"><button className="icon-button" onClick={() => onEdit(stream)} title="Edit"><SlidersHorizontal size={14}/></button><button className="icon-button danger" onClick={() => onRemove(stream)} title="Remove"><Trash2 size={14}/></button></span></div>)}{!streams.length && <div className="empty-table">No configured sources match this search.</div>}</div>
    </div>
  </>
}

function RecordingPage({ recordings, query, setQuery, positions, onPlay, onDelete, onOpen }: any) {
  const [date, setDate] = useState('')
  const filtered = recordings.filter((recording: Recording) => `${recording.stream_name} ${recording.path}`.toLowerCase().includes(query.toLowerCase()) && (!date || recording.started_at.slice(0, 10) === date))
  const completeBytes = recordings.reduce((sum: number, recording: Recording) => sum + (recording.file_size || 0), 0)
  return <>
    <SectionHeading kicker="MEDIA OPERATIONS" title="Recordings" subtitle="Inspect active capture sessions, completed files, and finalization status."/>
    <div className="library-summary"><div><span>FILES</span><strong>{recordings.length}</strong></div><div><span>STORAGE USED</span><strong>{bytes(completeBytes)}</strong></div><div><span>ACTIVE CAPTURE</span><strong>{recordings.filter((item: Recording) => item.progress).length}</strong></div></div>
    <div className="panel library-panel"><div className="panel-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Search recordings or streams"/><label className="date-filter">DATE <input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><span className="panel-count">{filtered.length} RESULTS</span></div><RecordingTable recordings={filtered} positions={positions} onPlay={onPlay} onDelete={onDelete} onOpen={onOpen}/></div>
  </>
}
function PlaybackLibrary(props: any) {
  const { recordings, query, setQuery, positions, onPlay, onDelete, onOpen } = props
  const [date, setDate] = useState('')
  const complete = recordings.filter((recording: Recording) => recording.status === 'completed' && recording.exists)
  const filtered = complete.filter((recording: Recording) => `${recording.stream_name} ${recording.path}`.toLowerCase().includes(query.toLowerCase()) && (!date || recording.started_at.slice(0, 10) === date))
  const resumable = complete.filter((recording: Recording) => positions[recording.id] > 0)
  return <>
    <SectionHeading kicker="ON-DEMAND PLAYBACK" title="Playback library" subtitle="Resume at your last position or open a completed capture in the media player."/>
    {!!resumable.length && <div className="resume-strip"><div><div className="kicker">CONTINUE WATCHING</div><strong>{resumable.length} recording{resumable.length === 1 ? '' : 's'} ready to resume</strong></div>{resumable.slice(0, 3).map((recording: Recording) => <button key={recording.id} onClick={() => onPlay(recording)}><Play size={13}/>{recording.stream_name}<small>{duration(positions[recording.id])}</small></button>)}</div>}
    <div className="panel library-panel"><div className="panel-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Search playback library"/><label className="date-filter">DATE <input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><span className="panel-count">{filtered.length} COMPLETED</span></div><RecordingTable recordings={filtered} positions={positions} onPlay={onPlay} onDelete={onDelete} onOpen={onOpen}/></div>
  </>
}

function RecordingTable({ recordings, positions, onPlay, onDelete, onOpen }: any) {
  if (!recordings.length) return <div className="empty-table"><div className="empty-icon"><Film size={22}/></div><strong>No recordings here yet</strong><span>Recorded media will appear here after a capture is finalized.</span></div>
  return <div className="recording-list">{recordings.map((recording: Recording) => {
    const active = recording.progress && !['completed', 'error'].includes(recording.progress.state)
    const resume = positions[recording.id] || 0
    return <article className="recording-row" key={recording.id}>
      <button className={`media-thumb ${active ? 'active' : ''}`} onClick={() => active ? onOpen(recording.path) : onPlay(recording)} title={active ? 'Open current recording file' : 'Play recording'}>{active ? <span className="rec-dot"/> : <FileVideo2 size={19}/>}</button>
      <div className="recording-main"><div><strong>{recording.stream_name}</strong><State value={recording.status}/></div><small>{dateText(recording.started_at)} <i/> {recording.format.toUpperCase()} <i/> {recording.exists ? bytes(recording.file_size) : 'File unavailable'}</small>{active && <div className="recording-progress"><span style={{ width: `${Math.max(8, Math.min(100, (recording.progress?.duration || 0) / 3600 * 100))}%` }}/></div>}</div>
      {resume > 0 && !active && <span className="resume-position">Resume {duration(resume)}</span>}
      <div className="recording-actions">{active ? <button className="button compact" onClick={() => onOpen(recording.path)}><FolderOpen size={13}/>Open file</button> : <button className="button compact primary" onClick={() => onPlay(recording)} disabled={!recording.exists}><Play size={13}/>{resume > 0 ? 'Resume' : 'Play'}</button>}<button className="icon-button danger" onClick={() => onDelete(recording)} title="Delete recording"><Trash2 size={14}/></button></div>
    </article>
  })}</div>
}

function StreamEditor({ stream, onClose, onSaved, toast }: { stream: Stream | null; onClose: () => void; onSaved: () => void; toast: (message: string) => void }) {
  const [form, setForm] = useState<any>(stream ? { name: stream.name, url: stream.url, group_name: stream.group_name, quality: stream.quality, container: stream.container, auto_record: stream.auto_record, monitor: stream.monitor } : initialStream)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [compat, setCompat] = useState<{ qualities: string[]; error?: string } | null>(null)
  function update(key: string, value: any) { setForm((current: any) => ({ ...current, [key]: value })) }
  async function check() {
    setChecking(true); setCompat(null)
    try { const result = await request<{ qualities: string[] }>('/api/probe', { method: 'POST', body: JSON.stringify({ url: form.url }) }); setCompat(result); if (result.qualities.includes('best')) update('quality', 'best') }
    catch (error) { setCompat({ qualities: [], error: (error as Error).message }) }
    finally { setChecking(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true)
    try { await request(stream ? `/api/streams/${stream.id}` : '/api/streams', { method: stream ? 'PUT' : 'POST', body: JSON.stringify(form) }); onSaved() }
    catch (error) { toast((error as Error).message) }
    finally { setSaving(false) }
  }
  return <div className="modal-scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="source-modal" onSubmit={save}>
    <div className="modal-heading"><div><div className="kicker">SOURCE CONFIGURATION</div><h2>{stream ? 'Configure source' : 'Add a source'}</h2><p>Choose the Streamlink URL and recording behavior.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <label className="form-label">Stream name<input required maxLength={120} value={form.name} onChange={event => update('name', event.target.value)} placeholder="e.g. Studio A · Main feed"/></label>
    <label className="form-label">Website or direct stream URL<input required type="url" value={form.url} onChange={event => { update('url', event.target.value); setCompat(null) }} placeholder="https://…"/></label>
    <div className="compat-row"><button type="button" className="button secondary" onClick={check} disabled={!form.url || checking}>{checking ? <LoaderCircle className="spin" size={14}/> : <ZapIcon/>}Check compatibility</button><span>Uses actual Streamlink availability</span></div>
    {compat && <div className={`compat-message ${compat.error ? 'error' : 'success'}`}>{compat.error ? <AlertTriangle size={14}/> : <Check size={14}/>}<span>{compat.error || `Available qualities: ${compat.qualities.join(', ')}`}</span></div>}
    <div className="form-grid"><label className="form-label">Group<input value={form.group_name} onChange={event => update('group_name', event.target.value)} placeholder="General"/></label><label className="form-label">Quality<select value={form.quality} onChange={event => update('quality', event.target.value)}>{['best', '1080p', '720p', '480p', 'worst', ...(compat?.qualities || [])].filter((quality, index, all) => all.indexOf(quality) === index).map(quality => <option key={quality} value={quality}>{quality === 'best' ? 'Best available' : quality}</option>)}</select></label><label className="form-label">Recording container<select value={form.container} onChange={event => update('container', event.target.value)}>{['mkv', 'mp4', 'ts'].map(container => <option key={container} value={container}>{container.toUpperCase()}</option>)}</select></label></div>
    <label className="check-row"><span><strong>Monitor availability</strong><small>Check this source on the configured interval</small></span><input type="checkbox" checked={form.monitor} onChange={event => update('monitor', event.target.checked)}/></label>
    <label className="check-row"><span><strong>Record when live</strong><small>Start a capture automatically when available</small></span><input type="checkbox" checked={form.auto_record} onChange={event => update('auto_record', event.target.checked)}/></label>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving && <LoaderCircle className="spin" size={14}/>}Save source</button></div>
  </form></div>
}
function ZapIcon() { return <Activity size={14}/> }

function SettingsPage({ settings, backendHealth, onSaved, toast, onOpenFolder }: any) {
  const [form, setForm] = useState<any>(settings || {})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (settings) setForm(settings) }, [settings])
  function update(name: string, value: any) { setForm((current: any) => ({ ...current, [name]: value })) }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true)
    const payload = { ...form, preview_transcode: String(form.preview_transcode).toLowerCase() === 'true' }
    try { const next = await request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }); setForm(next); onSaved(); toast('Studio settings saved.') }
    catch (error) { toast((error as Error).message) }
    finally { setSaving(false) }
  }
  return <>
    <SectionHeading kicker="STUDIO PREFERENCES" title="Settings" subtitle="Configure recording, time-shift storage, preview quality, and system thresholds."/>
    <form className="settings-layout" onSubmit={save}><section className="panel settings-panel">
      <SettingsGroup title="Recording" icon={<Video size={16}/>}><label className="form-label">Recording folder<div className="input-button"><input value={form.recording_dir || ''} onChange={event => update('recording_dir', event.target.value)}/><button className="button secondary compact" type="button" onClick={() => onOpenFolder(form.recording_dir)}><FolderOpen size={13}/>Open</button></div></label><div className="form-grid"><NumberSetting label="Maximum concurrent recordings" value={form.max_recordings || 4} min={1} max={64} onChange={(value: string) => update('max_recordings', value)}/><NumberSetting label="Reconnect interval (seconds)" value={form.retry_seconds || 10} min={2} max={3600} onChange={(value: string) => update('retry_seconds', value)}/></div><label className="form-label">Recording segment length<select value={form.segment_minutes || 0} onChange={event => update('segment_minutes', event.target.value)}><option value="0">Single file until stopped</option>{[30, 60, 120, 240, 480].map(value => <option key={value} value={value}>{value < 60 ? `${value} minutes` : `${value / 60} hours`}</option>)}</select></label></SettingsGroup>
      <SettingsGroup title="Time-shift buffer" icon={<Clock3 size={16}/>}><p className="settings-copy">Each playback session opens its own Streamlink and FFmpeg pipeline. Pause and seek affect only the player. Temporary HLS segments are deleted when the playback session closes.</p><div className="form-grid"><NumberSetting label="Maximum buffer window (minutes)" value={form.timeshift_buffer_minutes || 60} min={5} max={1440} onChange={(value: string) => update('timeshift_buffer_minutes', value)}/><NumberSetting label="Maximum temporary storage (GB)" value={form.timeshift_max_storage_gb || 4} min={1} max={512} onChange={(value: string) => update('timeshift_max_storage_gb', value)}/><NumberSetting label="Minimum free space (GB)" value={form.timeshift_min_free_gb || 5} min={0} max={1000} onChange={(value: string) => update('timeshift_min_free_gb', value)}/></div></SettingsGroup>
      <SettingsGroup title="Preview and monitoring" icon={<Activity size={16}/>}><label className="form-label">Source check interval<select value={form.monitor_seconds || 30} onChange={event => update('monitor_seconds', event.target.value)}>{[15, 30, 60, 120, 300].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label><label className="check-row"><span><strong>Transcode live preview to H.264/AAC</strong><small>Uses additional CPU for browser-compatible preview; recording remains stream-copy.</small></span><input type="checkbox" checked={String(form.preview_transcode).toLowerCase() !== 'false'} onChange={event => update('preview_transcode', event.target.checked)}/></label><label className="form-label">Low disk warning<select value={form.low_disk_gb || 5} onChange={event => update('low_disk_gb', event.target.value)}>{[1, 2, 5, 10, 20, 50].map(value => <option key={value} value={value}>{value} GB available</option>)}</select></label></SettingsGroup>
      <div className="settings-save"><button className="button primary" disabled={saving}>{saving && <LoaderCircle className="spin" size={14}/>}Save preferences</button></div>
    </section><aside className="panel diagnostics-panel"><div className="panel-title"><span className="kicker">SYSTEM DIAGNOSTICS</span><Activity size={16}/></div><Diagnostic label="Streamlink" value={backendHealth?.streamlink?.installed ? `Ready · ${backendHealth.streamlink.version}` : 'Not detected'}/><Diagnostic label="FFmpeg" value={backendHealth?.ffmpeg ? 'Available' : 'Not detected'}/><Diagnostic label="FFprobe" value={backendHealth?.ffprobe ? 'Available' : 'Not detected'}/><Diagnostic label="Media previews" value="Independent HLS pipeline"/><Diagnostic label="Time-shift" value="Bounded temporary HLS buffer"/><Diagnostic label="Database" value="Local SQLite"/><div className="diagnostic-callout"><CircleHelp size={15}/><span>The time-shift pipeline uses an additional source connection and temporary storage. Closing playback removes its buffer only; recording files are never part of that cleanup.</span></div></aside></form>
  </>
}
function SettingsGroup({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className="settings-group"><h2>{icon}{title}</h2>{children}</section> }
function NumberSetting({ label, value, min, max, onChange }: any) { return <label className="form-label">{label}<input type="number" min={min} max={max} value={value} onChange={event => onChange(event.target.value)}/></label> }
function Diagnostic({ label, value }: { label: string; value: string }) { return <div className="diagnostic-row"><span>{label}</span><strong>{value}</strong></div> }

function BrowserPage({ toast }: { toast: (message: string) => void }) {
  const [url, setUrl] = useState('https://')
  return <>
    <SectionHeading kicker="MANUAL SOURCE INSPECTION" title="Site browser" subtitle="Open a normal browser window to inspect a source manually."/>
    <section className="panel browser-panel"><div className="browser-symbol"><Globe size={24}/></div><h2>Open a source website</h2><p>Browsing is separate from Streamlink capture. Browser session credentials are not passed into recording or playback sessions.</p><form onSubmit={event => { event.preventDefault(); void window.streamx?.openBrowser(url).catch(error => toast(error.message)) }}><input type="url" value={url} onChange={event => setUrl(event.target.value)} required/><button className="button primary"><ExternalLink size={14}/>Open browser</button></form></section>
  </>
}
function LogsPage({ logs, onRefresh }: { logs: Log[]; onRefresh: () => void }) {
  return <><SectionHeading kicker="ENGINE EVENTS" title="Activity log" subtitle="Stream checks, reconnects, preview status, playback storage, and recording events." actions={<button className="button secondary" onClick={onRefresh}><RefreshCw size={14}/>Refresh</button>}/><div className="panel logs-panel">{logs.map(log => <div className="log-entry" key={log.id}><time>{new Date(`${log.at}Z`).toLocaleString()}</time><State value={log.level} kind={log.level === 'error' ? 'bad' : log.level === 'warning' ? 'warm' : 'neutral'}/><span>{log.message}</span></div>)}{!logs.length && <div className="empty-table">No engine activity recorded yet.</div>}</div></>
}

function RecordingPlayer({ recording, startAt, onPosition, onClose }: { recording: Recording; startAt: number; onPosition: (position: number) => void; onClose: () => void }) {
  const [source, setSource] = useState('')
  useEffect(() => { let alive = true; window.streamx?.getApiToken().then(token => { if (alive) setSource(`http://127.0.0.1:8765/api/recordings/${recording.id}/file?token=${encodeURIComponent(token)}`) }); return () => { alive = false } }, [recording.id])
  return <div className="modal-scrim player-scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="recording-player-modal"><header><div><div className="kicker">PLAYBACK LIBRARY</div><strong>{recording.stream_name}</strong><small>{dateText(recording.started_at)} · {recording.format.toUpperCase()}</small></div><button className="icon-button" onClick={onClose}><X size={17}/></button></header><video src={source || undefined} controls autoPlay onLoadedMetadata={event => { const media = event.currentTarget; if (startAt > 0 && startAt < media.duration - 2) media.currentTime = startAt }} onTimeUpdate={event => onPosition(event.currentTarget.currentTime)} onEnded={() => onPosition(0)}/></section></div>
}
