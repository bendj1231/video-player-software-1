import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Play, Pause, RotateCcw, RotateCw, AlertCircle, Film, Maximize, Minimize } from 'lucide-react';
import { getVideoPreview } from '../lib/zip';
import { isElectron, transcodeForPlayback, onTranscodeDone, relPathFromMediaUrl, openInVlc } from '../lib/electronStorage';
import { VlcCanvas } from './VlcCanvas';

export function VideoPlayerModal({
  zipBlob,
  directUrl,
  videoId,
  videoName,
  onClose,
  isMuted = true,
  blurEnabled = false,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
  queue
}: {
  zipBlob: Blob | null,
  directUrl?: string,
  videoId?: string,
  videoName?: string,
  onClose: () => void,
  isMuted?: boolean,
  blurEnabled?: boolean,
  onNext?: () => void,
  onPrevious?: () => void,
  hasNext?: boolean,
  hasPrevious?: boolean,
  queue?: { url: string; name: string }[],
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useVlcEngine, setUseVlcEngine] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const [sideVideos, setSideVideos] = useState<{ url: string; name: string; side: 'left' | 'right' }[]>([]);
  const [showControls, setShowControls] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // controls reveal only when mouse dips near bottom edge of screen
  const onPlayerMouseMove = (e: React.MouseEvent) => {
    if (e.clientY > window.innerHeight - 130) {
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowControls(false), 2500);
    } else if (showControls) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowControls(false), 400);
    }
  };

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    async function load() {
      if (directUrl) {
        setVideoUrl(directUrl);
        setVideoError(null);
        setUseVlcEngine(false);
        setSideVideos([]);
        return;
      }
      if (!zipBlob) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getVideoPreview(zipBlob);
        if (result) setVideoUrl(result.url);
        else setError('No video found');
      } catch { setError('Failed to load video'); }
      setLoading(false);
    }
    load();
    return () => cleanup?.();
  }, [zipBlob, directUrl]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    setIsPlaying(true);
    const { videoWidth, videoHeight } = videoRef.current;
    if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
  };

  const handleVideoError = async () => {
    if (directUrl && isElectron()) {
      const relPath = relPathFromMediaUrl(directUrl);
      if (!relPath) { setVideoError('This video format is not supported.'); return; }
      // try embedded VLC engine first — decodes anything libVLC plays
      setVideoError(null);
      setUseVlcEngine(true);
      return;
    }
    setVideoError('This video format is not supported in the browser.');
  };

  const handleOpenInVLC = async () => {
    if (directUrl && isElectron()) {
      const relPath = relPathFromMediaUrl(directUrl);
      if (relPath) {
        const r = await openInVlc(relPath);
        if (!r?.success) alert(r?.error || 'Could not open in VLC');
        return;
      }
    }
    alert('Please download the file and open it manually in VLC.');
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (videoRef.current) { videoRef.current.currentTime = t; setCurrentTime(t); }
  };
  const handleTimeUpdate = () => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); };
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause(); else videoRef.current.play().catch(() => {});
    setIsPlaying(!isPlaying);
  };
  const rewind10 = () => { if (videoRef.current) videoRef.current.currentTime -= 10; };
  const forward10 = () => { if (videoRef.current) videoRef.current.currentTime += 10; };
  const toggleFullscreen = () => setIsFullscreen(f => !f);
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const relPath = directUrl ? relPathFromMediaUrl(directUrl) : null;

  // nothing to play → render nothing (no phantom player on launch)
  if (!zipBlob && !directUrl) return null;

  return (
    <AnimatePresence>
      {/* blurred full-screen backdrop — click to close */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-2xl flex items-center justify-center"
        onClick={onClose}
        onMouseMove={onPlayerMouseMove}
      >
        <div className="flex flex-col items-center justify-center gap-2 max-h-full">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            style={isFullscreen ? undefined : { aspectRatio: String(aspect), width: `min(92vw, ${Math.round(85 * aspect)}vh)`, maxHeight: '85vh' }}
            className={`bg-black/95 flex flex-col relative transition-all duration-300 ${
              isFullscreen ? 'fixed inset-0 z-[100]' : 'rounded-2xl overflow-hidden shadow-2xl border border-white/10'
            }`}
          >
            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 text-white/70">
                <Loader2 size={48} className="animate-spin" />
                <p className="text-lg">Loading video...</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex-1 flex items-center justify-center text-red-300 p-6">
                <AlertCircle size={40} className="mr-3" /> {error}
              </div>
            )}

            {videoError && (
              <div className="flex-1 flex flex-col items-center justify-center text-amber-300 p-6">
                <div className="bg-amber-500/10 rounded-2xl border border-amber-500/20 backdrop-blur-md max-w-md text-center p-8">
                  <AlertCircle size={48} className="mx-auto mb-4 text-amber-400" />
                  <p className="mb-4">{videoError}</p>
                  <button
                    onClick={handleOpenInVLC}
                    className="flex items-center gap-2 mx-auto px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-full transition-colors"
                  >
                    <Play size={20} /> Open in VLC
                  </button>
                </div>
              </div>
            )}

            {videoUrl && useVlcEngine && relPath && (
              <div className="flex-1 w-full h-full flex flex-col relative">
                <VlcCanvas
                  relPath={relPath}
                  className="flex-1 w-full"
                  onFail={async (err) => {
                    const vlc = await openInVlc(relPath);
                    if (vlc?.success) setVideoError(`Couldn't decode in-app (${err}) — opened it in VLC.`);
                    else setVideoError(`Couldn't decode this video (${err}).`);
                    setUseVlcEngine(false);
                  }}
                />
              </div>
            )}

            {videoUrl && !useVlcEngine && (
              <div className="flex-1 w-full h-full flex items-center justify-center relative min-h-0">
                {sideVideos.filter(s => s.side === 'left').map(s => (
                  <video key={s.url} src={s.url} autoPlay muted={isMuted} loop playsInline
                    onClick={() => setSideVideos(v => v.filter(x => x.url !== s.url))}
                    title={`${s.name} — click to remove`}
                    className="max-h-full w-auto h-full object-contain rounded-lg shadow-2xl cursor-pointer" />
                ))}
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className={`max-w-full max-h-full w-auto h-auto object-contain rounded-lg shadow-2xl ${blurEnabled ? 'blur-[20px]' : ''}`}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onCanPlay={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.play().catch(() => {
                      // autoplay-with-sound blocked → mute once and retry
                      v.muted = true;
                      v.play().catch(() => {});
                    });
                  }}
                  onEnded={() => setIsPlaying(false)}
                  onError={handleVideoError}
                  loop
                  autoPlay
                  muted={isMuted}
                  playsInline
                  preload="metadata"
                  controls={false}
                />
                {sideVideos.filter(s => s.side === 'right').map(s => (
                  <video key={s.url} src={s.url} autoPlay muted={isMuted} loop playsInline
                    onClick={() => setSideVideos(v => v.filter(x => x.url !== s.url))}
                    title={`${s.name} — click to remove`}
                    className="max-h-full w-auto h-full object-contain rounded-lg shadow-2xl cursor-pointer" />
                ))}
              </div>
            )}
          </motion.div>

          {/* hidden controls strip — floats BELOW the video box, revealed at bottom edge */}
          <div
            className={`absolute inset-x-0 bottom-6 z-20 flex justify-center transition-all duration-300 pointer-events-none ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-3 pb-4 w-full max-w-2xl pointer-events-auto">
              <div className="flex items-center gap-3 mb-4 max-w-4xl mx-auto">
                <span className="text-white/80 text-sm font-medium min-w-[50px]">{formatTime(currentTime)}</span>
                <input
                  type="range" min={0} max={duration || 100} value={currentTime} onChange={handleSeek}
                  className="flex-1 h-3 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  aria-label="Video progress"
                />
                <span className="text-white/80 text-sm font-medium min-w-[50px] text-right">{formatTime(duration)}</span>
              </div>
              <div className="flex items-center justify-center gap-6 max-w-4xl mx-auto">
                <button onClick={onPrevious} disabled={!hasPrevious}
                  className={`p-3 rounded-xl transition-all active:scale-95 ${hasPrevious ? 'text-white hover:bg-white/20' : 'text-white/30 cursor-not-allowed'}`}
                  title="Previous video" aria-label="Previous video">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button onClick={rewind10} className="p-3 rounded-xl text-white transition-all hover:bg-white/20 active:scale-95" title="Back 10 seconds">
                  <RotateCcw size={24} />
                </button>
                <button onClick={togglePlay} className="px-8 py-3 min-w-[110px] bg-white/20 hover:bg-white/30 rounded-xl text-white active:scale-95 transition-all">
                  <div className="flex items-center gap-2">
                    {isPlaying ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
                    <span className="text-sm font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
                  </div>
                </button>
                <button onClick={forward10} className="p-3 rounded-xl text-white transition-all hover:bg-white/20 active:scale-95" title="Forward 10 seconds">
                  <RotateCw size={24} />
                </button>
                <button onClick={onNext} disabled={!hasNext}
                  className={`p-3 rounded-xl transition-all active:scale-95 ${hasNext ? 'text-white hover:bg-white/20' : 'text-white/30 cursor-not-allowed'}`}
                  title="Next video" aria-label="Next video">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                </button>
                <button onClick={toggleFullscreen} className="p-3 text-white rounded-full hover:bg-white/20 transition-all active:scale-95"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
                <button onClick={onClose} className="p-3 text-white rounded-full hover:bg-white/20 transition-all active:scale-95" aria-label="Close video player">
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* edge "+" zones — hover the left/right backdrop to add a sibling video */}
        {queue && videoUrl && !useVlcEngine && sideVideos.length < 2 && (() => {
          const siblings = queue.filter(q => q.url !== directUrl && !sideVideos.some(s => s.url === q.url));
          if (!siblings.length) return null;
          const add = (side: 'left' | 'right') => setSideVideos(v => [...v, { ...siblings[0], side }]);
          return (
            <>
              <div
                className="group absolute left-0 top-0 bottom-0 w-28 flex items-center justify-start pl-4"
                onClick={(e) => e.stopPropagation()}
              >
                <button onClick={() => add('left')} title="Add a video on the left"
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/25 text-white text-2xl opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25">
                  +
                </button>
              </div>
              <div
                className="group absolute right-0 top-0 bottom-0 w-28 flex items-center justify-end pr-4"
                onClick={(e) => e.stopPropagation()}
              >
                <button onClick={() => add('right')} title="Add a video on the right"
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/25 text-white text-2xl opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25">
                  +
                </button>
              </div>
            </>
          );
        })()}
      </motion.div>
    </AnimatePresence>
  );
}
