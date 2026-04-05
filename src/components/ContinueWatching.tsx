import React, { useState, useEffect, useRef } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { Play, Trash2 } from 'lucide-react';
import { getVideoPreview } from '../lib/zip';
import { clsx } from 'clsx';

interface ContinueWatchingProps {
  onPlayVideo: (blob: Blob, videoId: string) => void;
  blurEnabled?: boolean;
}

interface WatchProgress {
  videoId: string;
  name: string;
  folderId: string;
  folderName: string;
  progress: number; // percentage 0-100
  lastWatched: number; // timestamp
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
  cleanup?: () => void;
  folderName?: string;
}

export function ContinueWatching({ onPlayVideo, blurEnabled }: ContinueWatchingProps) {
  const [watchHistory, setWatchHistory] = useState<WatchProgress[]>([]);
  const [videosWithPreviews, setVideosWithPreviews] = useState<VideoWithPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadWatchHistory();
  }, []);

  useEffect(() => {
    if (watchHistory.length > 0) {
      loadVideoPreviews();
    } else {
      setIsLoading(false);
    }
    
    return () => {
      videosWithPreviews.forEach(v => v.cleanup?.());
    };
  }, [watchHistory]);

  async function loadWatchHistory() {
    // Load from localStorage
    const stored = localStorage.getItem('watchHistory');
    if (stored) {
      const history: WatchProgress[] = JSON.parse(stored);
      // Sort by last watched (most recent first)
      history.sort((a, b) => b.lastWatched - a.lastWatched);
      setWatchHistory(history.slice(0, 8)); // Show up to 8 videos
    }
    setIsLoading(false);
  }

  async function loadVideoPreviews() {
    const folders = await getFolders();
    const folderMap = new Map(folders.map(f => [f.id, f.name]));
    
    let allVideos: VideoZip[] = [];
    for (const folder of folders) {
      const vids = await getVideosByFolder(folder.id);
      allVideos = allVideos.concat(vids.map(v => ({ ...v, folderId: folder.id, folderName: folder.name })));
    }

    // Filter videos that are in watch history
    const historyIds = new Set(watchHistory.map(h => h.videoId));
    const historyVideos = allVideos.filter(v => historyIds.has(v.id));
    
    // Sort by watch history order
    const sortedVideos = historyVideos.sort((a, b) => {
      const aIndex = watchHistory.findIndex(h => h.videoId === a.id);
      const bIndex = watchHistory.findIndex(h => h.videoId === b.id);
      return aIndex - bIndex;
    });

    const withPreviews = await Promise.all(
      sortedVideos.map(async (video) => {
        const result = await getVideoPreview(video.file, video.name);
        const historyItem = watchHistory.find(h => h.videoId === video.id);
        return {
          ...video,
          previewUrl: result?.url,
          cleanup: result?.cleanup,
          folderName: historyItem?.folderName || folderMap.get(video.folderId) || 'Unknown'
        };
      })
    );
    
    setVideosWithPreviews(withPreviews);
  }

  const removeFromHistory = (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = watchHistory.filter(h => h.videoId !== videoId);
    setWatchHistory(updated);
    localStorage.setItem('watchHistory', JSON.stringify(updated));
    
    // Also update videos list
    setVideosWithPreviews(prev => prev.filter(v => v.id !== videoId));
  };

  const getProgress = (videoId: string) => {
    const item = watchHistory.find(h => h.videoId === videoId);
    return item?.progress || 0;
  };

  if (isLoading) {
    return (
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-white mb-6 tracking-tight">Continue Watching</h2>
        <div className="flex gap-6 overflow-x-auto pb-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="shrink-0 w-80 aspect-video bg-white/10 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (watchHistory.length === 0) {
    return null;
  }

  return (
    <div className={`mb-12 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
      <h2 className="text-2xl font-semibold text-white mb-6 tracking-tight">Continue Watching</h2>
      
      <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory hide-scrollbar">
        {videosWithPreviews.map((video, index) => {
          const isFourth = index === 3; // 4th video (0-indexed)
          const progress = getProgress(video.id);
          
          return (
            <div
              key={video.id}
              className={clsx(
                "relative shrink-0 snap-start cursor-pointer transition-all duration-300 group",
                isFourth ? "w-[500px] scale-105 z-10" : "w-80 hover:scale-[1.02]"
              )}
              onClick={() => onPlayVideo(video.file, video.id)}
            >
              <div className={clsx(
                "relative aspect-video rounded-2xl overflow-hidden glass-card",
                isFourth && "ring-4 ring-amber-500/50 shadow-2xl shadow-amber-500/20"
              )}>
                {/* Video Preview */}
                {video.previewUrl ? (
                  <video
                    src={video.previewUrl}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    autoPlay={isFourth} // Auto play the 4th video preview
                    playsInline
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-800/50 to-black/50 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                )}
                
                {/* Dark overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                
                {/* Play button */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className={clsx(
                    "glass-button rounded-full flex items-center justify-center",
                    isFourth ? "w-20 h-20" : "w-16 h-16"
                  )}>
                    <Play size={isFourth ? 32 : 24} className="text-white ml-1" />
                  </div>
                </div>
                
                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <div 
                    className="h-full bg-amber-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                
                {/* Remove button */}
                <button
                  onClick={(e) => removeFromHistory(video.id, e)}
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white/70 hover:text-red-400 hover:bg-red-500/20 transition-all opacity-0 hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              
              {/* Video info - beneath video, only on hover */}
              <div className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <h3 className={clsx(
                  "font-semibold text-white truncate",
                  isFourth ? "text-xl" : "text-base"
                )}>
                  {video.name}
                </h3>
                <p className="text-white/70 text-sm mt-1">{video.folderName}</p>
                <p className="text-amber-400 text-xs mt-1 font-medium">
                  {progress > 0 ? `${Math.round(progress)}% watched` : 'Start watching'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
