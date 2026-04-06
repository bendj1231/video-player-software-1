import { useState, useEffect, useRef } from 'react';
import { getFolders, getVideosByFolder, VideoZip } from '../lib/db';
import { getVideoPreview } from '../lib/zip';
import { ChevronRight, Play, Archive, ChevronLeft } from 'lucide-react';

interface FolderDiscoverProps {
  onSelectFolder: (id: string) => void;
  onViewAllContents: (folderId: string, archiveId?: string, archiveName?: string) => void;
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  blurEnabled?: boolean;
  refreshTrigger?: number;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
}

interface ArchiveGroup {
  archiveId: string;
  archiveName: string;
  folderId: string;
  folderName: string;
  videos: VideoWithPreview[];
  photoCount: number;
}

export function FolderDiscover({ onSelectFolder, onViewAllContents, onPlayVideo, blurEnabled, refreshTrigger }: FolderDiscoverProps) {
  const [archiveGroups, setArchiveGroups] = useState<ArchiveGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    loadArchiveGroups();
  }, [refreshTrigger]);

  // Auto-scroll effect
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];
    
    archiveGroups.forEach((group) => {
      const scrollContainer = scrollRefs.current.get(group.archiveId);
      if (scrollContainer) {
        let scrollDirection = 1;
        let isHovered = false;
        
        scrollContainer.addEventListener('mouseenter', () => isHovered = true);
        scrollContainer.addEventListener('mouseleave', () => isHovered = false);
        
        const interval = setInterval(() => {
          if (!isHovered && scrollContainer) {
            const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
            const currentScroll = scrollContainer.scrollLeft;
            
            if (currentScroll >= maxScroll - 10) {
              scrollDirection = -1;
            } else if (currentScroll <= 10) {
              scrollDirection = 1;
            }
            
            scrollContainer.scrollLeft += scrollDirection * 1;
          }
        }, 30);
        
        intervals.push(interval);
      }
    });
    
    return () => intervals.forEach(clearInterval);
  }, [archiveGroups]);

  async function loadArchiveGroups() {
    const allFolders = await getFolders();
    const archiveMap = new Map<string, ArchiveGroup>(); // Use archiveName as key to dedupe
    
    for (const folder of allFolders) {
      const allFiles = await getVideosByFolder(folder.id);
      
      // Group videos by sourceArchiveName (not ID) to merge duplicates
      const groups = new Map<string, VideoWithPreview[]>();
      
      for (const file of allFiles) {
        // Only include media files that came from an extracted archive
        if (!file.sourceArchiveId || !file.sourceArchiveName) continue;
        
        const isVideo = file.file.type?.startsWith('video/') || 
                        file.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i);
        const isPhoto = file.file.type?.startsWith('image/') || 
                        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
        
        if (!isVideo && !isPhoto) continue;
        
        // Group by archive name (without extension) to merge duplicates
        const archiveName = file.sourceArchiveName.replace(/\.[^/.]+$/, '');
        
        if (!groups.has(archiveName)) {
          groups.set(archiveName, []);
        }
        
        // Generate preview for videos
        if (isVideo) {
          const result = await getVideoPreview(file.file, file.name);
          groups.get(archiveName)!.push({ ...file, previewUrl: result?.url });
        } else {
          groups.get(archiveName)!.push({ ...file });
        }
      }
      
      // Create ArchiveGroup entries
      for (const [archiveName, videos] of groups) {
        if (videos.length === 0) continue;
        
        const photoCount = videos.filter(v => 
          v.file.type?.startsWith('image/') || 
          v.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i)
        ).length;
        
        const videoCount = videos.filter(v => 
          v.file.type?.startsWith('video/') || 
          v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
        ).length;
        
        if (videoCount > 0) {
          // Use archiveName as the ID to prevent duplicates
          const existing = archiveMap.get(archiveName);
          if (existing) {
            // Merge with existing
            existing.videos = [...existing.videos, ...videos].slice(0, 15);
            existing.photoCount = Math.max(existing.photoCount, photoCount);
          } else {
            archiveMap.set(archiveName, {
              archiveId: archiveName, // Use name as ID
              archiveName,
              folderId: folder.id,
              folderName: folder.name,
              videos: videos.slice(0, 15),
              photoCount
            });
          }
        }
      }
    }
    
    // Convert map to array and sort
    const allArchiveGroups = Array.from(archiveMap.values());
    allArchiveGroups.sort((a, b) => a.archiveName.localeCompare(b.archiveName));
    
    setArchiveGroups(allArchiveGroups);
    setLoading(false);
  }

  const scroll = (archiveId: string, direction: 'left' | 'right') => {
    const container = scrollRefs.current.get(archiveId);
    if (container) {
      const scrollAmount = direction === 'left' ? -400 : 400;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-10">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse">
            <div className="h-6 w-48 bg-zinc-800 rounded mb-4" />
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map(j => (
                <div key={j} className="w-64 h-36 bg-zinc-800 rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (archiveGroups.length === 0) return null;

  return (
    <div className="space-y-10">
      {archiveGroups.map((group) => (
        <div key={group.archiveId} className="group/row">
          {/* Header Row */}
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="flex items-center gap-2">
              <Archive size={20} className="text-violet-400" />
              <h2 
                className="text-xl font-semibold text-white hover:text-violet-400 transition-colors cursor-pointer"
                onClick={() => onSelectFolder(group.folderId)}
              >
                {group.archiveName}
              </h2>
            </div>
            <span className="text-zinc-500 text-sm">
              {group.videos.filter(v => 
                v.file.type?.startsWith('video/') || 
                v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
              ).length} videos
              {group.photoCount > 0 ? `, ${group.photoCount} photos` : ''}
            </span>
            
            {/* Navigation arrows */}
            <div className="ml-auto flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <button
                onClick={() => scroll(group.archiveId, 'left')}
                className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={() => onViewAllContents(group.folderId, group.archiveId, group.archiveName)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-sm transition-colors"
              >
                View All
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => scroll(group.archiveId, 'right')}
                className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          
          {/* Video Carousel - Netflix Style */}
          <div className="relative">
            <div 
              ref={(el) => {
                if (el) scrollRefs.current.set(group.archiveId, el);
              }}
              className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {group.videos.map((item) => {
                const isVideo = item.file.type?.startsWith('video/') || 
                               item.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i);
                const isPhoto = item.file.type?.startsWith('image/') || 
                               item.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
                
                return (
                <div
                  key={`${group.archiveId}-${item.id}`}
                  className="shrink-0 w-72 cursor-pointer group/media"
                  onClick={() => isVideo ? onPlayVideo(item.file, item.id, item.name) : undefined}
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-900">
                    {isVideo && item.previewUrl ? (
                      <video
                        src={item.previewUrl}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover/media:scale-110"
                        muted
                        loop
                        autoPlay
                        playsInline
                      />
                    ) : isPhoto ? (
                      <img
                        src={URL.createObjectURL(item.file)}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover/media:scale-110"
                        onLoad={(e) => {
                          // Clean up blob URL after load to prevent memory leak
                          setTimeout(() => URL.revokeObjectURL((e.target as HTMLImageElement).src), 100);
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      </div>
                    )}
                    
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover/media:opacity-100 transition-opacity" />
                    
                    {/* Play button - only for videos */}
                    {isVideo && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity">
                        <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
                          <Play size={24} className="text-white ml-1" />
                        </div>
                      </div>
                    )}
                    
                    {/* File name */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                      <span className="text-sm text-white font-medium truncate block">
                        {item.name.split('/').pop()?.replace(/\.[^/.]+$/, '')}
                      </span>
                    </div>
                  </div>
                </div>
              )})}
              
              {/* View All Card */}
              <div
                className="shrink-0 w-48 aspect-video cursor-pointer flex flex-col items-center justify-center rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors border border-zinc-700 hover:border-violet-500/50 group/viewall"
                onClick={() => onViewAllContents(group.folderId, group.archiveId, group.archiveName)}
              >
                <ChevronRight size={32} className="text-zinc-400 group-hover/viewall:text-white mb-2 transition-colors" />
                <span className="text-sm text-zinc-300 group-hover/viewall:text-white transition-colors">View All</span>
                <span className="text-xs text-zinc-500 mt-1">
                  {group.videos.length} items
                </span>
              </div>
            </div>
            
            {/* Right fade */}
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#020202] to-transparent pointer-events-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
