import { useState, useEffect } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { FolderSection } from './FolderSection';
import { Media3DCarousel } from './Media3DCarousel';
import { HardDrive } from 'lucide-react';

export function HomeView({ onPlayVideo, onSelectFolder, blurEnabled, theme }: { 
  onPlayVideo: (blob: Blob, videoId: string) => void;
  onSelectFolder: (id: string) => void;
  blurEnabled: boolean;
  theme?: 'dark' | 'light' | 'futuristic' | 'smokey';
}) {
  const [totalVideos, setTotalVideos] = useState(0);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [totalFolders, setTotalFolders] = useState(0);
  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number } | null>(null);

  useEffect(() => {
    async function loadStats() {
      const folders = await getFolders();
      setTotalFolders(folders.length);
      
      let allVideos: VideoZip[] = [];
      for (const folder of folders) {
        const vids = await getVideosByFolder(folder.id);
        allVideos = allVideos.concat(vids);
      }
      
      // Separate videos and photos
      const videos = allVideos.filter(v => v.file.type.startsWith('video/') || !v.file.type.startsWith('image/'));
      const photos = allVideos.filter(v => v.file.type.startsWith('image/'));
      
      setTotalVideos(videos.length);
      setTotalPhotos(photos.length);
    }
    loadStats();
    
    // Get storage estimate
    async function getStorage() {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        if (estimate.usage && estimate.quota) {
          setStorageInfo({
            used: estimate.usage,
            total: estimate.quota
          });
        }
      }
    }
    getStorage();
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const MAX_STORAGE = 1024 * 1024 * 1024 * 1024; // 1 TB
  const usedPercent = storageInfo ? Math.round((storageInfo.used / MAX_STORAGE) * 100) : 0;

  return (
    <div className="p-10 w-full">
      <div className="mb-8">
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">Welcome Back</h1>
        <div className="flex items-center gap-4">
          <p className="text-zinc-400 text-lg">{totalVideos} videos, {totalPhotos} photos in {totalFolders} folders</p>
          {storageInfo && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-full border border-white/10">
              <HardDrive size={14} className="text-zinc-400" />
              <span className="text-sm text-zinc-300">{formatBytes(storageInfo.used)} / 1 TB</span>
              <div className="w-16 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <FolderSection onSelectFolder={onSelectFolder} blurEnabled={blurEnabled} theme={theme} />

      <div className={`mb-12 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
        <Media3DCarousel onPlayVideo={onPlayVideo} blurEnabled={blurEnabled} />
      </div>
    </div>
  );
}
