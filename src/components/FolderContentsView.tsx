import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Folder, FileVideo, Image, Trash2 } from 'lucide-react';
import { getVideosByFolder, getFolderById, VideoZip, Folder as FolderType, deleteVideoZip } from '../lib/db';
import { getVideoPreview } from '../lib/zip';

interface FolderContentsViewProps {
  folderId: string;
  archiveId?: string; // Optional: filter to show only specific archive contents
  archiveName?: string; // Optional: display name for the archive
  onBack: () => void;
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  blurEnabled?: boolean;
  isMuted?: boolean;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
}

// Helper to detect video/image files by extension
const isVideoFile = (filename: string): boolean => {
  return filename.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i) !== null;
};

const isImageFile = (filename: string): boolean => {
  return filename.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i) !== null;
};

export function FolderContentsView({ folderId, archiveId, archiveName, onBack, onPlayVideo, blurEnabled }: FolderContentsViewProps) {
  const [folder, setFolder] = useState<FolderType | null>(null);
  const [mediaFiles, setMediaFiles] = useState<VideoWithPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load folder data and generate previews
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const folderData = await getFolderById(folderId);
        if (folderData) {
          setFolder(folderData);
        }

        const allVideos = await getVideosByFolder(folderId);
        
        // Filter to only media files (not archives)
        let media = allVideos.filter(v => 
          isVideoFile(v.name) || isImageFile(v.name) ||
          v.file.type?.startsWith('video/') || 
          v.file.type?.startsWith('image/')
        );

        // If archiveId is provided, filter to only show files from that archive
        if (archiveId) {
          console.log('Filtering by archiveId:', archiveId);
          const beforeCount = media.length;
          media = media.filter(v => {
            const matchId = v.sourceArchiveId === archiveId;
            const matchName = v.sourceArchiveName?.replace(/\.[^/.]+$/, '') === archiveId;
            const matches = matchId || matchName;
            if (!matches) {
              console.log('Excluded file:', v.name, 'sourceArchiveId:', v.sourceArchiveId, 'sourceArchiveName:', v.sourceArchiveName);
            }
            return matches;
          });
          console.log(`Filtered: ${beforeCount} -> ${media.length} files`);
        }

        // Generate previews for all media files
        const mediaWithPreviews = await Promise.all(
          media.map(async (video) => {
            const result = await getVideoPreview(video.file, video.name);
            return { ...video, previewUrl: result?.url };
          })
        );
        
        setMediaFiles(mediaWithPreviews);
      } catch (error) {
        console.error('Error loading folder contents:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [folderId, archiveId]);

  // Handle deleting a file
  const handleDelete = useCallback(async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this file?')) return;
    
    try {
      await deleteVideoZip(fileId);
      setMediaFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete file');
    }
  }, []);

  // Group by folder path
  const groupedFiles = React.useMemo(() => {
    const grouped = new Map<string, VideoWithPreview[]>();
    
    mediaFiles.forEach(file => {
      const path = file.name.includes('/') 
        ? file.name.substring(0, file.name.lastIndexOf('/')) 
        : 'Root';
      if (!grouped.has(path)) {
        grouped.set(path, []);
      }
      grouped.get(path)!.push(file);
    });
    
    // Sort paths: Root first, then alphabetically
    const sortedPaths = Array.from(grouped.keys()).sort((a, b) => {
      if (a === 'Root') return -1;
      if (b === 'Root') return 1;
      return a.localeCompare(b);
    });
    
    return { grouped, sortedPaths };
  }, [mediaFiles]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b border-white/10">
        <button
          onClick={onBack}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <Folder size={24} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">
              {archiveName || folder?.name || 'Folder Contents'}
            </h1>
            <p className="text-sm text-zinc-500">
              {mediaFiles.length} media file{mediaFiles.length !== 1 ? 's' : ''}
              {archiveId && folder?.name && ` from ${folder.name}`}
            </p>
          </div>
        </div>
      </div>

      {/* Masonry Grid Content */}
      <div className={`flex-1 overflow-y-auto p-4 ${blurEnabled ? 'blur-[20px]' : ''}`}>
        {mediaFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
            <FileVideo size={48} className="mb-4 opacity-30" />
            <p>No media files to display</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Group by folder path */}
            {groupedFiles.sortedPaths.map(path => {
              const files = groupedFiles.grouped.get(path)!;
              const videos = files.filter(f => isVideoFile(f.name));
              const photos = files.filter(f => isImageFile(f.name));
              
              return (
                <div key={path} className="space-y-2">
                  {/* Folder Header */}
                  <div className="flex items-center gap-2 px-2 py-1 bg-zinc-800/50 rounded-lg">
                    <Folder size={14} className="text-zinc-400" />
                    <span className="text-xs text-zinc-400 font-medium">{path}</span>
                    <span className="text-[10px] text-zinc-500">
                      ({videos.length} videos{photos.length > 0 ? `, ${photos.length} photos` : ''})
                    </span>
                  </div>
                  
                  {/* Masonry Grid */}
                  <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-1 [column-fill:_balance]">
                    {files.map((file, index) => {
                      const isVideo = isVideoFile(file.name);
                      const isImage = isImageFile(file.name);
                      const filename = file.name.split('/').pop() || file.name;
                      
                      return (
                        <motion.div
                          key={file.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.01 }}
                          onClick={() => onPlayVideo(file.file, file.id, file.name)}
                          className="relative overflow-hidden cursor-pointer break-inside-avoid mb-1 group"
                        >
                          <div className="w-full bg-black relative">
                            {isVideo ? (
                              <video
                                src={file.previewUrl}
                                className="w-full h-auto object-cover"
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                autoPlay
                                onError={(e) => console.error('Video load error:', filename, e)}
                              />
                            ) : isImage ? (
                              file.previewUrl ? (
                                <img src={file.previewUrl} alt={filename} className="w-full h-auto object-cover" />
                              ) : (
                                <div className="w-full aspect-[9/16] bg-zinc-800 flex items-center justify-center">
                                  <Image size={32} className="text-zinc-600" />
                                </div>
                              )
                            ) : (
                              <div className="w-full aspect-[9/16] bg-zinc-800 flex items-center justify-center">
                                <FileVideo size={32} className="text-zinc-600" />
                              </div>
                            )}
                          </div>
                          
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                              <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-white border-b-[6px] border-b-transparent ml-0.5" />
                            </div>
                          </div>
                          
                          {/* Delete button */}
                          <button
                            onClick={(e) => handleDelete(file.id, e)}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-20"
                            title="Delete file"
                          >
                            <Trash2 size={14} />
                          </button>
                          
                          {/* Filename overlay */}
                          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] text-white/90 truncate block">{filename}</span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
