import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Archive, Folder, ArrowLeft, ChevronRight, FileVideo, Image, Lock, ShieldAlert, AlertTriangle } from 'lucide-react';
import { getVideosByFolder, getFolderById, VideoZip, Folder as FolderType, saveArchivePreview, getArchivePreviewsByFolder, addVideoZip } from '../lib/db';
import { AnalysisResult, analyzeFileForForensics } from '../lib/forensics';
import { extract7z } from '../lib/archive7z';
import { deleteVideoZip } from '../lib/db';

interface FolderPreviewProps {
  folderId: string;
  onBack: () => void;
  onViewContents: () => void;
  onPlayVideo: (blob: Blob, videoId: string, videoName?: string) => void;
  blurEnabled?: boolean;
  isMuted?: boolean;
  refreshTrigger?: number;
}

interface VideoWithPreview extends VideoZip {
  previewUrl?: string;
  sourceArchiveId?: string;
  sourceArchiveName?: string;
  cleanup?: () => void;
}

// Helper to get archive type from filename
const getArchiveType = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.gz')) return 'gz';
  return 'unknown';
};

// Helper to detect archive files
const isArchiveFile = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return lower.endsWith('.7z') || lower.endsWith('.zip') || lower.endsWith('.rar') || 
         lower.endsWith('.tar') || lower.endsWith('.gz') || lower.endsWith('.bz2');
};

// Helper to detect video/image files
const isMediaFile = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  // Exclude system files
  if (lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini') return false;
  const videoExts = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
  return videoExts.some(ext => lower.endsWith(ext)) || imageExts.some(ext => lower.endsWith(ext));
};

