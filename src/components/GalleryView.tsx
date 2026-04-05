import React, { useState, useEffect, useRef, ChangeEvent, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { Folder, VideoZip, getFolders, addFolder, addVideoZip, getSubfolders, getVideosByFolder, dbPromise } from '../lib/db';
import { Plus, Folder as FolderIcon, Loader2, Image as ImageIcon, Upload, FolderOpen, Download, Archive, Lock, Cloud, FolderPlus, HardDrive, Edit3, ExternalLink, RefreshCw, ArrowUpDown, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getVideoPreview } from '../lib/zip';
import { clsx } from 'clsx';
import { MegaImportModal } from './MegaImportModal';
import { LocalArchiveImportModal } from './LocalArchiveImportModal';
import { CreateFolderModal } from './CreateFolderModal';
import { RecentFolders } from './RecentFolders';
import { addRecentFolder } from '../lib/recentFolders';

function HoverVideoCarousel({ videos }: { videos: VideoZip[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Intersection Observer - only load when visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1, rootMargin: '50px' }
    );
    
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    
    return () => observer.disconnect();
  }, []);

  // Load URLs only when visible
  useEffect(() => {
    if (!isVisible) return;
    
    let isMounted = true;
    const cleanups: (() => void)[] = [];

    async function loadUrls() {
      // Limit to 3 videos max for memory efficiency
      for (let i = 0; i < Math.min(videos.length, 3); i++) {
        if (!isMounted) break;
        // Add small delay between loads to prevent memory spike
        await new Promise(r => setTimeout(r, i * 100));
        const res = await getVideoPreview(videos[i].file);
        if (res && isMounted) {
          setUrls(prev => ({ ...prev, [videos[i].id]: res.url }));
          cleanups.push(res.cleanup);
        } else if (res) {
          res.cleanup();
        }
      }
    }
    loadUrls();

    return () => {
      isMounted = false;
      cleanups.forEach(c => c());
    };
  }, [videos, isVisible]);

  useEffect(() => {
    if (videos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % Math.min(videos.length, 3));
    }, 4000); // Slower rotation
    return () => clearInterval(timer);
  }, [videos.length]);

  const currentVideo = videos[currentIndex];
  const currentUrl = currentVideo ? urls[currentVideo.id] : null;
  const displayCount = Math.min(videos.length, 3);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full bg-black/80 z-20">
      {currentUrl ? (
        <video
          key={currentUrl}
          src={currentUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
          <Loader2 className="animate-spin text-white/50" size={32} />
        </div>
      )}
      
      {displayCount > 1 && (
        <div className="absolute top-4 left-4 right-4 flex gap-1.5 z-30">
          {Array.from({ length: displayCount }).map((_, i) => (
            <div key={i} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
              {i === currentIndex && (
                <div
                  className="h-full bg-white animate-[progress_4s_linear]"
                />
              )}
              {i < currentIndex && <div className="h-full bg-white" />}
            </div>
          ))}
        </div>
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40 pointer-events-none z-20" />
    </div>
  );
}

function FolderCard({ folder, onClick, onLoad, onUpdate, columnIndex }: { folder: Folder, onClick: () => void, onLoad: () => void, onUpdate: () => void, columnIndex: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const [videos, setVideos] = useState<VideoZip[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isImage, setIsImage] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasLocalFolder, setHasLocalFolder] = useState(false);

  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [localFileCount, setLocalFileCount] = useState<number | null>(null);

  useEffect(() => {
    getVideosByFolder(folder.id).then((vids) => {
      // Only use videos for preview first, but fall back to photos if no videos
      const videoVids = vids.filter(v => !v.file.type.startsWith('image/'));
      const photoVids = vids.filter(v => v.file.type.startsWith('image/'));
      
      // Use first video if available, otherwise use first photo as fallback
      const previewItems = videoVids.length > 0 ? videoVids : photoVids;
      setVideos(previewItems);
      
      // Get preview for first available item
      if (previewItems.length > 0) {
        const firstItem = previewItems[0];
        const isImg = firstItem.file.type.startsWith('image/');
        setIsImage(isImg);
        getVideoPreview(firstItem.file).then((res) => {
          if (res) {
            setPreviewUrl(res.url);
          }
        });
      }
    });
    
    // Check if folder has local folder handle and count files
    import('../lib/fileSystem').then(({ getStoredDirectoryHandle }) => {
      getStoredDirectoryHandle(folder.id).then(async (handle) => {
        setHasLocalFolder(!!handle);
        if (handle) {
          // Count files in local directory
          try {
            let count = 0;
            const extensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.jfif'];
            // @ts-ignore
            for await (const entry of handle.values()) {
              if (entry.kind === 'file') {
                const ext = entry.name.toLowerCase();
                if (extensions.some(e => ext.endsWith(e))) {
                  count++;
                }
              }
            }
            setLocalFileCount(count);
          } catch (err) {
            console.error('Error counting local files:', err);
          }
        }
      });
    });
  }, [folder.id]);

  const videoCount = videos.filter(v => v.file.type.startsWith('video/') || !v.file.type.startsWith('image/')).length;
  const photoCount = videos.filter(v => v.file.type.startsWith('image/')).length;

  // Determine sync status by comparing app cache vs local folder
  const isSynced = hasLocalFolder && localFileCount !== null && localFileCount === videos.length;
  const hasContent = videos.length > 0;

  const handleSyncToLocal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSyncing || videos.length === 0) return;
    
    const { getStoredDirectoryHandle } = await import('../lib/fileSystem');
    const { saveFileToDirectory } = await import('../lib/fileSystem');
    const localHandle = await getStoredDirectoryHandle(folder.id);
    
    if (!localHandle) {
      alert('No local folder mounted for this gallery. Please mount a local folder first.');
      return;
    }
    
    setIsSyncing(true);
    let successCount = 0;
    let failCount = 0;
    
    for (const video of videos) {
      try {
        const isImageFile = video.file.type.startsWith('image/');
        let fileExt = '.mp4';
        if (isImageFile) {
          fileExt = video.file.type.includes('png') ? '.png' :
                    video.file.type.includes('gif') ? '.gif' :
                    video.file.type.includes('webp') ? '.webp' : '.jpg';
        } else {
          fileExt = video.file.type.includes('mp4') ? '.mp4' : 
                    video.file.type.includes('webm') ? '.webm' :
                    video.file.type.includes('quicktime') ? '.mov' :
                    video.file.type.includes('matroska') ? '.mkv' : '.mp4';
        }
        
        const fileName = `${video.name}${fileExt}`;
        const result = await saveFileToDirectory(localHandle, fileName, video.file);
        
        if (result.success) {
          const db = await dbPromise;
          const updatedVideo = { ...video, isCached: false, sourceType: 'local' as const };
          await db.put('videoZips', updatedVideo);
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error('Error syncing file:', err);
        failCount++;
      }
    }
    
    setIsSyncing(false);
    onUpdate();
    alert(`Sync complete: ${successCount} synced, ${failCount} failed.`);
  };

  const handleUnmount = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Unmount "${folder.name}"? This will remove the local folder link but keep your gallery.`)) {
      return;
    }
    
    const { removeDirectoryHandle } = await import('../lib/fileSystem');
    await removeDirectoryHandle(folder.id);
    setHasLocalFolder(false);
    setLocalFileCount(null);
    onUpdate();
  };

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOverCard = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if the drag contains a videoId (internal drag from another gallery)
    if (e.dataTransfer.types.includes('videoId') || e.dataTransfer.types.includes('text/plain')) {
      setIsDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeaveCard = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDropCard = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const videoId = e.dataTransfer.getData('videoId');
    const sourceFolderId = e.dataTransfer.getData('sourceFolderId');

    if (videoId && sourceFolderId && sourceFolderId !== folder.id) {
      // Move video to this folder
      try {
        const db = await dbPromise;
        const video = await db.get('videoZips', videoId);
        if (video) {
          video.folderId = folder.id;
          await db.put('videoZips', video);
          onUpdate(); // Refresh the gallery view
          alert(`Moved "${video.name}" to "${folder.name}"`);
        }
      } catch (err) {
        console.error('Error moving video:', err);
        alert('Failed to move video to this gallery');
      }
    }
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={handleDragOverCard}
      onDragLeave={handleDragLeaveCard}
      onDrop={handleDropCard}
      className={`group break-inside-avoid mb-4 cursor-pointer transition-all duration-300 ${isDragOver ? 'scale-105 ring-4 ring-emerald-500/50' : ''}`}
      onClick={onClick}
    >
      {/* Pinterest-style card with preview */}
      <div className="relative overflow-hidden transition-all duration-300">
        {/* Preview Image/Video */}
        <div className="relative aspect-[9/16] overflow-hidden">
          {previewUrl ? (
            isImage ? (
              <img
                src={previewUrl}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                alt={folder.name}
              />
            ) : (
              <video
                src={previewUrl}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                muted
                loop
                autoPlay
                playsInline
              />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FolderIcon size={48} className="text-zinc-600" />
            </div>
          )}
          
          {/* Delete button - top right, grey to red on hover */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${folder.name}" gallery?`)) {
                import('../lib/db').then(({ deleteFolder }) => {
                  deleteFolder(folder.id).then(() => onUpdate());
                });
              }
            }}
            className="absolute top-3 right-3 p-2 rounded-full bg-zinc-700/50 text-zinc-400 hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all z-20"
            title="Delete gallery"
          >
            <Trash2 size={16} />
          </button>
          
          {/* Hover actions */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLoad();
              }}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full text-white text-sm font-medium transition-all"
            >
              Open
            </button>
            {hasLocalFolder && (
              <button
                onClick={handleUnmount}
                className="p-2 bg-red-500/20 hover:bg-red-500/30 backdrop-blur-md rounded-full text-red-400 transition-all"
                title="Unmount local folder"
              >
                <ExternalLink size={16} />
              </button>
            )}
            {hasLocalFolder && videos.length > 0 && (
              <button
                onClick={handleSyncToLocal}
                disabled={isSyncing}
                className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 backdrop-blur-md rounded-full text-emerald-400 transition-all disabled:opacity-50"
                title="Sync to local folder"
              >
                {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            )}
          </div>
        </div>
        
        {/* Folder info below video - shows on hover */}
        <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <h3 className="text-white font-medium text-sm truncate">{folder.name} <span className="text-zinc-500">· {videoCount} videos{photoCount > 0 ? `, ${photoCount} photos` : ''}</span></h3>
        </div>
      </div>
    </div>
  );
}

