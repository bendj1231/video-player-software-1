import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Play, Pause, RotateCcw, RotateCw, Download, AlertCircle, Film, Maximize, Minimize, ChevronUp } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getVideoPreview } from '../lib/zip';
import { needsTranscoding, transcodeVideo, getVideoFormat } from '../lib/ffmpeg';

export function VideoPlayerModal({ 
  zipBlob, 
  videoId,
  videoName,
  onClose, 
  isMuted = true,
  blurEnabled = false,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false
}: { 
  zipBlob: Blob | null, 
  videoId?: string,
  videoName?: string,
  onClose: () => void,
  isMuted?: boolean,
  blurEnabled?: boolean,
  onNext?: () => void,
  onPrevious?: () => void,
  hasNext?: boolean,
  hasPrevious?: boolean
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcodingProgress, setTranscodingProgress] = useState(0);
  const [isTranscoding, setIsTranscoding] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExpandHint, setShowExpandHint] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Hide expand hint after 3 seconds
  useEffect(() => {
    if (showExpandHint) {
      const timer = setTimeout(() => setShowExpandHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showExpandHint]);

  useEffect(() => {
    let cleanupFn: (() => void) | null = null;

    async function loadVideo() {
      if (!zipBlob) {
        console.log('No zipBlob provided');
        return;
      }
      setLoading(true);
      setError(null);
      setVideoError(null);
      setVideoType(zipBlob.type);
      console.log('Video MIME type:', zipBlob.type);
      
      try {
        console.log('Video MIME type:', zipBlob.type, 'Size:', zipBlob.size);
        
        // Use videoName for filename-based detection
        const filename = videoName || '';
        console.log('Video filename:', filename);
        
        // Check if video needs transcoding - use MIME type or filename
        const mimeType = zipBlob.type || '';
        let needsTranscode = needsTranscoding(mimeType);
        
        // Also check filename extension if MIME type is generic or missing
        if (!needsTranscode && filename) {
          const lowerName = filename.toLowerCase();
          console.log('Checking filename for transcoding:', lowerName, 'ends with .avi:', lowerName.endsWith('.avi'));
          if (lowerName.endsWith('.avi') || lowerName.endsWith('.mkv') || lowerName.endsWith('.wmv') || lowerName.endsWith('.flv')) {
            needsTranscode = true;
            console.log('Detected need for transcoding from filename:', filename);
          }
        }
        
        console.log('Needs transcoding:', needsTranscode);
        
        if (needsTranscode) {
          // Check if SharedArrayBuffer is available for FFmpeg
          const hasSharedArrayBuffer = (() => {
            try {
              new SharedArrayBuffer(1);
              return true;
            } catch {
              return false;
            }
          })();
          
          if (!hasSharedArrayBuffer) {
            console.log('SharedArrayBuffer not available, showing download option');
            setError('This video format requires transcoding to play in the browser. Your browser does not support the required features. Please download to play locally.');
          } else {
            console.log('Video needs transcoding, starting FFmpeg...');
            setIsTranscoding(true);
            setTranscodingProgress(0);
            
            const format = getVideoFormat(zipBlob.type, videoName);
            console.log('Transcoding format:', format);
            const transcodedBlob = await transcodeVideo(
              zipBlob, 
              format,
              ({ progress }) => setTranscodingProgress(progress)
            );
            
            setIsTranscoding(false);
            
            if (transcodedBlob) {
              console.log('Transcoding complete, loading video...');
              const result = await getVideoPreview(transcodedBlob);
              if (result) {
                setVideoUrl(result.url);
                cleanupFn = result.cleanup;
              }
            } else {
              setError('Transcoding failed. Please download to play locally.');
            }
          }
        } else {
          // Native supported format
          console.log('Loading native video...');
          const result = await getVideoPreview(zipBlob);
          if (result) {
            console.log('Video loaded successfully:', result.url);
            setVideoUrl(result.url);
            cleanupFn = result.cleanup;
          } else {
            console.error('No video found in blob');
            setError("No video file found.");
          }
        }
      } catch (err) {
        console.error('Failed to load video:', err);
        setError("Failed to load video.");
      } finally {
        setLoading(false);
      }
    }

    loadVideo();

    return () => {
      if (cleanupFn) {
        console.log('Cleaning up video URL');
        cleanupFn();
      }
    };
  }, [zipBlob, videoName]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if modal is open (zipBlob exists)
      if (!zipBlob) return;
      
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zipBlob, isPlaying, duration, onClose]);

  // Sync muted state with video element when isMuted prop changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  if (!zipBlob) return null;

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const rewind10Seconds = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    }
  };

  const forward10Seconds = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
    }
  };

  const handlePrevious = () => {
    if (onPrevious && hasPrevious) {
      onPrevious();
    }
  };

  const handleNext = () => {
    if (onNext && hasNext) {
      onNext();
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      
      // Save watch progress to localStorage
      if (videoId && duration > 0) {
        const progress = (videoRef.current.currentTime / duration) * 100;
        saveWatchProgress(videoId, progress);
      }
    }
  };

  const saveWatchProgress = (id: string, progress: number) => {
    const stored = localStorage.getItem('watchHistory');
    const history: any[] = stored ? JSON.parse(stored) : [];
    
    // Find existing entry or create new one
    const existingIndex = history.findIndex(h => h.videoId === id);
    const entry = {
      videoId: id,
      name: 'Video', // Will be updated from component
      folderId: '',
      folderName: '',
      progress: Math.min(progress, 95), // Cap at 95% so it stays in continue watching
      lastWatched: Date.now()
    };
    
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], ...entry };
    } else {
      history.unshift(entry);
    }
    
    // Keep only last 20 entries
    localStorage.setItem('watchHistory', JSON.stringify(history.slice(0, 20)));
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsPlaying(true);
    }
  };

  const handleVideoError = () => {
    // Check if it's an unsupported format using filename
    const lowerName = (videoName || '').toLowerCase();
    const isAVI = lowerName.endsWith('.avi');
    const isMKV = lowerName.endsWith('.mkv');
    
    if (isAVI) {
      setVideoError('AVI files are not supported in browsers. Please download to play locally with VLC or another video player.');
    } else if (isMKV) {
      setVideoError('MKV files may not play in all browsers. If this doesn\'t work, please download to play locally.');
    } else {
      setVideoError('This video format is not supported in your browser. Please download to play locally.');
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleDownload = () => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video.${videoType.includes('avi') ? 'avi' : 'mp4'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInVLC = () => {
    if (!zipBlob) return;
    // Create a temporary URL and try to open in VLC
    // VLC protocol: vlc://<url> or vlc://open?<url>
    const url = URL.createObjectURL(zipBlob);
    const vlcUrl = `vlc://${url}`;
    
    // Try to open VLC
    window.location.href = vlcUrl;
    
    // Fallback: show message after short delay
    setTimeout(() => {
      alert('If VLC did not open automatically, please download the file and open it manually in VLC.');
    }, 500);
    
    // Clean up the blob URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setShowExpandHint(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed z-[100] bg-black flex flex-col transition-all duration-300 ${
          isFullscreen 
            ? 'inset-0' 
            : 'inset-8 md:inset-16 lg:inset-24 rounded-2xl overflow-hidden shadow-2xl border border-white/10'
        }`}
      >
        {/* Header Controls */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-3">
            {videoId && (
              <span className="text-white/60 text-sm font-medium">Now Playing</span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Expand/Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-3 min-w-[44px] min-h-[44px] glass-button text-white rounded-full transition-transform active:scale-95 touch-manipulation"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
            </button>
            
            <button
              onClick={onClose}
              className="p-3 min-w-[44px] min-h-[44px] glass-button text-white rounded-full transition-transform active:scale-95 touch-manipulation"
              aria-label="Close video player"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Expand Hint (shown briefly in popup mode) */}
        {!isFullscreen && showExpandHint && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/20"
          >
            <div className="flex items-center gap-2 text-white/80 text-sm">
              <ChevronUp size={16} />
              <span>Click expand for fullscreen</span>
            </div>
          </motion.div>
        )}

        {isTranscoding && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-white/70 px-8">
            <Film size={48} className="text-emerald-400" />
            <p className="text-lg">Converting video for playback...</p>
            <div className="w-full max-w-md bg-white/20 rounded-full h-2 mt-2">
              <div 
                className="bg-emerald-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${transcodingProgress}%` }}
              />
            </div>
            <p className="text-sm text-white/50">{transcodingProgress}%</p>
            <p className="text-xs text-white/40">This may take a moment for large files</p>
          </div>
        )}

        {!isTranscoding && loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-white/70">
            <Loader2 size={48} className="animate-spin" />
            <p className="text-lg">Extracting high-quality video...</p>
          </div>
        )}

        {videoError && (
          <div className="flex-1 flex flex-col items-center justify-center text-amber-300 p-6">
            <div className="bg-amber-500/10 rounded-2xl border border-amber-500/20 backdrop-blur-md max-w-md text-center p-8">
              <AlertCircle size={48} className="mx-auto mb-4 text-amber-400" />
              <p className="mb-4">{videoError}</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleOpenInVLC}
                  className="flex items-center gap-2 mx-auto px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-full transition-colors"
                >
                  <Play size={20} />
                  Open in VLC
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 mx-auto px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-full transition-colors"
                >
                  <Download size={20} />
                  Download Video
                </button>
              </div>
            </div>
          </div>
        )}

        {videoUrl && (
          <div className="flex-1 w-full h-full flex flex-col">
            <video
              ref={videoRef}
              src={videoUrl}
              className={`flex-1 w-full h-full object-contain bg-black ${blurEnabled ? 'blur-[20px]' : ''}`}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
              onError={handleVideoError}
              autoPlay
              muted={isMuted}
              playsInline
              preload="metadata"
              controls={false}
            />
            
            {/* Long Rectangular Controls Bar */}
            <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-16 pb-6 px-4">
              {/* Progress Bar - Full Width */}
              <div className="flex items-center gap-3 mb-4 max-w-4xl mx-auto">
                <span className="text-white/80 text-sm font-medium min-w-[50px]">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="flex-1 h-3 bg-white/30 rounded-full appearance-none cursor-pointer touch-manipulation [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                  aria-label="Video progress"
                />
                <span className="text-white/80 text-sm font-medium min-w-[50px] text-right">{formatTime(duration)}</span>
              </div>
              
              {/* Controls Row */}
              <div className="flex items-center justify-center gap-8 max-w-4xl mx-auto">
                {/* Previous Video */}
                <button
                  onClick={handlePrevious}
                  disabled={!hasPrevious}
                  className={`p-4 min-w-[48px] min-h-[48px] rounded-xl transition-all touch-manipulation active:scale-95 ${hasPrevious ? 'text-white active:bg-white/20' : 'text-white/30 cursor-not-allowed'}`}
                  title="Previous video"
                  aria-label="Previous video"
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                  </svg>
                </button>

                {/* Back 10 Seconds */}
                <button
                  onClick={rewind10Seconds}
                  className="p-4 min-w-[48px] min-h-[48px] rounded-xl text-white transition-all touch-manipulation active:scale-95 active:bg-white/20"
                  title="Back 10 seconds"
                  aria-label="Back 10 seconds"
                >
                  <RotateCcw size={26} />
                </button>
                
                {/* Play/Pause - Larger */}
                <button
                  onClick={togglePlay}
                  className="px-10 py-4 min-w-[120px] min-h-[56px] bg-white/20 active:bg-white/30 rounded-xl text-white active:scale-95 transition-all touch-manipulation"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  <div className="flex items-center gap-2">
                    {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
                    <span className="text-sm font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
                  </div>
                </button>
                
                {/* Forward 10 Seconds */}
                <button
                  onClick={forward10Seconds}
                  className="p-4 min-w-[48px] min-h-[48px] rounded-xl text-white transition-all touch-manipulation active:scale-95 active:bg-white/20"
                  title="Forward 10 seconds"
                  aria-label="Forward 10 seconds"
                >
                  <RotateCw size={26} />
                </button>

                {/* Next Video */}
                <button
                  onClick={handleNext}
                  disabled={!hasNext}
                  className={`p-4 min-w-[48px] min-h-[48px] rounded-xl transition-all touch-manipulation active:scale-95 ${hasNext ? 'text-white active:bg-white/20' : 'text-white/30 cursor-not-allowed'}`}
                  title="Next video"
                  aria-label="Next video"
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
