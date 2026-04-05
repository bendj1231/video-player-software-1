import { useState, useEffect, useRef } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { Play } from 'lucide-react';
import { getVideoPreview } from '../lib/zip';

interface Media3DCarouselProps {
  onPlayVideo: (blob: Blob, videoId: string) => void;
  blurEnabled?: boolean;
}

interface MediaItem extends VideoZip {
  previewUrl?: string;
  cleanup?: () => void;
  folderName?: string;
}

export function Media3DCarousel({ onPlayVideo, blurEnabled }: Media3DCarouselProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>('');
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    loadMedia();
    return () => {
      items.forEach(i => i.cleanup?.());
    };
  }, []);

  useEffect(() => {
    if (!isPaused && items.length > 0 && containerRef.current) {
      const container = containerRef.current;
      const scrollWidth = container.scrollWidth / 2;
      
      const animate = () => {
        scrollPositionRef.current += 1.5; // Scroll speed
        
        // Reset when scrolled through half (duplicate content)
        if (scrollPositionRef.current >= scrollWidth) {
          scrollPositionRef.current = 0;
        }
        
        container.scrollLeft = scrollPositionRef.current;
        animationRef.current = requestAnimationFrame(animate);
      };
      
      animationRef.current = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPaused, items.length]);

  async function loadMedia() {
    const folders = await getFolders();
    let allVideos: MediaItem[] = [];
    
    for (const folder of folders) {
      const vids = await getVideosByFolder(folder.id);
      allVideos = allVideos.concat(vids.map(v => ({ ...v, folderId: folder.id, folderName: folder.name })));
    }
    
    // Get previews for all videos
    const withPreviews = await Promise.all(
      allVideos.slice(0, 20).map(async (video) => {
        const result = await getVideoPreview(video.file, video.name);
        return {
          ...video,
          previewUrl: result?.url,
          cleanup: result?.cleanup
        };
      })
    );
    
    // Set current folder name (from first video's folder)
    if (withPreviews.length > 0) {
      setCurrentFolder(withPreviews[0].folderName || '');
    }
    
    // Double the items for seamless infinite scroll
    setItems([...withPreviews, ...withPreviews]);
  }

  if (items.length === 0) return null;

  return (
    <div 
      className={`relative overflow-hidden transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Header with folder name */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <h2 className="text-xl font-semibold text-white">Discover</h2>
        {currentFolder && (
          <span className="text-zinc-400 text-lg">- {currentFolder}</span>
        )}
      </div>
      
      <div 
        ref={containerRef}
        className="flex gap-4 overflow-x-hidden"
        style={{ scrollBehavior: 'auto' }}
      >
        {items.map((item, index) => (
          <div
            key={`${item.id}-${index}`}
            className="shrink-0 w-72 cursor-pointer group"
            onClick={() => onPlayVideo(item.file, item.id)}
          >
            <div className="relative h-48 overflow-hidden rounded-lg bg-black">
              <div className="relative w-full h-full bg-black">
                {item.previewUrl ? (
                  <video
                    src={item.previewUrl}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                )}
                
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-all" />
                
                {/* Play button */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-14 h-14 glass-button rounded-full flex items-center justify-center">
                    <Play size={24} className="text-white ml-1" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* No text shown beneath video */}
          </div>
        ))}
      </div>
      
      {/* Gradient overlays for fade effect */}
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#020202] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#020202] to-transparent pointer-events-none z-10" />
    </div>
  );
}
