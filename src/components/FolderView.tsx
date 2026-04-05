import { useState, useEffect, useRef, ChangeEvent, DragEvent, MouseEvent } from 'react';
import { VideoZip, getVideosByFolder, addVideoZip, deleteVideoZip, deleteFolder, dbPromise, Folder, getSubfolders, addFolder, getFolderById, updateFolder } from '../lib/db';
import { ArrowLeft, Upload, Play, Cloud, RefreshCw, Loader2, Download, ImageIcon, Trash2, FolderPlus, FolderOpen, ChevronRight, Folder as FolderIcon, MoreVertical, HardDrive, CloudDownload, Calendar, Clock } from 'lucide-react';
import { CloudSyncModal } from './CloudSyncModal';
import { MegaImportModal } from './MegaImportModal';
import { Archive } from 'libarchive.js';
import { VirtualArchiveExplorer } from '../lib/archive';
import { initializeLocalFolder, saveFileToDirectory, getStoredDirectoryHandle } from '../lib/fileSystem';
import { extractExifData, getBestDate, groupPhotosByDate } from '../lib/exif';

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
  cleanup?: () => void;
}

function VideoCard({ video, onPlay, onViewImage, index, isMuted, onDelete }: { 
  video: VideoWithPreview; 
  onPlay: () => void;
  onViewImage?: () => void;
  index: number;
  isMuted?: boolean;
  onDelete?: (id: string, name: string) => void;
}) {
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(index < 12);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showDeleteButton, setShowDeleteButton] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const isImage = video.file.type.startsWith('image/');

  // Handle drag start
  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.setData('videoId', video.id);
    e.dataTransfer.setData('sourceFolderId', video.folderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };
  
  // Intersection Observer to detect when card is visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          // Always resume playing when visible
          if (videoRef.current && !isImage) {
            videoRef.current.play().catch(() => {});
          }
        } else {
          // Pause video when not visible to save resources
          if (videoRef.current) {
            videoRef.current.pause();
          }
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }
    
    return () => observer.disconnect();
  }, [isImage]);

  useEffect(() => {
    if (videoRef.current && isVisible && video.previewUrl && !isImage) {
      const playVideo = async () => {
        try {
          videoRef.current!.muted = true; // Ensure muted for autoplay
          await videoRef.current!.play();
        } catch (err) {
          console.log('Autoplay blocked:', err);
        }
      };
      playVideo();
    }
  }, [isVisible, video.previewUrl, isImage]);

  const shouldRenderPreview = video.previewUrl && !hasError && isVisible;

  const handleClick = () => {
    if (isImage) {
      setShowImageModal(true);
    } else {
      onPlay();
    }
  };

  return (
    <>
      <div 
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`relative overflow-hidden cursor-move break-inside-avoid mb-1 group ${isDragging ? 'opacity-50 scale-95' : ''}`}
        onClick={handleClick}
      >
        <div className="w-full bg-black relative">
          {shouldRenderPreview ? (
            isImage ? (
              <img
                src={video.previewUrl}
                className="w-full h-auto object-cover"
                alt={video.name}
                onError={() => setHasError(true)}
              />
            ) : (
              <video
                ref={videoRef}
                src={video.previewUrl}
                className="w-full h-auto object-cover"
                muted
                loop
                playsInline
                preload="auto"
                onError={() => setHasError(true)}
              />
            )
          ) : (
            <div className="w-full aspect-[9/16] bg-zinc-800 flex items-center justify-center">
              <Play size={32} className="text-zinc-600" />
            </div>
          )}
        </div>
        
        {/* Hidden delete corner - click top-right to reveal delete button */}
        {onDelete && (
          <>
            {/* Invisible click area in top-right corner */}
            <div 
              className="absolute top-0 right-0 w-12 h-12 z-20 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteButton(!showDeleteButton);
              }}
            />
            {/* Delete button - only visible when corner clicked */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(video.id, video.name);
                setShowDeleteButton(false);
              }}
              className={`absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all z-10 shadow-lg ${showDeleteButton ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}`}
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      
      {/* Image Modal with delete option */}
      {showImageModal && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
          onClick={() => setShowImageModal(false)}
        >
          {/* Top bar with actions */}
          <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
            <span className="text-white/70 text-sm truncate max-w-[50%]">{video.name}</span>
            <div className="flex items-center gap-3">
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${video.name}"?`)) {
                      onDelete(video.id, video.name);
                      setShowImageModal(false);
                    }
                  }}
                  className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-full transition-all"
                  title="Delete"
                >
                  <Trash2 size={20} />
                </button>
              )}
              <button 
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowImageModal(false);
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <img 
            src={video.previewUrl} 
            alt={video.name}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

