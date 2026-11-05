import { useEffect, useRef, useState } from 'react'
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { mediaUrl } from './api'

export default function VideoPreview({ src, className = '' }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [volume, setVolume] = useState(0.8)
  useEffect(() => {
    let hls: { destroy: () => void; loadSource: (source: string) => void; attachMedia: (media: HTMLMediaElement) => void } | undefined
    let disposed = false
    const attach = async () => {
      const video = ref.current
      if (!video) return
      video.volume = volume
      const { default: Hls } = await import('hls.js')
      if (disposed) return
      const url = mediaUrl(src)
      if (Hls.isSupported()) {
        hls = new Hls({ liveSyncDurationCount: 3, enableWorker: true })
        hls.loadSource(url); hls.attachMedia(video)
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url
    }
    void attach()
    return () => { disposed = true; hls?.destroy() }
  }, [src])
  return <div className={`video-preview ${className}`}>
    <video ref={ref} autoPlay muted={muted} playsInline controls={false} />
    <div className="video-controls">
      <button title={playing ? 'Pause' : 'Play'} onClick={() => { if (playing) ref.current?.pause(); else void ref.current?.play(); setPlaying(!playing) }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
      <button title={muted ? 'Enable audio' : 'Mute'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={14}/> : <Volume2 size={14}/>}</button>
      <input title="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);if(ref.current)ref.current.volume=v;setMuted(v===0)}}/>
      <button title="Full screen" onClick={() => ref.current?.requestFullscreen()}><Maximize2 size={14}/></button>
    </div>
  </div>
}
