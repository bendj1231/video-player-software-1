import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Folder, getFolders, getVideosByFolder, VideoZip } from '../lib/db';
import { getVideoPreview } from '../lib/zip';
import { Play, Info, ChevronDown, ChevronRight, FolderOpen, Volume2, VolumeX } from 'lucide-react';

interface NetflixModeProps {
  onSelectFolder: (id: string) => void;
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  onViewAllContents: (folderId: string) => void;
  blurEnabled?: boolean;
}

interface FolderWithPreview extends Folder {
  videos: VideoWithPreview[];
  previewUrl?: string;
  videoCount: number;
  photoCount: number;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
}

export function NetflixMode({ onSelectFolder, onPlayVideo, onViewAllContents, blurEnabled }: NetflixModeProps) {
  const [folders, setFolders] = useState<FolderWithPreview[]>([]);
  const [featuredFolder, setFeaturedFolder] = useState<FolderWithPreview | null>(null);
  const [featuredVideo, setFeaturedVideo] = useState<VideoWithPreview | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  async function loadFolders() {
    setIsLoading(true);
    const allFolders = await getFolders();
    
    const foldersWithData = await Promise.all(
      allFolders.map(async (folder) => {
        const allFiles = await getVideosByFolder(folder.id);
        
        // Get videos only
        const videos = allFiles.filter(v => 
          v.file.type?.startsWith('video/') || 
          v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
        );
        
        const photoCount = allFiles.filter(v => 
          v.file.type?.startsWith('image/') || 
          v.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i)
        ).length;
        
        // Get previews for up to 6 videos
        const videosWithPreviews = await Promise.all(
          videos.slice(0, 6).map(async (video) => {
            const result = await getVideoPreview(video.file, video.name);
            return { ...video, previewUrl: result?.url };
          })
        );
        
        // Get preview for folder (first video)
        let previewUrl: string | undefined;
        if (videosWithPreviews.length > 0 && videosWithPreviews[0].previewUrl) {
          previewUrl = videosWithPreviews[0].previewUrl;
        }
        
        return {
          ...folder,
          videos: videosWithPreviews,
          previewUrl,
          videoCount: videos.length,
          photoCount
        };
      })
    );
    
    // Filter to folders with videos and pick random featured
    const withVideos = foldersWithData.filter(f => f.videos.length > 0);
    setFolders(withVideos);
    
    if (withVideos.length > 0) {
      const randomIdx = Math.floor(Math.random() * withVideos.length);
      setFeaturedFolder(withVideos[randomIdx]);
      setFeaturedVideo(withVideos[randomIdx].videos[0] || null);
    }
    
    setIsLoading(false);
  }

  // Toggle mute for featured video
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-red-600" />
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <p>No folders with videos found</p>
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto bg-[#141414] ${blurEnabled ? 'blur-[20px]' : ''}`}>
      {/* Hero Banner */}
      {featuredFolder && featuredVideo && (
        <div className="relative h-[70vh] w-full">
          {/* Background Video/Image */}
          <div className="absolute inset-0">
            {featuredVideo.previewUrl ? (
              <video
                ref={videoRef}
                src={featuredVideo.previewUrl}
                className="w-full h-full object-cover"
                autoPlay
                muted={isMuted}
                loop
                playsInline
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black" />
            )}
            {/* Gradient overlays */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/80 via-transparent to-transparent" />
          </div>
          
          {/* Hero Content */}
          <div className="absolute bottom-0 left-0 right-0 p-8 pb-16">
            <div className="max-w-2xl">
              {/* Logo/Title */}
              <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 drop-shadow-lg">
                {featuredFolder.name}
              </h1>
              
              {/* Meta info */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <span className="text-green-400 font-semibold">{featuredFolder.videoCount} Videos</span>
                {featuredFolder.photoCount > 0 && (
                  <span className="text-zinc-400">{featuredFolder.photoCount} Photos</span>
                )}
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-400">Featured</span>
              </div>
              
              {/* Featured video name */}
              <p className="text-lg text-white/90 mb-6 line-clamp-2 drop-shadow-md">
                {featuredVideo.name.split('/').pop()}
              </p>
              
              {/* Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onPlayVideo(featuredVideo.file, featuredVideo.id, featuredVideo.name)}
                  className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 text-black rounded font-semibold transition-colors"
                >
                  <Play size={20} fill="black" />
                  Play
                </button>
                <button
                  onClick={() => onSelectFolder(featuredFolder.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-white/30 hover:bg-white/40 text-white rounded font-semibold backdrop-blur-sm transition-colors"
                >
                  <FolderOpen size={20} />
                  Open Folder
                </button>
                <button
                  onClick={() => onViewAllContents(featuredFolder.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-white/30 hover:bg-white/40 text-white rounded font-semibold backdrop-blur-sm transition-colors"
                >
                  <ChevronDown size={20} />
                  More Info
                </button>
              </div>
            </div>
          </div>
          
          {/* Mute button */}
          <button
            onClick={toggleMute}
            className="absolute bottom-8 right-8 p-3 rounded-full border-2 border-white/50 text-white hover:bg-white/10 transition-colors"
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
      )}

      {/* Folder Rows */}
      <div className="relative z-10 -mt-16 pb-16 px-8 space-y-8">
        {folders.map((folder, rowIndex) => (
          <div 
            key={folder.id} 
            className="group/row"
            onMouseEnter={() => setSelectedRow(rowIndex)}
            onMouseLeave={() => setSelectedRow(null)}
          >
            {/* Row Header */}
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-semibold text-zinc-300 group-hover/row:text-white transition-colors">
                {folder.name}
              </h2>
              <span className="text-sm text-zinc-500">
                {folder.videoCount} videos
              </span>
              <button
                onClick={() => onSelectFolder(folder.id)}
                className={`ml-auto p-2 rounded-full border border-zinc-600 text-zinc-400 hover:text-white hover:border-white transition-all ${
                  selectedRow === rowIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            
            {/* Video Cards Row */}
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth">
              {folder.videos.map((video, index) => (
                <motion.div
                  key={video.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative shrink-0 w-64 group/card"
                >
                  {/* Card */}
                  <div 
                    className="relative aspect-video rounded-md overflow-hidden bg-zinc-800 cursor-pointer transition-transform duration-300 group-hover/card:scale-110 group-hover/card:z-20"
                    onClick={() => expandedFolder === folder.id ? onPlayVideo(video.file, video.id, video.name) : setExpandedFolder(folder.id)}
                  >
                    {video.previewUrl ? (
                      <video
                        src={video.previewUrl}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        autoPlay={false}
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                        <Play size={32} className="text-zinc-600" />
                      </div>
                    )}
                    
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayVideo(video.file, video.id, video.name);
                        }}
                        className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:bg-white/90 transition-colors"
                      >
                        <Play size={24} fill="black" className="text-black ml-1" />
                      </button>
                      <span className="text-xs text-white/80 truncate max-w-[80%]">
                        {video.name.split('/').pop()}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
              
              {/* View All Card */}
              <div
                onClick={() => onViewAllContents(folder.id)}
                className="shrink-0 w-64 aspect-video rounded-md overflow-hidden bg-zinc-800/50 border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-zinc-800 hover:border-zinc-500 transition-all"
              >
                <FolderOpen size={32} className="text-zinc-500" />
                <span className="text-sm text-zinc-400">View All</span>
                <span className="text-xs text-zinc-600">{folder.videoCount} items</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
