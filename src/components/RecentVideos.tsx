import { useState, useEffect } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { Play, Clock } from 'lucide-react';
import { extractVideoFromZip } from '../lib/zip';

interface RecentVideosProps {
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  limit?: number;
  blurEnabled?: boolean;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
  cleanup?: () => void;
}

export function RecentVideos({ onPlayVideo, limit = 8, blurEnabled = false }: RecentVideosProps) {
  const [recentVideos, setRecentVideos] = useState<VideoWithPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadRecent() {
      setIsLoading(true);
      try {
        const folders = await getFolders();
        let allVideos: VideoZip[] = [];
        for (const folder of folders) {
          const vids = await getVideosByFolder(folder.id);
          allVideos = allVideos.concat(vids);
        }
        allVideos.sort((a, b) => b.createdAt - a.createdAt);
        const limited = allVideos.slice(0, limit);
        
        const withPreviews = await Promise.all(
          limited.map(async (video) => {
            const result = await extractVideoFromZip(video.file);
            return {
              ...video,
              previewUrl: result?.url,
              cleanup: result?.cleanup
            };
          })
        );
        
        setRecentVideos(withPreviews);
      } finally {
        setIsLoading(false);
      }
    }
    loadRecent();
    
    return () => {
      recentVideos.forEach(v => v.cleanup?.());
    };
  }, [limit]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse flex space-x-4">
          <div className="w-64 h-36 bg-white/10 rounded-2xl"></div>
          <div className="w-64 h-36 bg-white/10 rounded-2xl"></div>
          <div className="w-64 h-36 bg-white/10 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  if (recentVideos.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-20 text-zinc-400 glass-card rounded-[2rem]">
        <Clock size={48} className="mb-4 opacity-40" />
        <p className="text-lg">No recent videos. Go to Galleries to upload some.</p>
      </div>
    );
  }

  return (
    <div className={`flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory hide-scrollbar transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
      {recentVideos.map(video => (
        <div 
          key={video.id} 
          className="snap-center shrink-0 w-[85vw] sm:w-[400px] group glass-card rounded-[2rem] overflow-hidden aspect-video flex flex-col transition-all hover:scale-[1.02] hover:shadow-2xl"
          onClick={() => onPlayVideo(video.file, video.id, video.name)}
        >
          <div className="flex-1 relative bg-black">
            {video.previewUrl ? (
              <video
                src={video.previewUrl}
                className="w-full h-full object-cover"
                muted
                loop
                autoPlay
                playsInline
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-zinc-800/50 to-black/50 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
              </div>
            )}
            
            <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 transition-all" />
            
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-16 h-16 glass-button rounded-full flex items-center justify-center transition-all group-hover:scale-110 group-hover:bg-white/20">
                <Play size={28} className="text-white ml-1" />
              </div>
            </div>
          </div>
          
          {/* Title beneath video - only on hover */}
          <div className="p-5 bg-black/60 backdrop-blur-xl border-t border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <span className="text-white font-medium truncate pr-4 text-lg">{video.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