export function FolderPreview({ folderId, onBack, onViewContents, onPlayVideo, blurEnabled, isMuted, refreshTrigger }: FolderPreviewProps) {
  const [folder, setFolder] = useState<FolderType | null>(null);
  const [videos, setVideos] = useState<VideoWithPreview[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<VideoZip[]>([]);
  const [mediaFiles, setMediaFiles] = useState<VideoWithPreview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedArchive, setSelectedArchive] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [extractedFiles, setExtractedFiles] = useState<VideoWithPreview[]>([]);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingArchive, setPendingArchive] = useState<VideoZip | null>(null);
  const [forensicResults, setForensicResults] = useState<Map<string, AnalysisResult>>(new Map());
  const [showForensicPanel, setShowForensicPanel] = useState(false);
  const [extractedArchivePreviews, setExtractedArchivePreviews] = useState<Map<string, string[]>>(new Map());
  const [currentSlideIndex, setCurrentSlideIndex] = useState<Map<string, number>>(new Map());
  const [bulkPasswordModalOpen, setBulkPasswordModalOpen] = useState(false);
  const [bulkPasswordInput, setBulkPasswordInput] = useState('');
  const [pendingArchivesForBulk, setPendingArchivesForBulk] = useState<VideoZip[]>([]);
  const [bulkExtractToGallery, setBulkExtractToGallery] = useState(false);
  const [showExtractedFolders, setShowExtractedFolders] = useState(false);

  // Analyze files for forensic indicators
  const analyzeFiles = useCallback(async (files: VideoZip[]) => {
    const results = new Map<string, AnalysisResult>();
    
    for (const file of files) {
      if (file.file.size > 0 && !file.file.type?.includes('placeholder')) {
        const analysis = await analyzeFileForForensics(file.file, file.name, file.id);
        if (analysis.flags.length > 0) {
          results.set(file.id, analysis);
        }
      }
    }
    
    setForensicResults(results);
  }, []);

  // Generate preview for video or image
  const generatePreview = useCallback(async (video: VideoZip): Promise<string | undefined> => {
    console.log('generatePreview called for:', video.name, 'file type:', video.file.type, 'file size:', video.file.size);
    
    if (!video.file || video.file.size === 0) {
      console.warn('Empty or missing file:', video.name);
      return undefined;
    }
    
    // Determine MIME type from filename since IndexedDB often loses the type
    let mimeType = video.file.type;
    const name = video.name.toLowerCase();
    
    if (!mimeType || mimeType === 'application/octet-stream' || mimeType === '') {
      if (name.endsWith('.mp4') || name.endsWith('.m4v')) mimeType = 'video/mp4';
      else if (name.endsWith('.webm')) mimeType = 'video/webm';
      else if (name.endsWith('.mov')) mimeType = 'video/quicktime';
      else if (name.endsWith('.mkv')) mimeType = 'video/x-matroska';
      else if (name.endsWith('.avi')) mimeType = 'video/x-msvideo';
      else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (name.endsWith('.png')) mimeType = 'image/png';
      else if (name.endsWith('.gif')) mimeType = 'image/gif';
      else if (name.endsWith('.webp')) mimeType = 'image/webp';
    }
    
    // Check if it's a video or image
    const isVideo = mimeType.startsWith('video/') || 
                    name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i);
    const isImage = mimeType.startsWith('image/') || 
                    name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
    
    console.log('File type check:', video.name, 'mimeType:', mimeType, 'isVideo:', isVideo, 'isImage:', isImage);
    
    if (!isVideo && !isImage) {
      console.log('Skipping preview for non-media file:', video.name);
      return undefined;
    }
    
    try {
      // Recreate blob with correct MIME type if needed
      const finalBlob = mimeType === video.file.type 
        ? video.file 
        : new Blob([video.file], { type: mimeType });
      const url = URL.createObjectURL(finalBlob);
      console.log('Created preview URL:', url, 'for:', video.name, 'type:', mimeType);
      return url;
    } catch (err) {
      console.error('Failed to create object URL:', video.name, err);
      return undefined;
    }
  }, []);

  // Load folder data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const folderData = await getFolderById(folderId);
        if (folderData) {
          setFolder(folderData);
        }

        const allVideos = await getVideosByFolder(folderId);
        console.log('FolderPreview: Loaded', allVideos.length, 'videos for folder', folderId);
        console.log('Video names:', allVideos.map(v => v.name));
        
        // Separate archives and media files
        const archives: VideoZip[] = [];
        const media: VideoZip[] = [];
        
        for (const video of allVideos) {
          console.log('Checking file:', video.name, 'isArchive:', isArchiveFile(video.name), 'isMedia:', isMediaFile(video.name), 'type:', video.file?.type);
          if (isArchiveFile(video.name)) {
            archives.push(video);
          } else if (isMediaFile(video.name) || video.file.type?.startsWith('video/') || video.file.type?.startsWith('image/')) {
            media.push(video);
          } else {
            console.log('File filtered out (not archive or media):', video.name);
          }
        }
        
        console.log('Found', archives.length, 'archives and', media.length, 'media files');
        setArchiveFiles(archives);
        
        // Load cached archive previews from IndexedDB
        try {
          const cachedPreviews = await getArchivePreviewsByFolder(folderId);
          console.log('Loaded cached previews for', cachedPreviews.size, 'archives');
          if (cachedPreviews.size > 0) {
            setExtractedArchivePreviews(cachedPreviews);
            // Initialize slide indices for cached previews
            const slideIndices = new Map<string, number>();
            cachedPreviews.forEach((_, archiveId) => {
              slideIndices.set(archiveId, 0);
            });
            setCurrentSlideIndex(slideIndices);
          }
        } catch (err) {
          console.error('Error loading cached previews:', err);
        }
        
        // Generate previews for media files
        const mediaWithPreviews = await Promise.all(
          media.map(async (video) => {
            const previewUrl = await generatePreview(video);
            return { ...video, previewUrl };
          })
        );
        
        setMediaFiles(mediaWithPreviews);
        
        // Analyze files for forensic indicators
        analyzeFiles([...media, ...archives]);
      } catch (error) {
        console.error('Error loading folder preview:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [folderId, generatePreview, refreshTrigger, analyzeFiles]);

  // Handle playing a video
  const handlePlayVideo = useCallback((video: VideoWithPreview) => {
    onPlayVideo(video.file, video.id, video.name);
  }, [onPlayVideo]);

  // Handle deleting a file
  const handleDelete = useCallback(async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this file?')) return;
    
    try {
      await deleteVideoZip(fileId);
      setMediaFiles(prev => prev.filter(f => f.id !== fileId));
      setArchiveFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete file');
    }
  }, []);

  // Handle archive drag start
  const handleArchiveDragStart = (e: React.DragEvent, archive: VideoZip) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'archive',
      id: archive.id,
      name: archive.name,
      folderId: folderId
    }));
    e.dataTransfer.effectAllowed = 'copy';
    console.log('Dragging archive:', archive.name);
  };

  // Get archive info
  const getArchiveInfo = useCallback((video: VideoZip) => {
    const type = getArchiveType(video.name);
    // Check if archive might be password protected based on filename
    const isProtected = video.name.toLowerCase().includes('pass') || 
                       video.name.toLowerCase().includes('locked') ||
                       video.name.toLowerCase().includes('protected');
    return {
      isProtected,
      type
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  // Slideshow effect - cycle through preview images every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlideIndex(prev => {
        const newMap = new Map(prev);
        extractedArchivePreviews.forEach((urls, archiveId) => {
          if (urls.length > 1) {
            const currentIdx = prev.get(archiveId) || 0;
            newMap.set(archiveId, (currentIdx + 1) % urls.length);
          }
        });
        return newMap;
      });
    }, 5000);
    
    return () => clearInterval(interval);
  }, [extractedArchivePreviews]);

  // Extract archive with optional password - with recursive nested archive support
  const extractWithPassword = async (archive: VideoZip, password?: string, addToGallery: boolean = false, depth: number = 0, caller: string = 'unknown'): Promise<boolean | null> => {
    console.log('extractWithPassword ENTRY:', { name: archive.name, password: !!password, addToGallery, depth, caller });
    
    // Limit recursion depth to prevent infinite loops
    if (depth > 3) {
      console.log('Max recursion depth reached for:', archive.name);
      return true;
    }
    
    try {
      console.log('Starting extraction for:', archive.name, 'with password:', !!password, 'depth:', depth);
      
      // Get the archive blob from database
      const allVideos = await getVideosByFolder(folderId);
      const archiveVideo = allVideos.find(v => v.id === archive.id);
      
      if (!archiveVideo) {
        console.error('Archive not found in database:', archive.id);
        alert('Archive file not found in database');
        return true;
      }
      
      // Extract using the blob
      const extracted = await extract7z(archiveVideo.file, archive.name, password);
      console.log('Extract result:', { success: extracted.success, files: extracted.files?.length, error: extracted.error });
      
      // Check if extraction succeeded with files
      if (extracted.success && extracted.files && extracted.files.length > 0) {
        const allExtractedFiles: VideoWithPreview[] = [];
        const nestedArchives: { blob: Blob; name: string }[] = [];
        
        // Process extracted files - separate media from nested archives
        for (let i = 0; i < extracted.files.length; i++) {
          const file = extracted.files[i];
          
          // Check if this is a nested archive
          if (isArchiveFile(file.name)) {
            console.log('Found nested archive:', file.name, 'at depth', depth);
            nestedArchives.push({ blob: file.blob, name: file.name });
          } else {
            // Regular media file
            const mediaFile: VideoWithPreview = {
              id: `${archive.id}-extracted-${depth}-${i}`,
              folderId: folderId,
              name: file.name,
              file: file.blob,
              createdAt: Date.now(),
              sourceType: 'local',
              isCached: false,
              sourceArchiveId: archive.id,
              sourceArchiveName: archive.name,
            };
            allExtractedFiles.push(mediaFile);
          }
        }
        
        // Recursively extract nested archives
        for (const nestedArchive of nestedArchives) {
          console.log('Recursively extracting nested archive:', nestedArchive.name);
          
          // Create temporary VideoZip for nested archive
          const nestedVideoZip: VideoZip = {
            id: `${archive.id}-nested-${nestedArchive.name}`,
            folderId: folderId,
            name: nestedArchive.name,
            file: nestedArchive.blob,
            createdAt: Date.now(),
            sourceType: 'local',
            isCached: false,
          };
          
          // Recursively extract (will add to gallery if addToGallery is true)
          await extractWithPassword(nestedVideoZip, password, addToGallery, depth + 1, 'recursive-nested');
        }
        
        // Generate previews for media files
        const mediaWithPreviews = await Promise.all(
          allExtractedFiles.map(async (video) => {
            const previewUrl = await generatePreview(video);
            return { ...video, previewUrl };
          })
        );
        
        // Get up to 3 extracted IMAGE files with preview for slideshow
        const imagePreviews = mediaWithPreviews
          .filter(v => {
            const isImage = v.file.type?.startsWith('image/') || 
                           v.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i);
            return v.previewUrl && isImage;
          })
          .slice(0, 3)
          .map(v => v.previewUrl!);
        
        if (imagePreviews.length > 0 && depth === 0) {
          // Only update slideshow for top-level archives
          setExtractedArchivePreviews(prev => new Map(prev).set(archive.id, imagePreviews));
          setCurrentSlideIndex(prev => new Map(prev).set(archive.id, 0));
          
          // Save previews to IndexedDB for persistence
          try {
            await saveArchivePreview(archive.id, folderId, imagePreviews);
            console.log('Saved', imagePreviews.length, 'previews for archive', archive.name);
          } catch (err) {
            console.error('Error saving archive previews:', err);
          }
        }
        
        // Only add to gallery if explicitly requested
        if (addToGallery) {
          console.log('ADDING TO GALLERY:', mediaWithPreviews.length, 'files from depth', depth);
          console.log('Files to add:', mediaWithPreviews.map(f => f.name));
          
          // Save extracted files to IndexedDB so they persist
          for (const file of mediaWithPreviews) {
            try {
              const videoZip: VideoZip = {
                id: file.id,
                folderId: folderId,
                name: file.name,
                file: file.file,
                createdAt: Date.now(),
                sourceType: 'local',
                isCached: false,
                sourceArchiveId: file.sourceArchiveId,
                sourceArchiveName: file.sourceArchiveName,
              };
              await addVideoZip(videoZip);
              console.log('Saved to IndexedDB:', file.name);
            } catch (err) {
              console.error('Failed to save to IndexedDB:', file.name, err);
            }
          }
          
          setExtractedFiles(prev => [...prev, ...mediaWithPreviews]);
          setMediaFiles(prev => {
            const newFiles = [...prev, ...mediaWithPreviews];
            console.log('GALLERY STATE UPDATED - now has', newFiles.length, 'files');
            return newFiles;
          });
          
          // Check for CSAM in nested content
          const csamDetected = mediaWithPreviews.some(f => 
            f.name.match(/\d{2,}|young|teen|child|kid|baby|pedo|cp|jb|hebe/i)
          );
          if (csamDetected && depth > 0) {
            console.warn('CSAM detected in nested archive at depth', depth, ':', archive.name);
          }
        } else {
          console.log('NOT adding to gallery (addToGallery=false), depth:', depth);
        }
        
        console.log('Extracted', allExtractedFiles.length, 'media files and', nestedArchives.length, 'nested archives from', archive.name);
        return true;
      }
      
      // No files extracted - check if encrypted
      const errorMsg = (extracted.error || '').toLowerCase();
      const hasPasswordError = errorMsg.includes('password') || 
                              errorMsg.includes('encrypted') ||
                              errorMsg.includes('cannot open');
      
      // If no files and no password provided, likely encrypted
      if (!extracted.files || extracted.files.length === 0) {
        if (!password || hasPasswordError) {
          console.log('Archive appears encrypted, requesting password');
          return false; // Trigger password modal
        }
      }
      
      // Wrong password if password was provided but still failed
      if (password && hasPasswordError) {
        console.log('Wrong password');
        return false;
      }
      
      alert('Failed to extract archive: ' + (extracted.error || 'No files extracted'));
      return true;
    } catch (extractErr) {
      console.error('Error extracting archive:', extractErr);
      alert('Error extracting archive. Make sure the file is a valid 7z archive.');
      return true;
    }
  };

  const handlePasswordSubmit = async () => {
    if (!pendingArchive) return;
    
    setPasswordModalOpen(false);
    setIsLoading(true);
    
    const result = await extractWithPassword(pendingArchive, passwordInput, true, 0, 'password-submit');
    
    if (result === false) {
      // Wrong password, re-open modal
      setPasswordModalOpen(true);
      setPasswordInput('');
    } else if (result === null) {
      // No folder access
      alert('Cannot access folder. Please re-select the folder from the file system.');
      setPendingArchive(null);
      setPasswordInput('');
    } else {
      // Success
      setPendingArchive(null);
      setPasswordInput('');
    }
    
    setIsLoading(false);
  };

  // Extract all archives at once (preview only - doesn't add to gallery)
  const handleExtractAll = async (toGallery = false) => {
    if (archiveFiles.length === 0) return;
    
    setIsLoading(true);
    setBulkExtractToGallery(toGallery);
    const encryptedArchives: VideoZip[] = [];
    let extractedCount = 0;
    
    // First pass: try extracting all without password
    for (const archive of archiveFiles) {
      if (!archive.name.toLowerCase().endsWith('.7z')) continue;
      
      const result = await extractWithPassword(archive, undefined, toGallery, 0, `extract-all-${toGallery ? 'gallery' : 'preview'}`);
      
      if (result === false) {
        // Needs password
        encryptedArchives.push(archive);
      } else if (result === true) {
        extractedCount++;
      }
    }
    
    // If there are encrypted archives, prompt for password
    if (encryptedArchives.length > 0) {
      setPendingArchivesForBulk(encryptedArchives);
      setBulkPasswordModalOpen(true);
      setIsLoading(false); // Stop loading to show modal
    } else {
      setIsLoading(false);
      if (extractedCount > 0) {
        alert(`${toGallery ? 'Extracted' : 'Generated previews for'} ${extractedCount} archive(s)`);
      }
    }
  };

  // Handle bulk password submission
  const handleBulkPasswordSubmit = async () => {
    if (!bulkPasswordInput.trim() || pendingArchivesForBulk.length === 0) return;
    
    setBulkPasswordModalOpen(false);
    let successCount = 0;
    let failCount = 0;
    
    // Try same password on all pending archives
    for (const archive of pendingArchivesForBulk) {
      const result = await extractWithPassword(archive, bulkPasswordInput, bulkExtractToGallery, 0, `bulk-password-${bulkExtractToGallery ? 'gallery' : 'preview'}`);
      if (result === true) {
        successCount++;
      } else {
        failCount++;
      }
    }
    
    setIsLoading(false);
    setPendingArchivesForBulk([]);
    setBulkPasswordInput('');
    setBulkExtractToGallery(false);
    
    if (successCount > 0) {
      alert(`${bulkExtractToGallery ? 'Extracted' : 'Generated previews for'} ${successCount} archive(s) with password. ${failCount > 0 ? `${failCount} failed (wrong password).` : ''}`);
    } else {
      alert('Password did not work for any archive.');
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    
    try {
      const archiveData = JSON.parse(data);
      if (archiveData.type === 'archive') {
        console.log('Extracting archive:', archiveData.name);
        setIsLoading(true);
        
        // Get the archive file from the database
        const allVideos = await getVideosByFolder(folderId);
        const archiveFile = allVideos.find(v => v.id === archiveData.id);
        
        if (!archiveFile) {
          alert('Archive file not found');
          setIsLoading(false);
          return;
        }
        
        // Check if it's a 7z file
        if (!archiveFile.name.toLowerCase().endsWith('.7z')) {
          alert('Only 7z archives are supported for extraction');
          setIsLoading(false);
          return;
        }
        
        // Try extraction without password first - ADD TO GALLERY
        console.log('Starting drag-drop extraction for:', archiveFile.name);
        const result = await extractWithPassword(archiveFile, undefined, true, 0, 'drag-drop');
        console.log('Drag-drop extraction result:', result);
        
        if (result === true) {
          // Success - files added to gallery
          alert(`Archive extracted! Files added to gallery.`);
        } else if (result === false) {
          // Need password - open modal
          setPendingArchive(archiveFile);
          setPasswordModalOpen(true);
        }
        // If result === null, user cancelled folder selection - do nothing
        // If result === true, extraction succeeded - nothing more to do
        
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Error handling drop:', err);
      setIsLoading(false);
    }
  };

  if (isLoading && !mediaFiles.length) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-emerald-500" />
      </div>
    );
  }

  // Debug: log render state
  console.log('RENDER: mediaFiles.length =', mediaFiles.length, 'isLoading =', isLoading);

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
          {folder?.localFolderPath ? (
            <Folder size={24} className="text-emerald-400" />
          ) : (
            <Folder size={24} className="text-zinc-400" />
          )}
          <div>
            <h1 className="text-xl font-semibold text-white">{folder?.name || 'Folder Preview'}</h1>
            <p className="text-sm text-zinc-500">
              {archiveFiles.length} archive{archiveFiles.length !== 1 ? 's' : ''} • {mediaFiles.length} media file{mediaFiles.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowExtractedFolders(!showExtractedFolders)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
          >
            {showExtractedFolders ? 'Hide' : 'Show'} Extracted Folders
            <ChevronRight size={18} className={`transition-transform ${showExtractedFolders ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Archive Files Row */}
      {archiveFiles.length > 0 && (
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Archive Files</h2>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] rounded-full border border-emerald-500/30">
              LOCAL ONLY
            </span>
            {archiveFiles.length > 0 && (
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => handleExtractAll(false)}
                  className="flex items-center gap-1 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded-lg transition-colors"
                  title="Generate preview thumbnails for all archives"
                >
                  <Archive size={12} />
                  Preview All
                </button>
                <button
                  onClick={() => handleExtractAll(true)}
                  className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg transition-colors"
                  title="Extract all archives to Media Gallery"
                >
                  <Folder size={12} />
                  Extract All
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {archiveFiles.map((archive, index) => {
              const type = getArchiveType(archive.name);
              const archiveInfo = getArchiveInfo(archive);
              const isSelected = selectedArchive === archive.id;
              
              const hasPreview = extractedArchivePreviews.has(archive.id);
              const previewUrls = extractedArchivePreviews.get(archive.id) || [];
              const currentIndex = currentSlideIndex.get(archive.id) || 0;
              const previewUrl = previewUrls[currentIndex] || previewUrls[0];
              
              return (
                <motion.div
                  key={archive.id}
                  draggable
                  onDragStart={(e) => handleArchiveDragStart(e as unknown as React.DragEvent, archive)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedArchive(isSelected ? null : archive.id)}
                  className={`
                    flex-shrink-0 w-32 h-40 rounded-xl border-2 cursor-pointer transition-all duration-200
                    overflow-hidden relative
                    ${isSelected 
                      ? 'border-emerald-500 shadow-lg shadow-emerald-500/20' 
                      : 'border-zinc-700 hover:border-zinc-600'}
                    ${hasPreview ? '' : 'flex flex-col items-center justify-center gap-2 p-3 bg-zinc-800/50 hover:bg-zinc-800'}
                  `}
                >
                  {hasPreview ? (
                    <>
                      <img 
                        src={previewUrl} 
                        alt={archive.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <span className="text-[9px] text-white/90 truncate block">{archive.name.slice(0, 20)}</span>
                        <span className="text-[8px] text-emerald-400 uppercase">{type}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <Archive size={32} className={`
                          ${type === '7z' ? 'text-emerald-400' : 
                            type === 'zip' ? 'text-yellow-400' : 
                            type === 'rar' ? 'text-orange-400' : 'text-zinc-400'}
                        `} />
                        {archiveInfo.isProtected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                            <Lock size={10} className="text-white" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-center text-zinc-300 truncate w-full">
                        {archive.name.slice(0, 20)}{archive.name.length > 20 ? '...' : ''}
                      </span>
                      <span className="text-[10px] text-zinc-500 uppercase">{type}</span>
                    </>
                  )}
                  {archiveInfo.isProtected && !hasPreview && (
                    <span className="text-[9px] text-red-400 flex items-center gap-0.5">
                      <ShieldAlert size={8} />
                      Protected
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Forensic Analysis Warning */}
      {forensicResults.size > 0 && (
        <div className="bg-amber-900/80 border border-amber-500/50 p-3 mx-4 mt-2 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-200">
              <AlertTriangle size={20} />
              <span className="font-semibold text-sm">{forensicResults.size} file(s) with forensic indicators detected</span>
            </div>
            <button
              onClick={() => setShowForensicPanel(!showForensicPanel)}
              className="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded transition-colors"
            >
              {showForensicPanel ? 'Hide Details' : 'View Details'}
            </button>
          </div>
        </div>
      )}

      {/* Forensic Details Panel */}
      {showForensicPanel && forensicResults.size > 0 && (
        <div className="mx-4 mt-2 p-3 bg-zinc-800/80 border border-zinc-700 rounded-lg max-h-48 overflow-y-auto">
          <h4 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">Forensic Analysis Results</h4>
          {Array.from(forensicResults.entries()).map(([fileId, result]) => (
            <div key={fileId} className="mb-2 p-2 bg-zinc-900/50 rounded border border-zinc-700">
              <p className="text-xs text-zinc-300 font-medium truncate">{result.metadata.filename}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.flags.map((flag, idx) => (
                  <span key={idx} className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded">
                    {flag}
                  </span>
                ))}
              </div>
              {result.metadata.exif?.gps && (
                <p className="text-[10px] text-red-400 mt-1">
                  GPS: {result.metadata.exif.gps.lat.toFixed(4)}, {result.metadata.exif.gps.lng.toFixed(4)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bulk Password Modal */}
      {bulkPasswordModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-violet-500/20 rounded-lg flex items-center justify-center">
                <Lock size={20} className="text-violet-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Bulk Extract</h3>
                <p className="text-sm text-zinc-400">Password will be tried on {pendingArchivesForBulk.length} encrypted archive(s)</p>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm text-zinc-400 mb-2">Password (same for all archives)</label>
              <input
                type="password"
                value={bulkPasswordInput}
                onChange={(e) => setBulkPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBulkPasswordSubmit()}
                placeholder="Enter password..."
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                autoFocus
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setBulkPasswordModalOpen(false);
                  setBulkPasswordInput('');
                  setPendingArchivesForBulk([]);
                  setIsLoading(false);
                }}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkPasswordSubmit}
                disabled={!bulkPasswordInput.trim()}
                className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Extract All
              </button>
            </div>
          </div>
        </div>
      )}
      {passwordModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                <Lock size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Encrypted Archive</h3>
                <p className="text-sm text-zinc-400">Enter password to extract contents</p>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm text-zinc-400 mb-2">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                placeholder="Enter encryption key..."
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPasswordModalOpen(false);
                  setPasswordInput('');
                  setPendingArchive(null);
                  setIsLoading(false);
                }}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordSubmit}
                disabled={!passwordInput.trim()}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Extract
              </button>
            </div>
          </div>
        </div>
      )}
      <div 
        className={`flex-1 overflow-y-auto p-4 transition-all duration-200 ${isDraggingOver ? 'bg-emerald-500/10 border-2 border-emerald-500 border-dashed rounded-xl' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Extracted Folders Row */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Extracted Folders</h2>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] rounded-full border border-emerald-500/30">
              DROP ZONE
            </span>
            {isDraggingOver && (
              <span className="text-emerald-400 text-xs animate-pulse">Drop archive here to extract</span>
            )}
          </div>
          
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {mediaFiles.length === 0 ? (
              <div className="flex-shrink-0 w-32 h-40 rounded-xl border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center gap-2 p-3 text-zinc-500">
                <Folder size={32} className="text-zinc-600" />
                <span className="text-xs text-center">No extracted folders</span>
                <span className="text-[10px] text-zinc-600">Drag archives here</span>
              </div>
            ) : (
              // Group by folder path and show folder icons
              (() => {
                const paths = new Map<string, { count: number; previewUrl?: string; files: VideoWithPreview[] }>();
                
                mediaFiles.forEach(file => {
                  const path = file.name.includes('/') 
                    ? file.name.substring(0, file.name.lastIndexOf('/')) 
                    : 'Root';
                  if (!paths.has(path)) {
                    paths.set(path, { count: 0, previewUrl: file.previewUrl, files: [] });
                  }
                  const existing = paths.get(path)!;
                  existing.count++;
                  existing.files.push(file);
                  if (!existing.previewUrl && file.previewUrl) {
                    existing.previewUrl = file.previewUrl;
                  }
                });
                
                return Array.from(paths.entries()).map(([path, data]) => {
                  const videos = data.files.filter(f => f.name.match(/\.(mp4|webm|mov|mkv|avi|m4v|3gp|flv|wmv|ogv)$/i)).length;
                  const photos = data.files.filter(f => f.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i)).length;
                  
                  return (
                    <motion.div
                      key={path}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex-shrink-0 w-32 h-40 rounded-xl border-2 border-zinc-700 hover:border-emerald-500/50 cursor-pointer transition-all duration-200 overflow-hidden relative bg-zinc-800/50 hover:bg-zinc-800 group"
                      onClick={() => onViewContents()}
                    >
                      {data.previewUrl ? (
                        <>
                          <video
                            src={data.previewUrl}
                            className="w-full h-full object-cover"
                            muted
                            loop
                            playsInline
                            autoPlay
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
                          <Folder size={40} className="text-emerald-400" />
                        </div>
                      )}
                      
                      {/* Folder badge */}
                      <div className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                        <Folder size={16} className="text-white" />
                      </div>
                      
                      {/* Info at bottom */}
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
                        <span className="text-[10px] text-white/90 truncate block font-medium">{path.split('/').pop() || path}</span>
                        <span className="text-[9px] text-zinc-400">
                          {videos} vid{photos > 0 ? `, ${photos} img` : ''}
                        </span>
                      </div>
                      
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-xs text-white font-medium">Open</span>
                      </div>
                    </motion.div>
                  );
                });
              })()
            )}
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="flex flex-col items-center justify-center py-8 text-zinc-500 border-t border-zinc-800">
          <FileVideo size={32} className="mb-2 opacity-30" />
          <p className="text-sm">Drag archives from above to extract here</p>
          <p className="text-xs text-zinc-600 mt-1">or click "Extract All" to extract all archives</p>
        </div>
      </div>
    </div>
  );
}
