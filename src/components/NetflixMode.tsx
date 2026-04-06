import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFolders, getVideosByFolder, VideoZip } from '../lib/db';
import { getVideoPreview } from '../lib/zip';
import { Play, ChevronDown, ChevronUp, FolderOpen, Volume2, VolumeX, Archive, X } from 'lucide-react';

interface NetflixModeProps {
  onSelectFolder: (id: string) => void;
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  onViewAllContents: (folderId: string, archiveId?: string, archiveName?: string) => void;
  blurEnabled?: boolean;
}

interface ArchiveGroup {
  archiveId: string;
  archiveName: string;
  folderId: string;
  folderName: string;
  videos: VideoWithPreview[];
  photoCount: number;
  previewUrl?: string;
  firstVideo?: VideoWithPreview;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
}

export function NetflixMode({ onSelectFolder, onPlayVideo, onViewAllContents, blurEnabled }: NetflixModeProps) {
  const [archiveGroups, setArchiveGroups] = useState<ArchiveGroup[]>([]);
  const [featuredArchive, setFeaturedArchive] = useState<ArchiveGroup | null>(null);
  const [featuredVideo, setFeaturedVideo] = useState<VideoWithPreview | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<ArchiveGroup | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadArchiveGroups();
  }, []);

  async function loadArchiveGroups() {
    setIsLoading(true);
    const allFolders = await getFolders();
    const archiveMap = new Map<string, ArchiveGroup>();
    
    for (const folder of allFolders) {
      const allFiles = await getVideosByFolder(folder.id);
      
      const groups = new Map<string, VideoWithPreview[]>();
      
      for (const file of allFiles) {
        if (!file.sourceArchiveId || !file.sourceArchiveName) continue;
        
        const isVideo = file.file.type?.startsWith('video/') || 
                        file.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i);
        const isPhoto = file.file.type?.startsWith('image/') || 
                        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
        
        if (!isVideo && !isPhoto) continue;
        
        const archiveName = file.sourceArchiveName.replace(/\.[^/.]+$/, '');
        
        if (!groups.has(archiveName)) {
          groups.set(archiveName, []);
        }
        
        if (isVideo) {
          const result = await getVideoPreview(file.file, file.name);
          groups.get(archiveName)!.push({ ...file, previewUrl: result?.url });
        } else {
          groups.get(archiveName)!.push({ ...file });
        }
      }
      
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
          const existing = archiveMap.get(archiveName);
          const firstVideo = videos.find(v => 
            v.file.type?.startsWith('video/') || 
            v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
          );
          const previewUrl = firstVideo?.previewUrl;
          
          if (existing) {
            // Merge videos and update counts
            const mergedVideos = [...existing.videos, ...videos].slice(0, 20);
            existing.videos = mergedVideos;
            // Recalculate counts from merged videos
            existing.photoCount = mergedVideos.filter(v => 
              v.file.type?.startsWith('image/') || 
              v.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i)
            ).length;
            if (!existing.previewUrl && previewUrl) {
              existing.previewUrl = previewUrl;
              existing.firstVideo = firstVideo;
            }
          } else {
            archiveMap.set(archiveName, {
              archiveId: archiveName,
              archiveName,
              folderId: folder.id,
              folderName: folder.name,
              videos: videos.slice(0, 20),
              photoCount,
              previewUrl,
              firstVideo
            });
          }
        }
      }
    }
    
    const allGroups = Array.from(archiveMap.values());
    allGroups.sort((a, b) => a.archiveName.localeCompare(b.archiveName));
    
    setArchiveGroups(allGroups);
    
    if (allGroups.length > 0) {
      const randomIdx = Math.floor(Math.random() * allGroups.length);
      setFeaturedArchive(allGroups[randomIdx]);
      setFeaturedVideo(allGroups[randomIdx].firstVideo || null);
    }
    
    setIsLoading(false);
  }

  const handleArchiveClick = (archive: ArchiveGroup) => {
    setSelectedArchive(selectedArchive?.archiveId === archive.archiveId ? null : archive);
    
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

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

  if (archiveGroups.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 bg-[#141414]">
        <p>No extracted archives found</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-[#141414] ${blurEnabled ? 'blur-[20px]' : ''}`}>
      {/* Hero Banner */}
      {featuredArchive && featuredVideo && (
        <div className="relative h-[85vh] w-full">
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
            <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/30 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/90 via-transparent to-transparent" />
          </div>
          
          <div className="absolute bottom-0 left-0 right-0 p-8 pb-24">
            <div className="max-w-2xl">
              <h1 className="text-6xl md:text-7xl font-bold text-white mb-4 drop-shadow-2xl tracking-tight">
                {featuredArchive.archiveName}
              </h1>
              
              <div className="flex items-center gap-4 mb-4 text-sm">
                <span className="text-green-400 font-semibold text-lg">
                  {featuredArchive.videos.filter(v => 
                    v.file.type?.startsWith('video/') || 
                    v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
                  ).length} Videos
                </span>
                {featuredArchive.photoCount > 0 && (
                  <span className="text-zinc-300 text-lg">{featuredArchive.photoCount} Photos</span>
                )}
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-300">from {featuredArchive.folderName}</span>
              </div>
              
              <p className="text-xl text-white/90 mb-8 line-clamp-2 drop-shadow-lg">
                {featuredVideo.name.split('/').pop()}
              </p>
              
              <div className="flex items-center gap-4">
                <button
                  onClick={() => onPlayVideo(featuredVideo.file, featuredVideo.id, featuredVideo.name)}
                  className="flex items-center gap-3 px-8 py-4 bg-white hover:bg-white/90 text-black rounded-lg font-bold text-lg transition-colors"
                >
                  <Play size={28} fill="black" />
                  Play
                </button>
                <button
                  onClick={() => onSelectFolder(featuredArchive.folderId)}
                  className="flex items-center gap-3 px-8 py-4 bg-white/20 hover:bg-white/30 text-white rounded-lg font-semibold text-lg backdrop-blur-sm transition-colors border border-white/30"
                >
                  <FolderOpen size={24} />
                  Open Folder
                </button>
                <button
                  onClick={() => onViewAllContents(featuredArchive.folderId, featuredArchive.archiveId, featuredArchive.archiveName)}
                  className="flex items-center gap-3 px-8 py-4 bg-white/20 hover:bg-white/30 text-white rounded-lg font-semibold text-lg backdrop-blur-sm transition-colors border border-white/30"
                >
                  <ChevronDown size={24} />
                  View All
                </button>
              </div>
            </div>
          </div>
          
          <button
            onClick={toggleMute}
            className="absolute bottom-24 right-8 p-4 rounded-full border-2 border-white/50 text-white hover:bg-white/10 transition-colors"
          >
            {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
        </div>
      )}

      {/* Archive Covers Grid */}
      <div className="relative z-10 -mt-24 pb-16 px-8">
        <h2 className="text-2xl font-bold text-white mb-6">Extracted Archives</h2>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {archiveGroups.map((archive) => (
            <motion.div
              key={archive.archiveId}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.05, y: -10 }}
              transition={{ duration: 0.3 }}
              className="relative aspect-[2/3] rounded-lg overflow-hidden cursor-pointer group"
              onClick={() => handleArchiveClick(archive)}
            >
              {/* Cover Image */}
              {archive.previewUrl ? (
                <video
                  src={archive.previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  autoPlay
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-violet-600 to-purple-900 flex items-center justify-center">
                  <Archive size={48} className="text-white/50" />
                </div>
              )}
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h3 className="text-lg font-bold text-white mb-1 line-clamp-2">
                  {archive.archiveName}
                </h3>
                <p className="text-sm text-zinc-300">
                  {archive.videos.filter(v => 
                    v.file.type?.startsWith('video/') || 
                    v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
                  ).length} videos
                  {archive.photoCount > 0 && `, ${archive.photoCount} photos`}
                </p>
                <p className="text-xs text-zinc-500 mt-1">from {archive.folderName}</p>
              </div>
              
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/50">
                  {selectedArchive?.archiveId === archive.archiveId ? (
                    <ChevronUp size={32} className="text-white" />
                  ) : (
                    <ChevronDown size={32} className="text-white" />
                  )}
                </div>
              </div>
              
              {selectedArchive?.archiveId === archive.archiveId && (
                <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
                  <ChevronDown size={20} className="text-white" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Expanded Archive Section */}
      <AnimatePresence>
        {selectedArchive && (
          <motion.div
            ref={scrollRef}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4 }}
            className="bg-[#1a1a1a] border-t border-zinc-800"
          >
            <div className="px-8 py-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <Archive size={28} className="text-violet-400" />
                  <h2 className="text-3xl font-bold text-white">{selectedArchive.archiveName}</h2>
                  <span className="text-zinc-400">
                    {selectedArchive.videos.filter(v => 
                      v.file.type?.startsWith('video/') || 
                      v.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)
                    ).length} videos
                    {selectedArchive.photoCount > 0 ? `, ${selectedArchive.photoCount} photos` : ''}
                  </span>
                  <span className="text-zinc-500 text-sm">from {selectedArchive.folderName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onViewAllContents(selectedArchive.folderId, selectedArchive.archiveId, selectedArchive.archiveName)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
                  >
                    View All in Grid
                  </button>
                  <button
                    onClick={() => setSelectedArchive(null)}
                    className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>
              
              <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide scroll-smooth">
                {selectedArchive.videos.map((item, index) => {
                  const isVideo = item.file.type?.startsWith('video/') || 
                                  item.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i);
                  const isPhoto = item.file.type?.startsWith('image/') || 
                                  item.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
                  
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="relative shrink-0 w-80 group/card"
                    >
                      <div 
                        className="relative aspect-video rounded-lg overflow-hidden bg-zinc-800 cursor-pointer transition-transform duration-300 group-hover/card:scale-105"
                        onClick={() => isVideo ? onPlayVideo(item.file, item.id, item.name) : undefined}
                      >
                        {isVideo && item.previewUrl ? (
                          <video
                            src={item.previewUrl}
                            className="w-full h-full object-cover"
                            muted
                            loop
                            autoPlay
                            playsInline
                          />
                        ) : isPhoto ? (
                          <img
                            src={URL.createObjectURL(item.file)}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            onLoad={(e) => {
                              setTimeout(() => URL.revokeObjectURL((e.target as HTMLImageElement).src), 100);
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                            <Play size={40} className="text-zinc-600" />
                          </div>
                        )}
                        
                        {isVideo && (
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPlayVideo(item.file, item.id, item.name);
                              }}
                              className="w-14 h-14 rounded-full bg-white flex items-center justify-center hover:bg-white/90 transition-colors"
                            >
                              <Play size={28} fill="black" className="text-black ml-1" />
                            </button>
                          </div>
                        )}
                        
                        <span className="absolute bottom-2 left-2 right-2 text-sm text-white/90 truncate text-center px-2 bg-black/50 rounded">
                          {item.name.split('/').pop()?.replace(/\.[^/.]+$/, '')}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
