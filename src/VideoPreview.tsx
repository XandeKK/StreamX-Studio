import { useEffect, useRef, useState } from 'react'
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { mediaUrl } from './api'

type Props = { src: string; className?: string; mutedByDefault?: boolean; showControls?: boolean }

export default function VideoPreview({ src, className = '', mutedByDefault = true, showControls = true }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<any>(null)
  const [muted, setMuted] = useState(mutedByDefault)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading')
  const [message, setMessage] = useState('Connecting to live source…')

  useEffect(() => {
    const element = video.current
    if (!element || !src) return
    let disposed = false
    let hls: any
    let networkRetries = 0
    let mediaRetries = 0
    const url = mediaUrl(src)
    setState('loading')
    setMessage('Waiting for the first playable segment…')
    setPlaying(false)
    const onPlaying = () => { if (!disposed) { setState('playing'); setPlaying(true); setMessage('Live preview') } }
    const onWaiting = () => { if (!disposed) { setState('loading'); setPlaying(false); setMessage('Buffering live segments…') } }
    const onVideoError = () => {
      if (!disposed && element.error) {
        setState('error')
        setMessage(element.error.message || `Browser media error ${element.error.code}`)
      }
    }
    element.addEventListener('playing', onPlaying)
    element.addEventListener('waiting', onWaiting)
    element.addEventListener('error', onVideoError)

    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false, liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 8, maxLiveSyncPlaybackRate: 1.4, backBufferLength: 30,
          maxBufferLength: 30, manifestLoadingMaxRetry: 12, manifestLoadingRetryDelay: 700,
          levelLoadingMaxRetry: 12, levelLoadingRetryDelay: 700 })
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
          if (disposed || !data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 6) {
            setMessage('Preview feed is starting; retrying playlist…')
            window.setTimeout(() => !disposed && hls.startLoad(), 700)
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) {
            setMessage('Recovering the media decoder…')
            hls.recoverMediaError()
          } else {
            setState('error')
            setMessage(data.details || data.reason || 'The live preview could not be decoded.')
          }
        })
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void element.play().catch(() => {
            if (!disposed) setMessage('Press Play to begin the live preview.')
          })
        })
        hls.on(Hls.Events.FRAG_LOADED, () => { networkRetries = 0 })
        hls.loadSource(url)
        hls.attachMedia(element)
      } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = url
        void element.play().catch(() => undefined)
      } else {
        setState('error')
        setMessage('This browser does not support HLS playback.')
      }
    }).catch((error: unknown) => {
      if (!disposed) { setState('error'); setMessage(error instanceof Error ? error.message : 'HLS player could not start.') }
    })

    return () => {
      disposed = true
      element.removeEventListener('playing', onPlaying)
      element.removeEventListener('waiting', onWaiting)
      element.removeEventListener('error', onVideoError)
      hls?.destroy()
      if (hlsRef.current === hls) hlsRef.current = null
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [src])

  useEffect(() => { if (video.current) video.current.muted = muted }, [muted])
  useEffect(() => { if (video.current) video.current.volume = volume }, [volume])

  function togglePlay() {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play().catch(error => { setState('error'); setMessage(error.message) })
    else element.pause()
    setPlaying(!element.paused)
  }

  return <div className={`video-preview ${className} ${state === 'error' ? 'preview-error' : ''}`}>
    <video ref={video} autoPlay muted={muted} playsInline controls={false} />
    {state !== 'playing' && <div className={`preview-state ${state}`}>
      {state === 'loading' ? <span className="spinner"/> : <span className="state-mark">!</span>}
      <span>{message}</span>
    </div>}
    {showControls && <div className="video-controls" onClick={event => event.stopPropagation()}>
      <button title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
      <button title={muted ? 'Enable audio' : 'Mute'} onClick={() => { const next = !muted; setMuted(next); if (video.current) video.current.muted = next }}>{muted ? <VolumeX size={14}/> : <Volume2 size={14}/>}</button>
      <input aria-label="Preview volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => {
        const next = Number(event.target.value); setVolume(next)
        if (video.current) video.current.volume = next
      }}/>
      <button title="Full screen" onClick={() => void video.current?.requestFullscreen()}><Maximize size={14}/></button>
    </div>}
  </div>
}