export function GalleryView({ onSelectFolder, blurEnabled, theme }: { onSelectFolder: (id: string) => void, blurEnabled?: boolean, theme?: 'dark' | 'light' | 'futuristic' | 'smokey' }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderStats, setFolderStats] = useState<Map<string, { count: number; lastModified: number }>>(new Map());
  const [sortBy, setSortBy] = useState<'recent' | 'changed' | 'largest'>('recent');
  const [isUploading, setIsUploading] = useState(false);
  const [showMegaImport, setShowMegaImport] = useState(false);
  const [showLocalImport, setShowLocalImport] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    const allFolders = await getFolders();
    setFolders(allFolders);
    
    // Load stats for all folders
    const stats = new Map<string, { count: number; lastModified: number }>();
    for (const folder of allFolders) {
      const videos = await getVideosByFolder(folder.id);
      const count = videos.length;
      const lastModified = videos.length > 0 
        ? Math.max(...videos.map(v => v.createdAt || 0))
        : folder.createdAt;
      stats.set(folder.id, { count, lastModified });
    }
    setFolderStats(stats);
  };

  // Sort folders based on selected criteria
  const sortedFolders = useMemo(() => {
    const sorted = [...folders];
    switch (sortBy) {
      case 'recent':
        return sorted.sort((a, b) => b.createdAt - a.createdAt);
      case 'changed':
        return sorted.sort((a, b) => {
          const aModified = folderStats.get(a.id)?.lastModified || a.createdAt;
          const bModified = folderStats.get(b.id)?.lastModified || b.createdAt;
          return bModified - aModified;
        });
      case 'largest':
        return sorted.sort((a, b) => {
          const aCount = folderStats.get(a.id)?.count || 0;
          const bCount = folderStats.get(b.id)?.count || 0;
          return bCount - aCount;
        });
      default:
        return sorted;
    }
  }, [folders, folderStats, sortBy]);

  const handleCreateFolder = async (name: string) => {
    try {
      const trimmedName = name.trim();
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: trimmedName,
        createdAt: Date.now(),
      };
      await addFolder(newFolder);
      
      const setupLocal = confirm("Would you like to set up a local folder for this gallery on your desktop?");
      if (setupLocal) {
        try {
          const { initializeLocalFolder } = await import('../lib/fileSystem');
          const result = await initializeLocalFolder(newFolder.id, trimmedName);
          if (result.success) {
            alert(`Local folder created: ${result.path}`);
          } else {
            alert(result.error || 'Failed to create local folder. You can set it up later from the folder view.');
          }
        } catch (err) {
          console.error('Error setting up local folder:', err);
          alert('Error setting up local folder. You can set it up later from the folder view.');
        }
      }
      
      loadFolders();
    } catch (err) {
      console.error('Error creating folder:', err);
      alert('Failed to create folder. Please try again.');
    }
  };

  const handleMountLocalFolder = async () => {
    // Use File System Access API to mount folder, scan subdirectories, and import files
    const { requestLocalFolderAccess, storeDirectoryHandle } = await import('../lib/fileSystem');
    const { handle, error } = await requestLocalFolderAccess();
    
    if (!handle) {
      alert(error || 'Failed to mount folder');
      return;
    }
    
    setIsUploading(true);
    let folderCount = 0;
    let totalFileCount = 0;
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
    
    // Helper to check if a folder contains media files
    async function hasMediaFiles(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
      try {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const fileName = entry.name.toLowerCase();
            if (videoExtensions.some(ext => fileName.endsWith(ext)) ||
                imageExtensions.some(ext => fileName.endsWith(ext))) {
              return true;
            }
          }
        }
      } catch (err) {
        console.error('Error checking folder for media:', err);
        // Don't return false here - let it propagate to catch the real error
      }
      return false;
    }
    
    // Helper to get all nested subdirectories with media files
    async function getAllSubdirectoriesWithMedia(
      dirHandle: FileSystemDirectoryHandle, 
      parentPath: string = ''
    ): Promise<{ name: string; handle: FileSystemDirectoryHandle; path: string }[]> {
      const result: { name: string; handle: FileSystemDirectoryHandle; path: string }[] = [];
      const currentPath = parentPath ? `${parentPath}/${dirHandle.name}` : dirHandle.name;
      
      // First check if this directory has media
      const hasMedia = await hasMediaFiles(dirHandle);
      if (hasMedia) {
        result.push({ name: dirHandle.name, handle: dirHandle, path: currentPath });
      }
      
      // Then recursively check subdirectories
      try {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'directory') {
            try {
              const subdirs = await getAllSubdirectoriesWithMedia(entry, currentPath);
              result.push(...subdirs);
            } catch (subdirErr) {
              console.error(`Error scanning subdirectory ${entry.name}:`, subdirErr);
              // Continue with other subdirectories
            }
          }
        }
      } catch (err) {
        console.error('Error iterating directory values:', err);
        throw err; // Re-throw to catch in outer handler
      }
      
      return result;
    }
    
    try {
      // Helper to scan files in a directory handle
      async function scanDirectory(dirHandle: FileSystemDirectoryHandle, folderId: string) {
        let fileCount = 0;
        // @ts-ignore - FileSystemDirectoryHandle iteration
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const fileName = entry.name.toLowerCase();
            const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
            const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
            
            if (isVideo || isImage) {
              try {
                const file = await entry.getFile();
                const newVideo: VideoZip = {
                  id: crypto.randomUUID(),
                  folderId,
                  name: entry.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
                  file,
                  createdAt: Date.now(),
                  sourceType: 'local',
                  isCached: false,
                };
                const result = await addVideoZip(newVideo);
                if (result.success) fileCount++;
              } catch (err) {
                console.error('Error reading file:', entry.name, err);
              }
            }
          }
        }
        return fileCount;
      }
      
      // Get all subdirectories that contain media files (nested)
      console.log('Starting recursive scan of:', handle.name);
      const allSubdirs = await getAllSubdirectoriesWithMedia(handle);
      console.log('Found subdirectories:', allSubdirs.length, allSubdirs.map(s => s.path));
      
      // Filter to only include directories that actually have media files
      // (already filtered in the function, but double-check)
      const subdirsWithMedia = allSubdirs;
      
      // If no subdirectories with media, check root folder directly
      if (subdirsWithMedia.length === 0) {
        console.log('No subdirs found, checking root folder...');
        const rootHasMedia = await hasMediaFiles(handle);
        console.log('Root has media:', rootHasMedia);
        if (rootHasMedia) {
          subdirsWithMedia.push({ name: handle.name, handle, path: handle.name });
        }
      }
      
      console.log('Final folders to create:', subdirsWithMedia.length);
      
      // Create a folder for each subdirectory with media and scan files
      for (const subdir of subdirsWithMedia) {
        console.log('Creating gallery for:', subdir.name, 'at path:', subdir.path);
        const newFolder: Folder = {
          id: crypto.randomUUID(),
          name: subdir.name,
          localFolderPath: subdir.path,
          parentId: undefined,
          createdAt: Date.now(),
        };
        await addFolder(newFolder);
        await storeDirectoryHandle(newFolder.id, subdir.handle);
        
        // Scan and import files from this subdirectory
        const fileCount = await scanDirectory(subdir.handle, newFolder.id);
        console.log('Imported', fileCount, 'files from', subdir.name);
        totalFileCount += fileCount;
        folderCount++;
      }
      
      alert(`Mounted ${folderCount} folder(s) with ${totalFileCount} file(s) from: ${handle.name}`);
      loadFolders();
    } catch (err: any) {
      console.error('Error scanning directory:', err);
      const errorMessage = err?.message || 'Unknown error';
      const errorName = err?.name || 'Error';
      alert(`Error scanning folder: ${errorName}: ${errorMessage}. Please check browser console for details.`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFolderUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsUploading(true);
    
    const firstFile = files[0];
    const folderName = firstFile.webkitRelativePath.split('/')[0] || `Gallery ${Date.now()}`;
    
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      name: folderName,
      localFolderPath: firstFile.webkitRelativePath.split('/')[0],
      createdAt: Date.now(),
    };
    await addFolder(newFolder);
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.jfif'];
    let fileCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name.toLowerCase();
      
      const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
      const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
      
      if (isVideo || isImage) {
        const newVideo: VideoZip = {
          id: crypto.randomUUID(),
          folderId: newFolder.id,
          name: file.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
          file,
          createdAt: Date.now(),
          sourceType: 'local',
          isCached: false,
        };
        const result = await addVideoZip(newVideo);
        if (result.success) fileCount++;
      }
    }
    
    addRecentFolder({
      name: folderName,
      path: firstFile.webkitRelativePath.split('/')[0],
      fileCount: fileCount,
    });
    
    loadFolders();
    setIsUploading(false);
    
    if (fileCount > 0) {
      onSelectFolder(newFolder.id);
    } else {
      alert("No video or image files found in the selected folder.");
    }
    
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  // Handle drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    // Check if dropping a folder (File System Access API)
    const item = items[0];
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      
      if (entry && entry.isDirectory) {
        // Handle folder drop - use File System Access API if available
        await handleDroppedFolder(entry as FileSystemDirectoryEntry);
      } else {
        // Handle individual files drop
        const files = Array.from(e.dataTransfer.files) as File[];
        await handleDroppedFiles(files);
      }
    }
  }, []);

  const handleDroppedFolder = async (dirEntry: FileSystemDirectoryEntry) => {
    setIsUploading(true);
    
    try {
      // Try to get directory handle if available
      if ('requestPermission' in dirEntry) {
        // @ts-ignore - File System Access API
        const handle = await dirEntry.getAsFileSystemHandle();
        if (handle && handle.kind === 'directory') {
          // Use the mount logic with the dropped folder handle
          await processMountedFolder(handle as FileSystemDirectoryHandle);
          return;
        }
      }
      
      // Fallback: Read files using the older File API
      const folderName = dirEntry.name;
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: folderName,
        localFolderPath: folderName,
        createdAt: Date.now(),
      };
      await addFolder(newFolder);
      
      let fileCount = 0;
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
      
      const readDirectory = async (dirReader: any, path: string = '') => {
        // readEntries has a limit of 100 entries, need to call repeatedly
        let allEntries: any[] = [];
        let entries: any[];
        do {
          entries = await new Promise<any[]>((resolve) => {
            dirReader.readEntries((results: any[]) => resolve(results));
          });
          allEntries = allEntries.concat(entries);
        } while (entries.length > 0);
        
        for (const entry of allEntries) {
          if (entry.isFile) {
            const file = await new Promise<File>((resolve) => {
              entry.file((f: File) => resolve(f));
            });
            
            const fileName = file.name.toLowerCase();
            const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
            const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
            
            if (isVideo || isImage) {
              const newVideo: VideoZip = {
                id: crypto.randomUUID(),
                folderId: newFolder.id,
                name: file.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
                file,
                createdAt: Date.now(),
                sourceType: 'local',
                isCached: false,
              };
              await addVideoZip(newVideo);
              fileCount++;
            }
          } else if (entry.isDirectory) {
            await readDirectory(entry.createReader(), `${path}/${entry.name}`);
          }
        }
      };
      
      await readDirectory(dirEntry.createReader());
      
      addRecentFolder({
        name: folderName,
        path: folderName,
        fileCount: fileCount,
      });
      
      // Ensure all database operations are fully committed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await loadFolders();
      
      if (fileCount > 0) {
        alert(`Imported ${fileCount} file(s) from dropped folder: ${folderName}`);
      } else {
        alert("No video or image files found in the dropped folder.");
      }
    } catch (err) {
      console.error('Error processing dropped folder:', err);
      alert('Error processing dropped folder. Please try using the Upload button instead.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDroppedFiles = async (files: File[]) => {
    if (files.length === 0) return;
    
    setIsUploading(true);
    
    // Separate archives from regular files
    const archiveFiles: File[] = [];
    const regularFiles: File[] = [];
    
    for (const file of files) {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.zip') || fileName.endsWith('.7z') || fileName.endsWith('.rar')) {
        archiveFiles.push(file);
      } else {
        regularFiles.push(file);
      }
    }
    
    // Process archives first
    for (const archive of archiveFiles) {
      await processDroppedArchive(archive);
    }
    
    // Then process regular files as before
    if (regularFiles.length > 0) {
      await processDroppedRegularFiles(regularFiles);
    }
    
    loadFolders();
    setIsUploading(false);
  };

  // Process a dropped archive file (extract and import)
  const processDroppedArchive = async (file: File) => {
    console.log('Starting archive extraction:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB');
    
    try {
      const JSZipModule = await import('jszip');
      const JSZip = JSZipModule.default;
      
      // Read and load the zip file
      console.log('Reading archive file...');
      const arrayBuffer = await file.arrayBuffer();
      console.log('Archive loaded, parsing...');
      
      const zip = await JSZip.loadAsync(arrayBuffer);
      console.log('Archive parsed, files found:', Object.keys(zip.files).length);

      // Define media extensions
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];

      // Find all media files in the archive (skip MacOS system files)
      const mediaFiles: { name: string; zipEntry: JSZip.JSZipObject }[] = [];
      
      for (const [name, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        
        // Skip MacOS system files and hidden files
        if (name.includes('__MACOSX') || name.startsWith('._') || name.split('/').pop()?.startsWith('.')) {
          console.log(`Skipping system file: ${name}`);
          continue;
        }
        
        const fileName = name.toLowerCase();
        const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
        const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
        
        if (isVideo || isImage) {
          mediaFiles.push({ name, zipEntry });
        }
      }

      console.log('Media files found in archive:', mediaFiles.length);
      if (mediaFiles.length === 0) {
        console.log(`No media files found in archive: ${file.name}`);
        alert(`No media files found in "${file.name}". The archive may be empty or contain unsupported formats.`);
        return;
      }

      // Create new folder for the archive
      const folderName = file.name.replace(/\.(zip|7z|rar)$/i, '');
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: folderName,
        createdAt: Date.now(),
        isArchive: true,
      };

      console.log('Creating folder:', folderName);
      await addFolder(newFolder);

      // Extract and add each media file to the database (sequential to avoid race conditions)
      let processedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < mediaFiles.length; i++) {
        const { name, zipEntry } = mediaFiles[i];
        try {
          console.log(`Extracting: ${name} (${i + 1}/${mediaFiles.length})`);
          
          // Get file info first
          const fileInfo = await zipEntry.async('uint8array');
          console.log(`File size: ${(fileInfo.length / 1024 / 1024).toFixed(2)}MB`);
          
          if (fileInfo.length === 0) {
            console.warn(`Empty file skipped: ${name}`);
            continue;
          }
          
          // Create blob from uint8array for better memory handling
          const fileName = name.toLowerCase();
          const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
          
          let mimeType = 'application/octet-stream';
          if (isImage) {
            mimeType = fileName.endsWith('.png') ? 'image/png' :
                      fileName.endsWith('.gif') ? 'image/gif' :
                      fileName.endsWith('.webp') ? 'image/webp' :
                      fileName.endsWith('.bmp') ? 'image/bmp' :
                      fileName.endsWith('.tiff') || fileName.endsWith('.tif') ? 'image/tiff' :
                      fileName.endsWith('.svg') ? 'image/svg+xml' :
                      'image/jpeg';
          } else {
            mimeType = fileName.endsWith('.webm') ? 'video/webm' :
                      fileName.endsWith('.mov') ? 'video/quicktime' :
                      fileName.endsWith('.mkv') ? 'video/x-matroska' :
                      fileName.endsWith('.avi') ? 'video/x-msvideo' :
                      fileName.endsWith('.ogv') ? 'video/ogg' :
                      'video/mp4';
          }
          
          // Create blob directly from Uint8Array
          const blob = new Blob([fileInfo as unknown as BlobPart], { type: mimeType });
          
          // Create File object from blob
          const cleanName = name.split('/').pop() || name;
          // Keep extension for duplicate detection - different extensions = different files
          const nameForDuplicateCheck = cleanName;
          const cleanNameWithoutExt = cleanName.replace(/\.([^.]+)$/, '');
          const extractedFile = new File([blob], cleanName, { type: mimeType });
          
          // Create video zip entry
          const newVideo: VideoZip = {
            id: crypto.randomUUID(),
            folderId: newFolder.id,
            name: nameForDuplicateCheck, // Use full filename for duplicate detection
            file: extractedFile,
            createdAt: Date.now(),
            sourceType: 'local',
            isCached: false,
          };
          
          const result = await addVideoZip(newVideo);
          if (result.success) {
            processedCount++;
            console.log(`Successfully imported: ${cleanName}`);
          } else {
            console.log(`Skipped: ${cleanName} - ${result.message}`);
          }
        } catch (err) {
          errorCount++;
          console.error(`Error extracting file ${name}:`, err);
        }
      }

      console.log(`Extraction complete. Success: ${processedCount}, Errors: ${errorCount}`);
      
      // Ensure all database operations are fully committed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Force refresh the folders list to show the new folder
      await loadFolders();
      
      if (processedCount > 0) {
        alert(`Extracted ${processedCount} media files from "${file.name}"${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
      } else {
        alert(`Failed to extract any files from "${file.name}". Check console for errors.`);
      }
    } catch (err: any) {
      console.error('Error processing dropped archive:', err);
      const errorMsg = err?.message || err?.toString() || 'Unknown error';
      alert(`Failed to extract archive "${file.name}". Error: ${errorMsg}`);
    }
  };

  // Process regular non-archive files
  const processDroppedRegularFiles = async (files: File[]) => {
    // Try to detect if files are from the same folder
    const pathMap = new Map<string, File[]>();
    
    for (const file of files) {
      // Try to get relative path from webkitRelativePath
      const relativePath = (file as any).webkitRelativePath || '';
      const folderName = relativePath.split('/')[0] || 'Dropped Files';
      
      if (!pathMap.has(folderName)) {
        pathMap.set(folderName, []);
      }
      pathMap.get(folderName)!.push(file);
    }
    
    // Create a gallery for each unique folder
    for (const [folderName, folderFiles] of pathMap) {
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: folderName,
        localFolderPath: folderName,
        createdAt: Date.now(),
      };
      await addFolder(newFolder);
      
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
      
      let fileCount = 0;
      
      for (const file of folderFiles) {
        const fileName = file.name.toLowerCase();
        const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
        const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
        
        if (isVideo || isImage) {
          const newVideo: VideoZip = {
            id: crypto.randomUUID(),
            folderId: newFolder.id,
            name: file.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
            file,
            createdAt: Date.now(),
            sourceType: 'local',
            isCached: false,
          };
          const result = await addVideoZip(newVideo);
          if (result.success) fileCount++;
        }
      }
      
      addRecentFolder({
        name: folderName,
        path: folderName,
        fileCount: fileCount,
      });
    }
    
    // Ensure all database operations are fully committed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await loadFolders();
    alert(`Created ${pathMap.size} gallery(s) with dropped files.`);
  };

  // Process mounted folder using File System Access API (similar to handleMountLocalFolder)
  const processMountedFolder = async (handle: FileSystemDirectoryHandle) => {
    let folderCount = 0;
    let totalFileCount = 0;
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
    
    const { storeDirectoryHandle } = await import('../lib/fileSystem');
    
    // Helper to check if a folder contains media files
    async function hasMediaFiles(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
      try {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const fileName = entry.name.toLowerCase();
            if (videoExtensions.some(ext => fileName.endsWith(ext)) ||
                imageExtensions.some(ext => fileName.endsWith(ext))) {
              return true;
            }
          }
        }
      } catch (err) {
        console.error('Error checking folder for media:', err);
      }
      return false;
    }
    
    // Helper to get all nested subdirectories with media files
    async function getAllSubdirectoriesWithMedia(
      dirHandle: FileSystemDirectoryHandle, 
      parentPath: string = ''
    ): Promise<{ name: string; handle: FileSystemDirectoryHandle; path: string }[]> {
      const result: { name: string; handle: FileSystemDirectoryHandle; path: string }[] = [];
      const currentPath = parentPath ? `${parentPath}/${dirHandle.name}` : dirHandle.name;
      
      const hasMedia = await hasMediaFiles(dirHandle);
      if (hasMedia) {
        result.push({ name: dirHandle.name, handle: dirHandle, path: currentPath });
      }
      
      try {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'directory') {
            try {
              const subdirs = await getAllSubdirectoriesWithMedia(entry, currentPath);
              result.push(...subdirs);
            } catch (subdirErr) {
              console.error(`Error scanning subdirectory ${entry.name}:`, subdirErr);
            }
          }
        }
      } catch (err) {
        console.error('Error iterating directory values:', err);
      }
      
      return result;
    }
    
    // Helper to scan files in a directory handle
    async function scanDirectory(dirHandle: FileSystemDirectoryHandle, folderId: string) {
      let fileCount = 0;
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const fileName = entry.name.toLowerCase();
          const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
          const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
          
          if (isVideo || isImage) {
            try {
              const file = await entry.getFile();
              const newVideo: VideoZip = {
                id: crypto.randomUUID(),
                folderId,
                name: entry.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
                file,
                createdAt: Date.now(),
                sourceType: 'local',
                isCached: false,
              };
              await addVideoZip(newVideo);
              fileCount++;
            } catch (err) {
              console.error('Error reading file:', entry.name, err);
            }
          }
        }
      }
      return fileCount;
    }
    
    try {
      const allSubdirs = await getAllSubdirectoriesWithMedia(handle);
      const subdirsWithMedia = allSubdirs;
      
      if (subdirsWithMedia.length === 0) {
        const rootHasMedia = await hasMediaFiles(handle);
        if (rootHasMedia) {
          subdirsWithMedia.push({ name: handle.name, handle, path: handle.name });
        }
      }
      
      for (const subdir of subdirsWithMedia) {
        const newFolder: Folder = {
          id: crypto.randomUUID(),
          name: subdir.name,
          localFolderPath: subdir.path,
          parentId: undefined,
          createdAt: Date.now(),
        };
        await addFolder(newFolder);
        await storeDirectoryHandle(newFolder.id, subdir.handle);
        
        const fileCount = await scanDirectory(subdir.handle, newFolder.id);
        totalFileCount += fileCount;
        folderCount++;
      }
      
      alert(`Mounted ${folderCount} folder(s) with ${totalFileCount} file(s) from: ${handle.name}`);
      loadFolders();
    } catch (err: any) {
      console.error('Error processing dropped directory:', err);
      const errorMessage = err?.message || 'Unknown error';
      const errorName = err?.name || 'Error';
      alert(`Error processing dropped folder: ${errorName}: ${errorMessage}`);
    }
  };

  return (
    <div 
      className="w-full min-h-screen"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        type="file"
        webkitdirectory
        directory
        className="hidden"
        ref={folderInputRef}
        onChange={handleFolderUpload}
      />
      
      {/* Drag and drop overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-2xl bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center mb-4">
                <Upload size={48} className="text-amber-400" />
              </div>
              <p className="text-2xl font-semibold text-white mb-2">Drop files or folders here</p>
              <p className="text-zinc-400">Drop media files or entire folders to mount them</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Header bar */}
      <div className={clsx(
        "sticky top-0 z-50 px-4 py-3 backdrop-blur-xl border-b",
        theme === 'light' 
          ? "bg-neutral-100/80 border-black/5" 
          : "bg-[#020202]/80 border-white/[0.04]"
      )}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className={clsx(
              "text-lg font-semibold tracking-tight",
              theme === 'light' ? "text-zinc-900" : "text-white"
            )}>Galleries</h1>
            {/* Sort dropdown */}
            <div className="relative group">
              <button className={clsx(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all",
                theme === 'light' 
                  ? "bg-black/5 hover:bg-black/10 text-zinc-700" 
                  : "bg-white/10 hover:bg-white/15 text-zinc-300"
              )}>
                <ArrowUpDown size={12} />
                {sortBy === 'recent' && 'Recent'}
                {sortBy === 'changed' && 'Changed'}
                {sortBy === 'largest' && 'Largest'}
              </button>
              <div className={clsx(
                "absolute top-full left-0 mt-1 py-1 rounded-lg min-w-[120px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50",
                theme === 'light' 
                  ? "bg-white border border-black/10 shadow-lg" 
                  : "bg-zinc-900 border border-white/10 shadow-xl"
              )}>
                <button 
                  onClick={() => setSortBy('recent')}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs transition-colors",
                    sortBy === 'recent' 
                      ? (theme === 'light' ? "bg-black/5 text-zinc-900" : "bg-white/10 text-white")
                      : (theme === 'light' ? "text-zinc-600 hover:bg-black/5" : "text-zinc-400 hover:bg-white/5")
                  )}
                >
                  Most Recent
                </button>
                <button 
                  onClick={() => setSortBy('changed')}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs transition-colors",
                    sortBy === 'changed' 
                      ? (theme === 'light' ? "bg-black/5 text-zinc-900" : "bg-white/10 text-white")
                      : (theme === 'light' ? "text-zinc-600 hover:bg-black/5" : "text-zinc-400 hover:bg-white/5")
                  )}
                >
                  Recently Changed
                </button>
                <button 
                  onClick={() => setSortBy('largest')}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs transition-colors",
                    sortBy === 'largest' 
                      ? (theme === 'light' ? "bg-black/5 text-zinc-900" : "bg-white/10 text-white")
                      : (theme === 'light' ? "text-zinc-600 hover:bg-black/5" : "text-zinc-400 hover:bg-white/5")
                  )}
                >
                  Largest
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowMegaImport(true)}
              className="flex items-center gap-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 px-3 py-1.5 rounded-full transition-all backdrop-blur-xl border border-purple-500/20 text-xs"
            >
              <Download size={14} />
              Import MEGA
            </button>
            <button
              onClick={() => setShowLocalImport(true)}
              className="flex items-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-300 px-3 py-1.5 rounded-full transition-all backdrop-blur-xl border border-green-500/20 text-xs"
            >
              <FolderPlus size={14} />
              Import Archive
            </button>
            <button
              onClick={handleMountLocalFolder}
              disabled={isUploading}
              className="flex items-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-3 py-1.5 rounded-full transition-all backdrop-blur-xl border border-amber-500/20 disabled:opacity-50 text-xs"
            >
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Mount Local
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-3 py-1.5 rounded-full transition-all backdrop-blur-xl border border-blue-500/20 disabled:opacity-50 text-xs"
            >
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              Upload
            </button>
            <button
              onClick={() => setShowCreateFolder(true)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all text-xs border",
                theme === 'light'
                  ? "bg-black/10 hover:bg-black/15 text-zinc-900 border-black/10"
                  : "bg-white/10 hover:bg-white/15 text-white border-white/10"
              )}
            >
              <Plus size={14} />
              New
            </button>
          </div>
        </div>
      </div>

      {/* Pinterest masonry grid */}
      <div className={`px-4 py-6 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
        {sortedFolders.length > 0 ? (
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7 gap-4 [column-fill:_balance]">
            {sortedFolders.map((folder, i) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onClick={() => onSelectFolder(folder.id)}
                onLoad={() => onSelectFolder(folder.id)}
                onUpdate={loadFolders}
                columnIndex={i}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 text-zinc-500">
            <FolderIcon size={64} className="mb-6 opacity-30" />
            <p className="text-lg">No galleries yet. Create one to get started.</p>
          </div>
        )}
      </div>

      {/* Recent Folders */}
      <div className="px-4 pb-8">
        <RecentFolders 
          onReupload={(path) => {
            alert(`To re-sync "${path}", click "Upload Folder" and select the same folder again.`);
            folderInputRef.current?.click();
          }}
          isDarkMode={true}
        />
      </div>

      {showMegaImport && (
        <MegaImportModal
          folderId={null}
          onClose={() => setShowMegaImport(false)}
          onSuccess={(folderId) => {
            setShowMegaImport(false);
            loadFolders();
            onSelectFolder(folderId);
          }}
        />
      )}
      {showLocalImport && (
        <LocalArchiveImportModal
          onClose={() => setShowLocalImport(false)}
          onSuccess={(folderId) => {
            setShowLocalImport(false);
            loadFolders();
            onSelectFolder(folderId);
          }}
        />
      )}
      {showCreateFolder && (
        <CreateFolderModal
          isOpen={showCreateFolder}
          onClose={() => setShowCreateFolder(false)}
          onCreate={handleCreateFolder}
        />
      )}
    </div>
  );
}
