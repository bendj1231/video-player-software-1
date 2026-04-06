import { useState, useEffect } from 'react';
import { VideoZip, getFolders, getVideosByFolder, Folder } from '../lib/db';
import { FileVideo, Image, FolderOpen } from 'lucide-react';
import clsx from 'clsx';

interface GalleryContentsSectionProps {
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  onSelectFolder: (id: string) => void;
  blurEnabled?: boolean;
}

interface ContentItem extends VideoZip {
  folderName: string;
  thumbnailUrl?: string;
}

interface FolderContent {
  folder: Folder;
  videos: ContentItem[];
  photos: ContentItem[];
}

export function GalleryContentsSection({ onPlayVideo, onSelectFolder, blurEnabled }: GalleryContentsSectionProps) {
  const [folderContents, setFolderContents] = useState<Map<string, FolderContent>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'all' | 'videos' | 'photos'>('all');

  useEffect(() => {
    loadContents();
  }, []);

  const isArchiveFile = (name: string) => {
    const lowerName = name.toLowerCase();
    return lowerName.endsWith('.7z') || lowerName.endsWith('.zip') || lowerName.endsWith('.rar') || lowerName.endsWith('.tar') || lowerName.endsWith('.gz');
  };

  async function loadContents() {
    setIsLoading(true);
    const folders = await getFolders();
    
    const contents = new Map<string, FolderContent>();
    
    for (const folder of folders) {
      const folderVideos = await getVideosByFolder(folder.id);
      const videos: ContentItem[] = [];
      const photos: ContentItem[] = [];
      
      for (const item of folderVideos) {
        // Skip archive files - only show media
        if (isArchiveFile(item.name)) continue;
        
        // Generate thumbnail URL for each item
        let thumbnailUrl: string | undefined;
        try {
          thumbnailUrl = URL.createObjectURL(item.file);
        } catch (err) {
          console.error('Failed to create preview URL for:', item.name, err);
        }
        
        const contentItem: ContentItem = { 
          ...item, 
          folderName: folder.name,
          thumbnailUrl 
        };
        
        if (item.file.type.startsWith('image/')) {
          photos.push(contentItem);
        } else {
          videos.push(contentItem);
        }
      }
      
      // Only add folder if it has content
      if (videos.length > 0 || photos.length > 0) {
        contents.set(folder.id, { folder, videos, photos });
      }
    }
    
    setFolderContents(contents);
    setIsLoading(false);
  }

  // Check if file is an archive
  const getArchiveInfo = (name: string) => {
    const lowerName = name.toLowerCase();
    const is7z = lowerName.endsWith('.7z');
    const isZip = lowerName.endsWith('.zip');
    const isRar = lowerName.endsWith('.rar');
    return { is7z, isZip, isRar, isArchive: is7z || isZip || isRar };
  };

  // Calculate totals
  const totalVideos = Array.from(folderContents.values()).reduce((sum: number, f: FolderContent) => sum + f.videos.length, 0);
  const totalPhotos = Array.from(folderContents.values()).reduce((sum: number, f: FolderContent) => sum + f.photos.length, 0);

  if (isLoading) {
    return (
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Gallery Contents</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="aspect-square bg-white/10 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (totalVideos + totalPhotos === 0) {
    return (
      <div className={`mb-8 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
        <h2 className="text-xl font-semibold text-white mb-4">Gallery Contents</h2>
        <div className="p-8 glass-card rounded-2xl text-center text-zinc-400">
          <FileVideo size={48} className="mx-auto mb-4 opacity-40" />
          <p>No content yet. Add files to your folders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-8 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Gallery Contents</h2>
          <p className="text-zinc-500 text-sm">
            {totalVideos} videos, {totalPhotos} photos across {folderContents.size} folders
          </p>
        </div>
        
        {/* View Mode Tabs */}
        <div className="flex items-center gap-1 bg-zinc-800/50 rounded-lg p-1">
          <button
            onClick={() => setViewMode('all')}
            className={clsx(
              "px-3 py-1.5 rounded text-sm font-medium transition-colors",
              viewMode === 'all' ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
            )}
          >
            All
          </button>
          <button
            onClick={() => setViewMode('videos')}
            className={clsx(
              "px-3 py-1.5 rounded text-sm font-medium transition-colors",
              viewMode === 'videos' ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
            )}
          >
            Videos
          </button>
          <button
            onClick={() => setViewMode('photos')}
            className={clsx(
              "px-3 py-1.5 rounded text-sm font-medium transition-colors",
              viewMode === 'photos' ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
            )}
          >
            Photos
          </button>
        </div>
      </div>

      {/* Folder Sections */}
      <div className="space-y-8">
        {Array.from(folderContents.entries()).map(([folderId, { folder, videos, photos }]) => {
          const displayItems = viewMode === 'all' 
            ? [...videos, ...photos] 
            : viewMode === 'videos' 
              ? videos 
              : photos;
          
          if (displayItems.length === 0) return null;
          
          return (
            <div key={folderId}>
              {/* Folder Header */}
              <div 
                className="flex items-center gap-2 mb-3 cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors"
                onClick={() => onSelectFolder(folderId)}
              >
                <FolderOpen size={18} className="text-emerald-400" />
                <h3 className="text-lg font-medium text-white">{folder.name}</h3>
                <span className="text-sm text-zinc-500">
                  {videos.length} videos{photos.length > 0 ? `, ${photos.length} photos` : ''}
                </span>
              </div>
              
              {/* Folder Content Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {displayItems.map((item) => {
                  const isVideo = !item.file.type.startsWith('image/');
                  
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (isVideo) {
                          onPlayVideo(item.file, item.id, item.name);
                        } else {
                          onSelectFolder(item.folderId);
                        }
                      }}
                      className="group relative aspect-square rounded-xl overflow-hidden bg-zinc-800/50 border border-white/10 hover:border-white/20 transition-all hover:scale-105"
                    >
                      {/* Thumbnail or Icon */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {item.thumbnail ? (
                          <img 
                            src={item.thumbnail} 
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            {isVideo ? (
                              <FileVideo size={40} className="text-zinc-500" />
                            ) : (
                              <Image size={40} className="text-zinc-500" />
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      
                      {/* Info Overlay */}
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
                        <p className="text-white text-xs font-medium truncate">{item.name.split('/').pop() || item.name}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