export function FolderView({ folderId, onBack, onPlayVideo, blurEnabled, isDarkMode = true, onNavigateToFolder, isMuted, theme }: { folderId: string, onBack: () => void, onPlayVideo: (blob: Blob, videoId: string) => void, blurEnabled?: boolean, isDarkMode?: boolean, onNavigateToFolder?: (folderId: string) => void, isMuted?: boolean, theme?: 'dark' | 'light' | 'futuristic' | 'smokey' }) {
  const [videos, setVideos] = useState<VideoWithPreview[]>([]);
  const [folderName, setFolderName] = useState('');
  const [folder, setFolder] = useState<Folder | null>(null);
  const [subfolders, setSubfolders] = useState<Folder[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showCloudSync, setShowCloudSync] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMegaImport, setShowMegaImport] = useState(false);
  const [localFolderHandle, setLocalFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isInitializingFolder, setIsInitializingFolder] = useState(false);
  const [isUploadingFolder, setIsUploadingFolder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [groupedPhotos, setGroupedPhotos] = useState<Map<string, VideoWithPreview[]>>(new Map());
  const [isLoadingDates, setIsLoadingDates] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const folderContentsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      videos.forEach(v => v.cleanup?.());
    };
  }, [videos]);

  useEffect(() => {
    loadData();
    initializeFolder();
  }, [folderId]);

  async function initializeFolder() {
    // Try to get existing local folder handle
    const existingHandle = await getStoredDirectoryHandle(folderId);
    if (existingHandle) {
      setLocalFolderHandle(existingHandle);
      return;
    }
  }

  const handleSetupLocalFolder = async () => {
    setIsInitializingFolder(true);
    try {
      const folderData = await getFolderById(folderId);
      if (!folderData) return;
      
      const result = await initializeLocalFolder(folderId, folderData.name);
      if (result.success && result.handle) {
        setLocalFolderHandle(result.handle);
        alert(`Local folder created: ${result.path}`);
      } else {
        alert(result.error || 'Failed to create local folder. Make sure to select a directory with write permissions.');
      }
    } finally {
      setIsInitializingFolder(false);
    }
  };

  const handleDownloadVideo = async (video: VideoWithPreview) => {
    if (!localFolderHandle) {
      const shouldSetup = confirm('No local folder set up. Would you like to set up a local folder now?');
      if (shouldSetup) {
        await handleSetupLocalFolder();
      }
      return;
    }

    try {
      // Determine file extension
      const fileExt = video.file.type.includes('mp4') ? '.mp4' : 
                      video.file.type.includes('webm') ? '.webm' :
                      video.file.type.includes('quicktime') ? '.mov' :
                      video.file.type.includes('matroska') ? '.mkv' : '.mp4';
      
      const fileName = `${video.name}${fileExt}`;
      const result = await saveFileToDirectory(localFolderHandle, fileName, video.file);
      
      if (result.success) {
        // Update video to mark as saved locally
        const db = await dbPromise;
        const updatedVideo = { ...video, isCached: false, sourceType: 'local' as const };
        await db.put('videoZips', updatedVideo);
        
        alert(`Video saved to local folder: ${fileName}`);
        loadData(); // Refresh to update indicators
      } else {
        alert(`Failed to save video: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error saving video:', err);
      alert('Error saving video to local folder.');
    }
  };

  const handleSyncAllToLocal = async () => {
    if (!localFolderHandle) {
      const shouldSetup = confirm('No local folder set up. Would you like to set up a local folder now?');
      if (shouldSetup) {
        await handleSetupLocalFolder();
      }
      return;
    }

    // Verify we still have permission to write to the folder
    try {
      // @ts-ignore - test permission by trying to access
      await localFolderHandle.values().next();
    } catch (permErr) {
      // Permission lost, try to re-request
      if (localFolderHandle.requestPermission) {
        const permission = await localFolderHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          alert('Permission denied to access local folder. Please unmount and remount the folder.');
          return;
        }
      } else {
        alert('Lost access to local folder. Please unmount and remount the folder.');
        return;
      }
    }

    // Sync ALL videos/photos to the mounted local folder
    if (videos.length === 0) {
      alert('No files in this folder to sync.');
      return;
    }

    const photoCount = videos.filter(v => v.file.type.startsWith('image/')).length;
    const videoCount = videos.length - photoCount;
    const fileLabel = photoCount > 0 && videoCount > 0 ? 'file' : photoCount > 0 ? 'photo' : 'video';

    const confirmSync = confirm(`Sync ${videos.length} ${fileLabel}(s) to the mounted local folder?`);
    if (!confirmSync) return;

    setIsSyncing(true);
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    console.log('Starting sync to local folder:', localFolderHandle.name);
    console.log('Total videos to process:', videos.length);

    for (const video of videos) {
      try {
        console.log('Processing video:', video.name, 'sourceType:', video.sourceType, 'isCached:', video.isCached);
        
        // Determine file extension based on type
        const isImage = video.file.type.startsWith('image/');
        let fileExt = '.mp4';
        if (isImage) {
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
        console.log('Saving file:', fileName, 'to folder:', localFolderHandle.name);
        const result = await saveFileToDirectory(localFolderHandle, fileName, video.file);
        console.log('Save result:', result);
        
        if (result.success) {
          const db = await dbPromise;
          const updatedVideo = { ...video, isCached: false, sourceType: 'local' as const };
          await db.put('videoZips', updatedVideo);
          successCount++;
          console.log('Successfully synced:', fileName);
        } else {
          failCount++;
          console.error('Failed to sync:', fileName, result.error);
        }
      } catch (err) {
        console.error('Error syncing file:', err);
        failCount++;
      }
    }

    setIsSyncing(false);
    await loadData();
    
    let message = '';
    if (successCount > 0) {
      message += `Successfully synced ${successCount} file(s) to local folder.`;
    }
    if (skipCount > 0) {
      message += ` ${skipCount} skipped.`;
    }
    if (failCount > 0) {
      message += ` ${failCount} failed.`;
    }
    
    console.log('Sync complete. Success:', successCount, 'Failed:', failCount, 'Skipped:', skipCount);
    alert(message || 'Sync complete.');
  };

  const loadData = async () => {
    const db = await dbPromise;
    const folderData = await db.get('folders', folderId);
    if (folderData) {
      setFolder(folderData);
      setFolderName(folderData.name);
    }
    
    // Load subfolders
    const childFolders = await getSubfolders(folderId);
    setSubfolders(childFolders);
    
    const vids = await getVideosByFolder(folderId);
    
    // Fix file types for videos that might have lost their type (from archive extraction)
    const fixedVids = vids.map(video => {
      if (!video.file.type || video.file.type === 'application/octet-stream') {
        // Infer type from filename
        const name = video.name.toLowerCase();
        let mimeType = '';
        if (name.endsWith('.mp4') || name.endsWith('.m4v') || name.endsWith('.mcgi')) mimeType = 'video/mp4';
        else if (name.endsWith('.webm')) mimeType = 'video/webm';
        else if (name.endsWith('.mov')) mimeType = 'video/quicktime';
        else if (name.endsWith('.mkv')) mimeType = 'video/x-matroska';
        else if (name.endsWith('.avi')) mimeType = 'video/x-msvideo';
        else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (name.endsWith('.png')) mimeType = 'image/png';
        else if (name.endsWith('.gif')) mimeType = 'image/gif';
        else if (name.endsWith('.webp')) mimeType = 'image/webp';
        else if (name.endsWith('.bmp')) mimeType = 'image/bmp';
        
        if (mimeType) {
          // Create new File with correct type - use original filename from video.file if available
          const originalName = (video.file as File).name || video.name;
          const newFile = new File([video.file], originalName, { type: mimeType });
          return { ...video, file: newFile };
        }
      }
      return video;
    });
    
    // Generate previews for ALL videos (Grok style)
    const withPreviews = await Promise.all(
      fixedVids.map(async (video) => {
        try {
          console.log(`Generating preview for ${video.name}, file type: ${video.file.type}, size: ${video.file.size}`);
          const result = await getVideoPreview(video.file);
          if (!result) {
            console.warn(`No preview generated for ${video.name}`);
          } else {
            console.log(`Preview generated for ${video.name}: ${result.url.substring(0, 50)}...`);
          }
          return {
            ...video,
            previewUrl: result?.url,
            cleanup: result?.cleanup
          };
        } catch (err) {
          console.error(`Error generating preview for ${video.name}:`, err);
          return { ...video };
        }
      })
    );
    
    console.log(`Loaded ${withPreviews.length} videos, ${withPreviews.filter(v => v.previewUrl).length} with previews`);
    setVideos(withPreviews);
    
    // Process photo grouping if enabled
    if (folderData?.groupByDate) {
      await processPhotoGroups(withPreviews);
    }
  }
  
  const processPhotoGroups = async (allVideos: VideoWithPreview[]) => {
    setIsLoadingDates(true);
    const photos = allVideos.filter(v => v.file.type.startsWith('image/') && v.previewUrl);
    
    // Extract EXIF dates for all photos
    const photosWithDates = await Promise.all(
      photos.map(async (photo) => {
        try {
          const exifData = await extractExifData(photo.file as File);
          const date = getBestDate(exifData);
          return { ...photo, date };
        } catch {
          return { ...photo, date: undefined };
        }
      })
    );
    
    const timeGap = folder?.timeGapMinutes || 240; // Default 4 hours
    const groups = groupPhotosByDate(photosWithDates, timeGap);
    setGroupedPhotos(groups);
    setIsLoadingDates(false);
  };
  
  const handleToggleGroupByDate = async () => {
    if (!folder) return;
    
    const newValue = !folder.groupByDate;
    const updatedFolder = { ...folder, groupByDate: newValue };
    await updateFolder(updatedFolder);
    setFolder(updatedFolder);
    
    if (newValue) {
      // Enable grouping - process photos
      await processPhotoGroups(videos);
    } else {
      // Disable grouping - clear groups
      setGroupedPhotos(new Map());
    }
  };

  const processFiles = async (files: FileList) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
    let fileCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name.toLowerCase();
      const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
      const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
      const isZip = fileName.endsWith('.zip');
      
      if (!isVideo && !isImage && !isZip) continue;

      const newVideo: VideoZip = {
        id: crypto.randomUUID(),
        folderId,
        name: file.name.replace(/\.(zip|mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
        file,
        createdAt: Date.now(),
        sourceType: 'local',
        isCached: false,
      };
      await addVideoZip(newVideo);
      fileCount++;
    }
    await loadData();
    setIsUploading(false);
    
    if (fileCount > 0) {
      alert(`Added ${fileCount} file(s) to gallery.`);
    }
  };

  const handleUploadZip = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadFolderContents = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsUploadingFolder(true);
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
    let fileCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name.toLowerCase();
      const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
      const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
      const isZip = fileName.endsWith('.zip');
      
      if (!isVideo && !isImage && !isZip) continue;

      const newVideo: VideoZip = {
        id: crypto.randomUUID(),
        folderId,
        name: file.name.replace(/\.(zip|mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
        file,
        createdAt: Date.now(),
        sourceType: 'local',
        isCached: false,
      };
      await addVideoZip(newVideo);
      fileCount++;
    }
    
    await loadData();
    setIsUploadingFolder(false);
    
    if (fileCount > 0) {
      alert(`Added ${fileCount} file(s) from folder to gallery.`);
    } else {
      alert("No video or image files found in the selected folder.");
    }
    
    if (folderContentsInputRef.current) folderContentsInputRef.current.value = '';
  };

  const handleRefreshFolder = async () => {
    setIsRefreshing(true);
    try {
      await loadData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleUploadCover = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    
    const db = await dbPromise;
    const folder = await db.get('folders', folderId);
    if (folder) {
      folder.coverImage = file;
      await db.put('folders', folder);
    }
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleDelete = async (id: string, name?: string) => {
    const itemName = name || 'this item';
    if (confirm(`Delete "${itemName}"?`)) {
      await deleteVideoZip(id);
      await loadData();
    }
  };

  const handleDeleteFolder = async () => {
    if (confirm("Delete this gallery and all its videos and subfolders?")) {
      await deleteFolder(folderId);
      onBack();
    }
  };

  const handleCreateSubfolder = async () => {
    const name = prompt("Enter subfolder name:");
    if (!name || name.trim() === '') return;
    
    try {
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: name.trim(),
        parentId: folderId,
        createdAt: Date.now(),
      };
      
      await addFolder(newFolder);
      
      // Optionally create local folder if parent has local folder set up
      if (localFolderHandle) {
        const createLocal = confirm("Also create this subfolder in your local directory?");
        if (createLocal) {
          try {
            await localFolderHandle.getDirectoryHandle(name.trim(), { create: true });
          } catch (err) {
            console.error('Error creating local subfolder:', err);
          }
        }
      }
      
      await loadData();
    } catch (err) {
      console.error('Error creating subfolder:', err);
      alert('Failed to create subfolder. Please try again.');
    }
  };

  const handleExtractArchive = async () => {
    if (!folder?.isArchive || !folder.archiveFile) {
      alert('This is not an archive folder');
      return;
    }

    const confirmExtract = confirm(`Extract all media files from ${folder.name}? This may take a while for large archives.`);
    if (!confirmExtract) return;

    setIsExtracting(true);
    let password = folder.archivePassword || '';
    
    try {
      // Initialize libarchive
      await Archive.init({
        workerUrl: '/libarchive.js/worker-bundle.js'
      });

      // Open the archive
      let archive = await Archive.open(folder.archiveFile);
      
      // Try to get files - if it fails, might need password
      let files: any[] = [];
      try {
        files = await archive.getFilesArray();
      } catch (err: any) {
        // Check if password is needed
        if (err?.message?.toLowerCase().includes('password') || 
            err?.message?.toLowerCase().includes('encrypted') ||
            err?.toString()?.toLowerCase().includes('password')) {
          // Prompt for password
          password = prompt('This archive is password protected. Enter password:') || '';
          if (!password) {
            alert('Password required to extract archive');
            setIsExtracting(false);
            return;
          }
          // Re-open with password
          archive = await Archive.open(folder.archiveFile);
          files = await archive.getFilesArray();
          // Save password for future use
          if (folder) {
            const updatedFolder = { ...folder, archivePassword: password };
            await updateFolder(updatedFolder);
            setFolder(updatedFolder);
          }
        } else {
          throw err;
        }
      }
      
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
      
      // Filter media files
      const mediaFiles = files.filter((item: any) => {
        const name = item.file.name.toLowerCase();
        return videoExtensions.some(ext => name.endsWith(ext)) || 
               imageExtensions.some(ext => name.endsWith(ext));
      });

      let extractedCount = 0;
      const totalFiles = mediaFiles.length;

      // Extract each media file
      for (const item of mediaFiles) {
        try {
          let extractedFile;
          try {
            extractedFile = await item.file.extract(password);
          } catch (extractErr: any) {
            // If extract fails, might need password
            if (extractErr?.message?.toLowerCase().includes('password') && !password) {
              password = prompt('Password required to extract files. Enter password:') || '';
              if (!password) continue; // Skip this file
              extractedFile = await item.file.extract(password);
              // Save password for remaining files
              if (folder) {
                const updatedFolder = { ...folder, archivePassword: password };
                await updateFolder(updatedFolder);
                setFolder(updatedFolder);
              }
            } else {
              throw extractErr;
            }
          }
          
          // Determine mime type
          const fileName = item.file.name.toLowerCase();
          let mimeType = 'application/octet-stream';
          if (fileName.endsWith('.mp4')) mimeType = 'video/mp4';
          else if (fileName.endsWith('.webm')) mimeType = 'video/webm';
          else if (fileName.endsWith('.mov')) mimeType = 'video/quicktime';
          else if (fileName.endsWith('.mkv')) mimeType = 'video/x-matroska';
          else if (fileName.endsWith('.avi')) mimeType = 'video/x-msvideo';
          else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (fileName.endsWith('.png')) mimeType = 'image/png';
          else if (fileName.endsWith('.gif')) mimeType = 'image/gif';
          else if (fileName.endsWith('.webp')) mimeType = 'image/webp';
          
          // Create new video entry
          const newVideo: VideoZip = {
            id: crypto.randomUUID(),
            folderId,
            name: item.file.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
            file: new File([extractedFile], item.file.name, { type: mimeType }),
            createdAt: Date.now(),
            sourceType: 'local',
            isCached: false,
          };
          
          await addVideoZip(newVideo);
          extractedCount++;
          
          // Update progress every 5 files
          if (extractedCount % 5 === 0) {
            console.log(`Extracted ${extractedCount}/${totalFiles} files...`);
          }
        } catch (err) {
          console.error(`Failed to extract ${item.file.name}:`, err);
        }
      }

      await loadData();
      alert(`Successfully extracted ${extractedCount} files from archive!`);
    } catch (err) {
      console.error('Error extracting archive:', err);
      alert('Failed to extract archive. It may be password protected or corrupted.');
    } finally {
      setIsExtracting(false);
    }
  };

  // Filter videos and photos - only show items with previews
  const videoItems = videos.filter(v => !v.file.type.startsWith('image/') && v.previewUrl);
  const photoItems = videos.filter(v => v.file.type.startsWith('image/') && v.previewUrl);
  
  // Debug: log items without previews
  const videosWithoutPreviews = videos.filter(v => !v.previewUrl);
  if (videosWithoutPreviews.length > 0) {
    console.warn(`${videosWithoutPreviews.length} items without previews:`, videosWithoutPreviews.map(v => ({ name: v.name, type: v.file.type, size: v.file.size })));
  }

  return (
    <div 
      className={`p-0 w-full min-h-full relative transition-colors duration-300 ${isDragging ? 'bg-emerald-500/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm border-4 border-dashed border-emerald-500/50 rounded-[3rem] m-6 pointer-events-none">
          <div className="flex flex-col items-center text-emerald-400">
            <Upload size={64} className="mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold tracking-tight">Drop video files here</h2>
            <p className="text-emerald-400/70 mt-2">MP4, WebM, MOV, MKV, AVI</p>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={48} className="animate-spin text-emerald-400" />
            <p className="text-white font-medium">Uploading files...</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 px-6 py-4">
        <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-semibold text-white tracking-tight">{folderName}</h1>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          {videoItems.length > 0 && (
            <span className="flex items-center gap-1">
              <Play size={14} />
              {videoItems.length} video{videoItems.length !== 1 ? 's' : ''}
            </span>
          )}
          {videoItems.length > 0 && photoItems.length > 0 && <span className="text-zinc-600">|</span>}
          {photoItems.length > 0 && (
            <span className="flex items-center gap-1">
              <ImageIcon size={14} />
              {photoItems.length} photo{photoItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Subfolders Section */}
      {subfolders.length > 0 && (
        <div className={`px-6 mb-4 ${blurEnabled ? 'blur-[20px]' : ''}`}>
          <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
            {subfolders.map((subfolder) => (
              <button
                key={subfolder.id}
                onClick={() => handleNavigateToSubfolder(subfolder.id)}
                className="group shrink-0 flex items-center gap-2 px-4 py-2 bg-zinc-900/80 hover:bg-zinc-800/80 rounded-full text-sm text-white transition-all"
              >
                <FolderOpen size={16} className="text-zinc-400" />
                <span className="truncate max-w-[120px]">{subfolder.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto ${isDarkMode ? 'bg-black' : 'bg-white'}`}>
        {/* Videos Section */}
        <div className={`columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-1 ${blurEnabled ? 'blur-[20px]' : ''}`}>
          {videoItems.map((video, index) => (
            <VideoCard 
              key={video.id}
              video={video} 
              index={index}
              onPlay={() => onPlayVideo(video.file, video.id)}
              isMuted={isMuted}
              onDelete={(id, name) => handleDelete(id, name)}
            />
          ))}
        </div>
        
        {/* Photos Section */}
        {photoItems.length > 0 && (
          <>
            <div className="px-4 py-4">
              <h2 className="text-lg font-medium text-zinc-400">Photos</h2>
              <div className="h-px bg-zinc-800 mt-2" />
            </div>
            <div className={`columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-1 px-4 pb-8 ${blurEnabled ? 'blur-[20px]' : ''}`}>
              {photoItems.map((photo, index) => (
                <VideoCard 
                  key={photo.id}
                  video={photo} 
                  index={index}
                  onPlay={() => onPlayVideo(photo.file, photo.id)}
                  isMuted={isMuted}
                  onDelete={(id, name) => handleDelete(id, name)}
                />
              ))}
            </div>
          </>
        )}
        
        {videos.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-32 text-zinc-400">
            <p className="text-lg">No videos or photos yet</p>
          </div>
        )}
      </div>

      {/* Floating bottom bar - Grok style */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
        <div className="bg-zinc-900/90 backdrop-blur-xl rounded-full px-4 py-3 flex items-center gap-3 shadow-2xl border border-white/10">
          {/* Hidden file inputs */}
          <input type="file" accept=".zip,video/mp4,video/webm,video/quicktime,video/x-matroska,video/avi,video/x-m4v,image/jpeg,image/png,image/gif,image/webp,image/jpg" multiple className="hidden" ref={fileInputRef} onChange={handleUploadZip} />
          <input type="file" webkitdirectory directory className="hidden" ref={folderContentsInputRef} onChange={handleUploadFolderContents} />
          
          <div className="group relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <Upload size={20} className="text-white" />
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Upload Media
            </span>
          </div>
          
          <div className="group relative">
            <button
              onClick={() => folderContentsInputRef.current?.click()}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <FolderOpen size={20} className="text-zinc-400" />
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Upload Folder
            </span>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <input 
              type="text" 
              placeholder="Drop videos & images here or click upload..."
              className="flex-1 bg-transparent text-white placeholder-zinc-500 outline-none text-sm"
              readOnly
            />
          </div>

          <div className="group relative">
            <button
              onClick={() => setShowMegaImport(true)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <Download size={20} className="text-purple-400" />
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Import from MEGA
            </span>
          </div>

          <div className="group relative">
            <button
              onClick={handleRefreshFolder}
              disabled={isRefreshing}
              className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
            >
              {isRefreshing ? <Loader2 size={20} className="animate-spin text-zinc-400" /> : <RefreshCw size={20} className="text-zinc-400" />}
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Refresh
            </span>
          </div>

          <div className="group relative">
            {localFolderHandle && (
              <button
                onClick={handleSyncAllToLocal}
                disabled={isSyncing}
                className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
              >
                {isSyncing ? <Loader2 size={20} className="animate-spin text-emerald-400" /> : <CloudDownload size={20} className="text-emerald-400" />}
              </button>
            )}
            {localFolderHandle && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {isSyncing ? 'Syncing...' : 'Sync All to Local'}
              </span>
            )}
          </div>

          <div className="group relative">
            {folder?.isArchive && (
              <button
                onClick={handleExtractArchive}
                disabled={isExtracting}
                className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
              >
                {isExtracting ? <Loader2 size={20} className="animate-spin text-blue-400" /> : <Download size={20} className="text-blue-400" />}
              </button>
            )}
            {folder?.isArchive && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {isExtracting ? 'Extracting...' : 'Extract Archive'}
              </span>
            )}
          </div>

          <div className="group relative">
            {!localFolderHandle ? (
              <button
                onClick={handleSetupLocalFolder}
                disabled={isInitializingFolder}
                className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
              >
                {isInitializingFolder ? <Loader2 size={20} className="animate-spin text-amber-400" /> : <HardDrive size={20} className="text-amber-400" />}
              </button>
            ) : (
              <div className="p-2">
                <HardDrive size={20} className="text-emerald-400" />
              </div>
            )}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              {localFolderHandle ? 'Local Folder Active' : 'Set Up Local Folder'}
            </span>
          </div>

          <div className="group relative">
            <button
              onClick={handleCreateSubfolder}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <FolderPlus size={20} className="text-zinc-400" />
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              New Subfolder
            </span>
          </div>

          <div className="group relative">
            <button
              onClick={handleDeleteFolder}
              className="p-2 hover:bg-red-500/20 rounded-full transition-colors"
            >
              <Trash2 size={20} className="text-red-400" />
            </button>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Delete Gallery
            </span>
          </div>
        </div>
      </div>
      {showMegaImport && (
        <MegaImportModal
          folderId={folderId}
          onClose={() => setShowMegaImport(false)}
          onSuccess={(newFolderId, count) => {
            setShowMegaImport(false);
            loadData();
          }}
        />
      )}
      {showCloudSync && (
        <CloudSyncModal
          folderId={folderId}
          folderName={folderName}
          onClose={() => setShowCloudSync(false)}
        />
      )}
    </div>
  );
}
