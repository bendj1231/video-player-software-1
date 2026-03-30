import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Trash2, Play, Pause, RotateCcw, Download, AlertCircle, Film } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getVideoPreview } from '../lib/zip';
import { needsTranscoding, transcodeVideo, getVideoFormat } from '../lib/ffmpeg';

export function VideoPlayerModal({ 
  zipBlob, 
  videoId,
  onClose, 
  onDelete,
  isMuted = true,
  blurEnabled = false
}: { 
  zipBlob: Blob | null, 
  videoId?: string,
  onClose: () => void,
  onDelete?: (id: string) => void,
  isMuted?: boolean,
  blurEnabled?: boolean
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
  const videoRef = useRef<HTMLVideoElement>(null);

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
        // Check if video needs transcoding (AVI, MKV, etc.)
        if (needsTranscoding(zipBlob.type)) {
          console.log('Video needs transcoding, starting FFmpeg...');
          setIsTranscoding(true);
          setTranscodingProgress(0);
          
          const format = getVideoFormat(zipBlob.type);
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
            setError('Failed to transcode video. Please download to play locally.');
          }
        } else {
          // Native supported format
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
  }, [zipBlob]);

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

  if (!zipBlob) return null;

  const handleDelete = () => {
    if (videoId && onDelete && confirm('Delete this video from local storage after viewing?')) {
      onDelete(videoId);
      onClose();
    }
  };

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
    // Check if it's an unsupported format
    const isAVI = videoType === 'video/x-msvideo' || videoType.includes('avi');
    const isMKV = videoType === 'video/x-matroska' || videoType.includes('mkv');
    
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
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-2xl p-4 md:p-12"
      >
        <div className="relative w-full max-w-6xl aspect-video glass-card rounded-[2rem] overflow-hidden flex items-center justify-center">
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-10 glass-button text-white p-3 rounded-full transition-transform hover:scale-110"
          >
            <X size={24} />
          </button>

          {videoUrl && videoId && onDelete && (
            <button
              onClick={handleDelete}
              className="absolute top-6 right-20 z-10 bg-red-500/30 hover:bg-red-500/50 text-red-200 p-3 rounded-full transition-all hover:scale-110 flex items-center gap-2"
            >
              <Trash2 size={20} />
              <span className="hidden sm:inline text-sm font-medium">Delete After Viewing</span>
            </button>
          )}

          {isTranscoding && (
            <div className="flex flex-col items-center gap-4 text-white/70 max-w-md w-full px-8">
              <Film size={48} className="text-emerald-400" />
              <p className="text-lg">Converting video for playback...</p>
              <div className="w-full bg-white/20 rounded-full h-2 mt-2">
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
            <div className="flex flex-col items-center gap-6 text-white/70">
              <Loader2 size={48} className="animate-spin" />
              <p className="text-lg">Extracting high-quality video...</p>
            </div>
          )}

          {videoError && (
            <div className="text-amber-300 p-6 bg-amber-500/10 rounded-2xl border border-amber-500/20 backdrop-blur-md max-w-md text-center">
              <AlertCircle size={48} className="mx-auto mb-4 text-amber-400" />
              <p className="mb-4">{videoError}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 mx-auto px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-full transition-colors"
              >
                <Download size={20} />
                Download Video
              </button>
            </div>
          )}

          {videoUrl && (
            <div className="w-full h-full flex flex-col">
              <video
                ref={videoRef}
                src={videoUrl}
                className={`flex-1 w-full h-full object-contain bg-black/40 ${blurEnabled ? 'blur-[20px]' : ''}`}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onError={handleVideoError}
                autoPlay
                muted={isMuted}
              />
              
              {/* Custom Controls Bar */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6">
                {/* Progress Bar */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-white/80 text-sm font-medium">{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 h-1.5 bg-white/30 rounded-full appearance-none cursor-pointer hover:bg-white/50 transition-colors [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <span className="text-white/80 text-sm font-medium">{formatTime(duration)}</span>
                </div>
                
                {/* Control Buttons */}
                <div className="flex items-center justify-center gap-6">
                  <button
                    onClick={rewind10Seconds}
                    className="p-3 glass-button rounded-full text-white hover:scale-110 transition-transform"
                    title="Rewind 10 seconds"
                  >
                    <RotateCcw size={24} />
                  </button>
                  
                  <button
                    onClick={togglePlay}
                    className="p-4 glass-button rounded-full text-white hover:scale-110 transition-transform"
                  >
                    {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
