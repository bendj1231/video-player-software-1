import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Trash2, Play, Pause, RotateCcw } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getVideoPreview } from '../lib/zip';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
      try {
        console.log('Loading video from blob:', zipBlob.type, zipBlob.size);
        const result = await getVideoPreview(zipBlob);
        if (result) {
          console.log('Video loaded successfully:', result.url);
          setVideoUrl(result.url);
          cleanupFn = result.cleanup;
        } else {
          console.error('No video found in blob');
          setError("No video file found.");
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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
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

          {loading && (
            <div className="flex flex-col items-center gap-6 text-white/70">
              <Loader2 size={48} className="animate-spin" />
              <p className="text-lg">Extracting high-quality video...</p>
            </div>
          )}

          {error && (
            <div className="text-red-300 p-6 bg-red-500/10 rounded-2xl border border-red-500/20 backdrop-blur-md">
              {error}
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
