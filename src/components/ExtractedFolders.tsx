import { useState, useEffect } from 'react';
import { Folder, getFolders, getVideosByFolder, VideoZip } from '../lib/db';
import { getVideoPreview } from '../lib/zip';
import { FolderIcon, ChevronRight, Play, Archive } from 'lucide-react';

interface ExtractedFoldersProps {
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  onViewAllContents: (folderId: string, archiveId?: string, archiveName?: string) => void;
  blurEnabled?: boolean;
}

interface ExtractedFolder {
  id: string;
  folderId: string;
  folderName: string;
  archiveName: string;
  videos: VideoWithPreview[];
  photoCount: number;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
}

export function ExtractedFolders({ onPlayVideo, onViewAllContents, blurEnabled }: ExtractedFoldersProps) {
  const [extractedFolders, setExtractedFolders] = useState<ExtractedFolder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExtractedFolders();
  }, []);

  async function loadExtractedFolders() {
    const folders = await getFolders();
    const allExtracted: ExtractedFolder[] = [];
    
    for (const folder of folders) {
      const allFiles = await getVideosByFolder(folder.id);
      
      // Group by sourceArchiveId to create folder groups
      const archiveGroups = new Map<string, VideoWithPreview[]>();
      
      for (const file of allFiles) {
        // Only include files from extracted archives
        if (file.sourceArchiveId && file.sourceArchiveName) {
          if (!archiveGroups.has(file.sourceArchiveId)) {
            archiveGroups.set(file.sourceArchiveId, []);
          }
          
          // Generate preview
          const result = await getVideoPreview(file.file, file.name);
          archiveGroups.get(file.sourceArchiveId)!.push({
            ...file,
            previewUrl: result?.url
          });
        }
      }
      
      // Create ExtractedFolder entries
      for (const [archiveId, videos] of archiveGroups) {
        const firstVideo = videos[0];
        if (firstVideo && firstVideo.sourceArchiveName) {
          const photoCount = videos.filter(v => 
            v.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i)
          ).length;
          
          allExtracted.push({
            id: archiveId,
            folderId: folder.id,
            folderName: folder.name,
            archiveName: firstVideo.sourceArchiveName.replace(/\.[^/.]+$/, ''), // Remove extension
            videos: videos.slice(0, 10), // Max 10 per carousel
            photoCount
          });
        }
      }
    }
    
    setExtractedFolders(allExtracted);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-6 w-48 bg-zinc-800 rounded mb-4" />
          <div className="flex gap-4">
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="w-72 h-40 bg-zinc-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (extractedFolders.length === 0) return null;

  return (
    <div className="space-y-8">
      {extractedFolders.map((extracted) => (
        <div key={extracted.id} className="group/folder">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4 px-1">
            <Archive size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-white">
              {extracted.archiveName}
            </h2>
            <span className="text-zinc-400 text-sm">
              from {extracted.folderName}
            </span>
            <span className="text-zinc-500 text-xs">
              {extracted.videos.length} vids{extracted.photoCount > 0 ? `, ${extracted.photoCount} imgs` : ''}
            </span>
            <button
              onClick={() => onViewAllContents(extracted.folderId, extracted.id, extracted.archiveName)}
              className="ml-auto p-1 rounded-full hover:bg-white/10 transition-colors opacity-0 group-hover/folder:opacity-100"
            >
              <ChevronRight size={18} className="text-zinc-400" />
            </button>
          </div>
          
          {/* Video Carousel */}
          <div className="relative">
            <div 
              className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent scroll-smooth"
              style={{ scrollSnapType: 'x mandatory' }}
            >
              {extracted.videos.map((video, index) => (
                <div
                  key={video.id}
                  className="shrink-0 w-64 cursor-pointer group/video scroll-snap-start"
                  onClick={() => onPlayVideo(video.file, video.id, video.name)}
                >
                  <div className="relative h-36 overflow-hidden rounded-lg bg-black">
                    {video.previewUrl ? (
                      <video
                        src={video.previewUrl}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        autoPlay={index === 0}
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      </div>
                    )}
                    
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/30 group-hover/video:bg-black/50 transition-all" />
                    
                    {/* Play button */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/video:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Play size={20} className="text-white ml-0.5" />
                      </div>
                    </div>
                    
                    {/* Video name */}
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                      <span className="text-xs text-white truncate block">
                        {video.name.split('/').pop()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* View All */}
              <div
                className="shrink-0 w-36 h-36 cursor-pointer flex flex-col items-center justify-center rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors border border-zinc-700 hover:border-violet-500/50"
                onClick={() => onViewAllContents(extracted.folderId, extracted.id, extracted.archiveName)}
              >
                <ChevronRight size={28} className="text-zinc-400 mb-1" />
                <span className="text-xs text-zinc-300">View All</span>
                <span className="text-[10px] text-zinc-500 mt-1">{extracted.videos.length} items</span>
              </div>
            </div>
            
            {/* Fade right edge */}
            <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[#020202] to-transparent pointer-events-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
