import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize, Pause, Play, Radio, Rewind, Volume2, VolumeX } from 'lucide-react'
import { mediaUrl } from './api'

type Props = { src: string; state?: string; error?: string | null; bufferMinutes?: number; onClose: () => void }

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor(value % 3600 / 60)
  const secs = value % 60
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function TimeShiftPlayer({ src, state = 'starting', error, bufferMinutes = 60, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<any>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0.82)
  const [speed, setSpeed] = useState(1)
  const [loading, setLoading] = useState(true)
  const [playerError, setPlayerError] = useState('')
  const [clockState, setClockState] = useState({ start: 0, end: 0, current: 0 })
  const delay = Math.max(0, clockState.end - clockState.current)
  const isLive = clockState.end > 0 && delay < 4
  const range = Math.max(0, clockState.end - clockState.start)
  const progress = range ? Math.max(0, Math.min(100, (clockState.current - clockState.start) / range * 100)) : 0
  const sourceStatus = useMemo(() => error || playerError || state, [error, playerError, state])

  useEffect(() => {
    const element = video.current
    if (!element) return
    let disposed = false
    let hls: any
    let retries = 0
    setLoading(true)
    setPlayerError('')
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return
      if (!Hls.isSupported()) {
        setPlayerError('This desktop runtime does not support HLS playback.')
        setLoading(false)
        return
      }
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 1000, maxLiveSyncPlaybackRate: 1, backBufferLength: 60,
        maxBufferLength: 45, maxMaxBufferLength: 120, manifestLoadingMaxRetry: 30,
        manifestLoadingRetryDelay: 700, levelLoadingMaxRetry: 30, levelLoadingRetryDelay: 700 })
      hlsRef.current = hls
      hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
        if (disposed || !data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 20) {
          setPlayerError('Waiting for the time-shift feed…')
          window.setTimeout(() => !disposed && hls.startLoad(), 800)
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries++ < 24) {
          setPlayerError('Recovering the playback decoder…')
          hls.recoverMediaError()
        } else {
          setLoading(false)
          setPlayerError(data.details || data.reason || 'Playback stopped because the media could not be decoded.')
        }
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerError('')
        void element.play().then(() => setPlaying(true)).catch(() => {
          setLoading(false)
          setPlayerError('Press Play to begin playback.')
        })
      })
      hls.on(Hls.Events.FRAG_LOADED, () => { retries = 0; setPlayerError('') })
      hls.loadSource(mediaUrl(src))
      hls.attachMedia(element)
    }).catch((exception: unknown) => {
      if (!disposed) {
        setLoading(false)
        setPlayerError(exception instanceof Error ? exception.message : 'The HLS player could not start.')
      }
    })
    const onPlaying = () => { setPlaying(true); setLoading(false); setPlayerError('') }
    const onWaiting = () => setLoading(true)
    element.addEventListener('playing', onPlaying)
    element.addEventListener('waiting', onWaiting)
    return () => {
      disposed = true
      element.removeEventListener('playing', onPlaying)
      element.removeEventListener('waiting', onWaiting)
      hls?.destroy()
      if (hlsRef.current === hls) hlsRef.current = null
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [src])

  useEffect(() => { if (video.current) video.current.volume = volume }, [volume])
  useEffect(() => { if (video.current) video.current.muted = muted }, [muted])
  useEffect(() => { if (video.current) video.current.playbackRate = speed }, [speed])
  useEffect(() => {
    const id = window.setInterval(() => {
      const media = video.current
      if (!media) return
      let start = 0, end = 0
      if (media.seekable.length) {
        start = media.seekable.start(media.seekable.length - 1)
        end = media.seekable.end(media.seekable.length - 1)
      }
      setClockState({ start, end, current: media.currentTime || start })
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  function togglePlayback() {
    const media = video.current
    if (!media) return
    if (media.paused) void media.play().then(() => { setPlaying(true); setPlayerError('') }).catch(exception => setPlayerError(exception.message))
    else { media.pause(); setPlaying(false) }
  }
  function seekBy(offset: number) {
    const media = video.current
    if (!media || !media.seekable.length) return
    const min = media.seekable.start(media.seekable.length - 1)
    const max = media.seekable.end(media.seekable.length - 1)
    media.currentTime = Math.max(min, Math.min(max - 0.2, media.currentTime + offset))
  }
  function jumpLive() {
    const media = video.current
    if (!media || !media.seekable.length) return
    media.currentTime = Math.max(media.seekable.start(media.seekable.length - 1), media.seekable.end(media.seekable.length - 1) - 0.5)
    void media.play().then(() => setPlaying(true)).catch(() => undefined)
  }
  function seekTo(value: number) {
    const media = video.current
    if (media?.seekable.length) {
      const index = media.seekable.length - 1
      media.currentTime = media.seekable.start(index) + value * (media.seekable.end(index) - media.seekable.start(index)) / 100
    }
  }

  return <section className="timeshift-panel">
    <div className="timeshift-heading">
      <div><span className={`live-mark ${isLive ? 'on' : ''}`}><i/>{isLive ? 'LIVE' : 'TIME-SHIFT'}</span>
        <strong>Independent playback</strong><small>Recorder runs in a separate process</small></div>
      <button className="icon-button" title="Close player" onClick={onClose}>×</button>
    </div>
    <div ref={frame} className="timeshift-video-wrap">
      <video ref={video} playsInline muted={muted} />
      {loading && <div className="player-overlay"><span className="spinner"/><span>{sourceStatus === 'starting' ? 'Starting independent playback capture…' : 'Buffering recorded segments…'}</span></div>}
      {!loading && playerError && <div className="player-overlay error"><strong>Playback issue</strong><span>{playerError}</span></div>}
      <div className="player-live-badge"><i/>{isLive ? 'LIVE' : `${clock(delay)} BEHIND LIVE`}</div>
    </div>
    <div className="timeshift-controls">
      <div className="control-row">
        <button className="control-button main" title={playing ? 'Pause' : 'Play'} onClick={togglePlayback}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>
        {[-600, -300, -60, -30, -10].map(seconds => <button className="control-button seek-control" key={seconds} title={`Rewind ${Math.abs(seconds)} seconds`} onClick={() => seekBy(seconds)}><Rewind size={13}/><span>{Math.abs(seconds) >= 60 ? `${Math.abs(seconds) / 60}m` : `${Math.abs(seconds)}s`}</span></button>)}
        {[10, 30, 60].map(seconds => <button className="control-button seek-control forward" key={seconds} title={`Forward ${seconds} seconds`} onClick={() => seekBy(seconds)}><span>+{seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`}</span></button>)}
        <button className="button live-button" onClick={jumpLive}><Radio size={14}/>Jump to Live</button>
        <select className="speed-select" aria-label="Playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {[0.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}
        </select>
        <button className="control-button" title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button>
        <input className="volume-slider" aria-label="Playback volume" type="range" min="0" max="1" step="0.02" value={volume} onChange={event => setVolume(Number(event.target.value))}/>
        <button className="control-button" title="Full screen" onClick={() => void frame.current?.requestFullscreen()}><Maximize size={15}/></button>
      </div>
      <div className="timeline-labels"><span>BUFFER + {clock(clockState.current - clockState.start)}</span><span>{clock(range)} available · {bufferMinutes} min max</span><span>{isLive ? 'At live edge' : `${clock(delay)} behind live`}</span></div>
      <input className="timeshift-range" aria-label="Time-shift timeline" type="range" min="0" max="100" step="0.05" value={progress} onChange={event => seekTo(Number(event.target.value))} disabled={!range}/>
      <div className="timeline-meta"><span>BUFFER START</span><span>{clock(range)} WINDOW</span><span>RECORDING LIVE EDGE</span></div>
      {error && <div className="player-inline-error">{error}</div>}
    </div>
  </section>
}
