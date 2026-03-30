import React, { useState } from 'react';
import { X, FolderPlus, File, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { addFolder, addVideoZip, VideoZip } from '../lib/db';
import JSZip from 'jszip';

interface LocalArchiveImportModalProps {
  onClose: () => void;
  onSuccess: (folderId: string) => void;
}

export function LocalArchiveImportModal({ onClose, onSuccess }: LocalArchiveImportModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [extractionProgress, setExtractionProgress] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = ['.zip', '.7z', '.rar'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!validExtensions.includes(fileExtension)) {
      setError('Please select a valid archive file (.zip, .7z, or .rar)');
      setSelectedFile(null);
      return;
    }

    setError('');
    setSelectedFile(file);
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    try {
      setIsUploading(true);
      setError('');
      setExtractionProgress('Loading archive...');

      // Read and load the zip file
      const arrayBuffer = await selectedFile.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      setExtractionProgress('Scanning for media files...');

      // Define media extensions
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];

      // Find all media files in the archive
      const mediaFiles: { name: string; zipEntry: JSZip.JSZipObject }[] = [];
      
      for (const [name, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue; // Skip directories
        
        const fileName = name.toLowerCase();
        const isVideo = videoExtensions.some(ext => fileName.endsWith(ext));
        const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
        
        if (isVideo || isImage) {
          mediaFiles.push({ name, zipEntry });
        }
      }

      if (mediaFiles.length === 0) {
        setError('No media files (videos or images) found in the archive');
        setIsUploading(false);
        return;
      }

      // Create new folder for the archive
      const folderName = selectedFile.name.replace(/\.(zip|7z|rar)$/i, '');
      const newFolder = {
        id: crypto.randomUUID(),
        name: folderName,
        createdAt: Date.now(),
        isArchive: true,
        archiveFile: selectedFile,
        sourceType: 'local' as const,
      };

      await addFolder(newFolder);

      setExtractionProgress(`Extracting ${mediaFiles.length} media files...`);

      // Extract and add each media file to the database
      let processedCount = 0;
      const batchSize = 5; // Process in batches to avoid memory issues

      for (let i = 0; i < mediaFiles.length; i += batchSize) {
        const batch = mediaFiles.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async ({ name, zipEntry }) => {
          try {
            // Extract file as blob
            const blob = await zipEntry.async('blob');
            
            // Determine file type
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
            
            // Create File object from blob
            const cleanName = name.split('/').pop() || name;
            const file = new File([blob], cleanName, { type: mimeType });
            
            // Create video zip entry
            const newVideo: VideoZip = {
              id: crypto.randomUUID(),
              folderId: newFolder.id,
              name: cleanName.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
              file,
              createdAt: Date.now(),
              sourceType: 'local',
              isCached: false,
            };
            
            await addVideoZip(newVideo);
            processedCount++;
          } catch (err) {
            console.error(`Error extracting file ${name}:`, err);
          }
        }));

        setExtractionProgress(`Extracted ${processedCount} of ${mediaFiles.length} files...`);
      }

      setExtractionProgress('Complete!');
      onSuccess(newFolder.id);
      onClose();
    } catch (err) {
      console.error('Error importing archive:', err);
      setError(err instanceof Error ? err.message : 'Failed to import archive');
    } finally {
      setIsUploading(false);
      setExtractionProgress('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-400', 'bg-blue-500/10');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-500/10');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-500/10');
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const fileInput = fileInputRef.current;
      if (fileInput) {
        // Create a DataTransfer object to simulate file input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        handleFileSelect({ target: fileInput } as any);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg mx-4 p-6 rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-white">Import Local Archive</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/70" />
          </button>
        </div>

        {/* Description */}
        <p className="text-zinc-400 mb-6">
          Select a .zip, .7z, or .rar file from your device to import it into your gallery. 
          You'll be able to browse its contents without full extraction.
        </p>

        {/* File Upload Area */}
        <div 
          className="border-2 border-dashed border-zinc-600 rounded-xl p-8 text-center hover:border-zinc-400 transition-colors cursor-pointer mb-6"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.7z,.rar,application/zip,application/x-7z-compressed,application/x-rar-compressed"
            className="hidden"
            onChange={handleFileSelect}
          />
          
          {selectedFile ? (
            <div className="flex items-center justify-center gap-3">
              <File size={24} className="text-green-400" />
              <div className="text-left">
                <div className="text-white font-medium">{selectedFile.name}</div>
                <div className="text-zinc-500 text-sm">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
              <CheckCircle size={24} className="text-green-400" />
            </div>
          ) : (
            <div className="text-center">
              <FolderPlus size={48} className="mx-auto mb-4 text-zinc-500" />
              <p className="text-white font-medium mb-2">Click to select or drag and drop</p>
              <p className="text-zinc-500 text-sm">ZIP, 7Z, or RAR files only</p>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle size={18} />
              <span className="font-medium">Error</span>
            </div>
            <p className="mt-1 text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors"
          >
            Cancel
          </button>
          
          <button
            onClick={handleImport}
            disabled={!selectedFile || isUploading}
            className="flex-1 py-3 px-4 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:opacity-50 text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {extractionProgress || 'Importing...'}
              </>
            ) : (
              <>
                <FolderPlus size={18} />
                Import Archive
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}