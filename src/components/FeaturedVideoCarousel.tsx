import { useState, useEffect, useCallback } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractVideoFromZip } from '../lib/zip';

interface FeaturedVideoCarouselProps {
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
  cleanup?: () => void;
}

export function FeaturedVideoCarousel({ onPlayVideo }: FeaturedVideoCarouselProps) {
  const [videos, setVideos] = useState<VideoWithPreview[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedPreviews, setLoadedPreviews] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadVideos() {
      setIsLoading(true);
      const folders = await getFolders();
      let allVideos: VideoZip[] = [];
      for (const folder of folders) {
        const vids = await getVideosByFolder(folder.id);
        allVideos = allVideos.concat(vids);
      }
      allVideos.sort((a, b) => b.createdAt - a.createdAt);
      setVideos(allVideos.slice(0, 5));
      setIsLoading(false);
    }
    loadVideos();
  }, []);

  useEffect(() => {
    const loadPreview = async () => {
      if (videos.length === 0) return;
      const currentVideo = videos[currentIndex];
      if (!currentVideo || loadedPreviews.has(currentVideo.id)) return;

      const result = await extractVideoFromZip(currentVideo.file);
      if (result) {
        setVideos(prev => prev.map(v => 
          v.id === currentVideo.id 
            ? { ...v, previewUrl: result.url, cleanup: result.cleanup }
            : v
        ));
        setLoadedPreviews(prev => new Set(prev).add(currentVideo.id));
      }
    };
    loadPreview();
  }, [currentIndex, videos, loadedPreviews]);

  useEffect(() => {
    if (videos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % videos.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [videos.length]);

  useEffect(() => {
    return () => {
      videos.forEach(v => v.cleanup?.());
    };
  }, [videos]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex(prev => (prev - 1 + videos.length) % videos.length);
  }, [videos.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex(prev => (prev + 1) % videos.length);
  }, [videos.length]);

  const currentVideo = videos[currentIndex];

  if (isLoading) {
    return (
      <div className="w-full aspect-video max-h-[500px] rounded-[2rem] glass-card animate-pulse flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-white/10"></div>
      </div>
    );
  }

  if (videos.length === 0) {
    return null;
  }

  return (
    <div className="relative w-full aspect-video max-h-[500px] rounded-[2rem] overflow-hidden glass-card">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentVideo?.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          {currentVideo?.previewUrl ? (
            <video
              src={currentVideo.previewUrl}
              className="w-full h-full object-cover"
              muted
              loop
              autoPlay
              playsInline
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-8 flex items-end justify-between">
            <div className="flex-1">
              <motion.h3 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold text-white mb-2 tracking-tight"
              >
                {currentVideo?.name}
              </motion.h3>
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-white/60 text-lg"
              >
                {currentIndex + 1} of {videos.length}
              </motion.p>
            </div>
            
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4 }}
              onClick={() => currentVideo && onPlayVideo(currentVideo.file, currentVideo.id)}
              className="w-20 h-20 glass-button rounded-full flex items-center justify-center hover:scale-110 transition-transform"
            >
              <Play size={32} className="text-white ml-1" />
            </motion.button>
          </div>
        </motion.div>
      </AnimatePresence>

      {videos.length > 1 && (
        <>
          <button
            onClick={goToPrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 glass-button rounded-full text-white hover:scale-110 transition-transform"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={goToNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 glass-button rounded-full text-white hover:scale-110 transition-transform"
          >
            <ChevronRight size={24} />
          </button>
          
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2">
            {videos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === currentIndex ? 'bg-white w-6' : 'bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
