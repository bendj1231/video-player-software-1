import { useState, useEffect } from 'react';
import { VideoZip, getFolders, getVideosByFolder } from '../lib/db';
import { isElectron, getStorageStats, formatBytes } from '../lib/electronStorage';
import { FolderSection } from './FolderSection';
import { Media3DCarousel } from './Media3DCarousel';
import { FolderDiscover } from './FolderDiscover';
import { HardDrive } from 'lucide-react';
import { StorageLibrary } from './StorageLibrary';
import { RecentlyAdded } from './RecentlyAdded';
import { RecentlyViewed } from './RecentlyViewed';

export function HomeView({ onPlayVideo, onPlayDirect, onSelectFolder, onViewAllContents, onStorageChanged, onOpenStorageFolder, blurEnabled, theme, refreshTrigger }: { 
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  onPlayDirect?: (url: string, name: string) => void;
  onStorageChanged?: () => void;
  onOpenStorageFolder?: (relPath: string) => void;
  onSelectFolder: (id: string) => void;
  onViewAllContents: (folderId: string, archiveId?: string, archiveName?: string) => void;
  blurEnabled: boolean;
  theme?: 'dark' | 'light' | 'futuristic' | 'smokey';
  refreshTrigger?: number;
}) {
  const [totalVideos, setTotalVideos] = useState(0);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [totalFolders, setTotalFolders] = useState(0);
  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number } | null>(null);
  const [electronStats, setElectronStats] = useState<{ videos: number; photos: number; used: number; free: number } | null>(null);

  useEffect(() => {
    async function loadStats() {
      if (isElectron()) {
        const stats = await getStorageStats();
        if (stats) {
          setElectronStats({ videos: stats.videos, photos: stats.photos, used: stats.usedBytes, free: stats.freeBytes });
          setStorageInfo({ used: stats.totalBytes - stats.freeBytes, total: stats.totalBytes });
        }
        return;
      }
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
      if (isElectron()) return;
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
  }, [refreshTrigger]);

  const displayVideos = electronStats ? electronStats.videos : totalVideos;
  const displayPhotos = electronStats ? electronStats.photos : totalPhotos;
  const usedPercent = storageInfo && storageInfo.total > 0 ? Math.round((storageInfo.used / storageInfo.total) * 100) : 0;

  return (
    <div className="p-10 w-full">
      <div className="mb-8">
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">Welcome Back</h1>
        <div className="flex items-center gap-4">
          <p className="text-zinc-400 text-lg">{displayVideos} videos, {displayPhotos} photos{isElectron() ? '' : ` in ${totalFolders} folders`}</p>
          {storageInfo && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-full border border-white/10">
              <HardDrive size={14} className="text-zinc-400" />
              {electronStats ? (
                <span className="text-sm text-zinc-300">{formatBytes(electronStats.used)} in library · {formatBytes(electronStats.free)} free</span>
              ) : (
                <span className="text-sm text-zinc-300">{formatBytes(storageInfo.used)} / {formatBytes(storageInfo.total)}</span>
              )}
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

      {/* Recently Added - newest imported videos */}
      {isElectron() && onPlayDirect && (
        <div className="relative transition-all duration-300">
          <RecentlyAdded onPlay={onPlayDirect} onOpenFolder={onOpenStorageFolder} refreshTrigger={refreshTrigger} />
          {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
        </div>
      )}

      {/* Recently Viewed - files/folders/galleries you last opened */}
      {isElectron() && onPlayDirect && (
        <div className="relative transition-all duration-300">
          <RecentlyViewed onPlay={onPlayDirect} onOpenFolder={onOpenStorageFolder} />
          {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
        </div>
      )}

      {/* Media Library - real files in Electron storage */}
      {isElectron() && onPlayDirect && (
        <div className="relative transition-all duration-300">
          <StorageLibrary onPlay={onPlayDirect} onOpenFolder={onOpenStorageFolder} refreshTrigger={refreshTrigger} onChanged={onStorageChanged} />
          {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
        </div>
      )}

      {/* Section 1: Your Folders */}
      <div className="relative">
        <FolderSection onSelectFolder={onSelectFolder} blurEnabled={blurEnabled} theme={theme} />
        {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
      </div>

      {/* Section 2: Extracted Archives - Netflix style carousels */}
      <div className="relative mb-12 transition-all duration-300">
        <FolderDiscover onSelectFolder={onSelectFolder} onViewAllContents={onViewAllContents} onPlayVideo={onPlayVideo} blurEnabled={blurEnabled} refreshTrigger={refreshTrigger} />
        {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
      </div>

      {/* Section 3: Media Carousel - All uploaded videos */}
      <div className="relative mb-12 transition-all duration-300">
        <Media3DCarousel onPlayVideo={onPlayVideo} blurEnabled={blurEnabled} />
        {blurEnabled && <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-3xl rounded-xl" />}
      </div>
    </div>
  );
}
