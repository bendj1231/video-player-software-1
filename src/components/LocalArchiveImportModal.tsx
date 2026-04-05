import React, { useState } from 'react';
import { X, FolderPlus, File as FileIcon, AlertCircle, CheckCircle, Loader2, Lock } from 'lucide-react';
import { addFolder, addVideoZip, VideoZip } from '../lib/db';
import { VirtualArchiveExplorer, getArchiveFormat } from '../lib/archive';
import { Archive } from 'libarchive.js';

// 7z-wasm is loaded dynamically to avoid build issues
let init7zWasm: () => Promise<any>;
let extract7zFile: (file: File, fileName: string, password?: string) => Promise<Blob>;

// Dynamically import archive7z only when needed
async function load7zWasm() {
  if (!init7zWasm) {
    const archive7z = await import('../lib/archive7z');
    init7zWasm = archive7z.init7zWasm;
    extract7zFile = archive7z.extract7zFile;
  }
}

interface LocalArchiveImportModalProps {
  onClose: () => void;
  onSuccess: (folderId: string) => void;
}

export function LocalArchiveImportModal({ onClose, onSuccess }: LocalArchiveImportModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [extractionProgress, setExtractionProgress] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [archiveExplorer, setArchiveExplorer] = useState<VirtualArchiveExplorer | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setNeedsPassword(false);
    setPassword('');

    // Try to load the archive to check if it needs a password
    console.log('Loading archive:', file.name);
    const explorer = new VirtualArchiveExplorer();
    setArchiveExplorer(explorer); // Set it early so button isn't stuck disabled
    
    try {
      await explorer.loadArchive(file);
      console.log('Archive loaded successfully');
    } catch (err) {
      console.error('Archive load error:', err);
      if (err instanceof Error && err.message.includes('password')) {
        setNeedsPassword(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load archive');
      }
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      console.log('Import blocked: no file selected');
      return;
    }

    // Check if it's a 7z file and use 7z-wasm
    const is7z = selectedFile.name.toLowerCase().endsWith('.7z');
    
    if (is7z) {
      await handle7zImport();
      return;
    }

    console.log('Starting import process...');
    try {
      setIsUploading(true);
      setError('');
      setExtractionProgress('Loading archive...');

      // Prompt for password - user can leave empty if not needed
      const archivePassword = prompt('Enter archive password (leave empty if no password):') || '';

      // Initialize libarchive directly
      await Archive.init({
        workerUrl: '/libarchive.js/worker-bundle.js'
      });

      // Open the archive fresh
      const archive = await Archive.open(selectedFile);
      
      // Try to get files - may fail or return empty if password needed
      let files: any[] = [];
      try {
        files = await archive.getFilesArray();
        console.log('Files found in archive:', files.length);
        console.log('First few files:', files.slice(0, 5).map((f: any) => f.file.name));
        
        // If no files found, might be password protected
        if (files.length === 0) {
          console.log('No files found - archive may be password protected');
          // If password was provided initially, try re-opening
          if (archivePassword) {
            const archive2 = await Archive.open(selectedFile);
            files = await archive2.getFilesArray();
            console.log('Files after re-open with password context:', files.length);
          }
          
          // Still no files, prompt for password
          if (files.length === 0) {
            const password = prompt('This archive appears to be password protected or empty. Enter password:') || '';
            if (!password) {
              throw new Error('Password required to import this archive');
            }
            const archive2 = await Archive.open(selectedFile);
            files = await archive2.getFilesArray();
            console.log('Files after password prompt:', files.length);
            
            // Save password for extraction
            if (files.length > 0) {
              // Update password for extraction phase
              Object.defineProperty(selectedFile, 'archivePassword', { value: password, writable: true });
            }
          }
        }
      } catch (listErr: any) {
        console.error('listFiles error:', listErr);
        // If listing failed, try with password
        if (archivePassword) {
          const archive2 = await Archive.open(selectedFile);
          files = await archive2.getFilesArray();
        } else {
          const password = prompt('This archive requires a password. Enter password:') || '';
          if (!password) {
            throw new Error('Password required to import this archive');
          }
          const archive2 = await Archive.open(selectedFile);
          files = await archive2.getFilesArray();
        }
      }
      
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.raw', '.cr2', '.nef', '.arw', '.dng', '.jfif'];
      
      // Log all files to see what's in the archive
      console.log('All files in archive:', files.map((item: any) => item.file.name));
      
      // Filter media files
      const mediaFiles = files.filter((item: any) => {
        const name = item.file.name.toLowerCase();
        const isVideo = videoExtensions.some(ext => name.endsWith(ext));
        const isImage = imageExtensions.some(ext => name.endsWith(ext));
        return isVideo || isImage;
      });
      
      console.log('Media files found:', mediaFiles.length);
      console.log('Media file names:', mediaFiles.map((item: any) => item.file.name));

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
        archivePassword: archivePassword || undefined,
      };

      await addFolder(newFolder);
      console.log('Created folder:', newFolder.id);

      setExtractionProgress(`Extracting ${mediaFiles.length} media files...`);

      // Extract and add each media file
      let processedCount = 0;
      const batchSize = 5;

      for (let i = 0; i < mediaFiles.length; i += batchSize) {
        const batch = mediaFiles.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (item: any) => {
          try {
            console.log(`Extracting file: ${item.file.name}`);
            
            // Try extracting with password
            let extractedFile;
            try {
              extractedFile = await item.file.extract(archivePassword || undefined);
            } catch (extractErr: any) {
              // If extract fails with password error
              if (extractErr?.message?.toLowerCase().includes('password') && !archivePassword) {
                const password = prompt(`Password required for ${item.file.name}. Enter password:`) || '';
                if (!password) return; // Skip this file
                extractedFile = await item.file.extract(password);
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
              folderId: newFolder.id,
              name: item.file.name.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico|raw|cr2|nef|arw|dng)$/i, ''),
              file: new File([extractedFile], item.file.name, { type: mimeType }),
              createdAt: Date.now(),
              sourceType: 'local',
              isCached: false,
            };
            
            await addVideoZip(newVideo);
            processedCount++;
          } catch (err) {
            console.error(`Error extracting file ${item.file.name}:`, err);
          }
        }));

        setExtractionProgress(`Extracted ${processedCount} of ${mediaFiles.length} files...`);
      }

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

  // Separate handler for 7z files using 7z-wasm
  const handle7zImport = async () => {
    if (!selectedFile) return;
    
    console.log('Starting 7z import with 7z-wasm...');
    try {
      setIsUploading(true);
      setError('');
      setExtractionProgress('Initializing 7z-wasm...');

      // Prompt for password
      const archivePassword = prompt('Enter 7z archive password (leave empty if no password):') || '';

      // Load 7z-wasm module dynamically
      await load7zWasm();
      
      // Initialize 7z-wasm
      const sevenZip = await init7zWasm();
      setExtractionProgress('Loading archive...');

      // Write archive to virtual filesystem
      const archivePath = '/input.7z';
      const data = new Uint8Array(await selectedFile.arrayBuffer());
      sevenZip.FS.writeFile(archivePath, data);

      // List files with password
      setExtractionProgress('Listing files...');
      const listArgs = archivePassword ? ['l', `-p${archivePassword}`, archivePath] : ['l', archivePath];
      sevenZip.callMain(listArgs);
      
      // For now, try to extract all and filter by extension
      // In a real implementation, we'd parse the output properly
      const outputDir = '/output/';
      try {
        sevenZip.FS.mkdir(outputDir);
      } catch (e) {
        // May exist
      }

      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];

      // Try to extract all files
      const extractArgs = archivePassword ? ['e', `-p${archivePassword}`, archivePath, `-o${outputDir}`, '-y'] : ['e', archivePath, `-o${outputDir}`, '-y'];
      console.log('Extracting with args:', extractArgs);
      const extractResult = sevenZip.callMain(extractArgs);
      console.log('Extract result (exit code):', extractResult);

      // Read output directory - list ALL files first
      let allFiles: string[] = [];
      try {
        allFiles = sevenZip.FS.readdir(outputDir);
        console.log('All files in output dir:', allFiles);
      } catch (e) {
        console.error('Error reading output dir:', e);
      }
      
      // Filter for media files
      const extractedFiles: string[] = [];
      for (const entry of allFiles) {
        if (entry === '.' || entry === '..') continue;
        const lowerName = entry.toLowerCase();
        console.log('Checking file:', entry, 'lower:', lowerName);
        const isVideo = videoExtensions.some(ext => lowerName.endsWith(ext));
        const isImage = imageExtensions.some(ext => lowerName.endsWith(ext));
        console.log('Is video:', isVideo, 'Is image:', isImage);
        if (isVideo || isImage) {
          extractedFiles.push(entry);
        }
      }

      console.log('Found media files:', extractedFiles);

      if (extractedFiles.length === 0) {
        // If no files extracted and password was empty, try with password
        if (!archivePassword) {
          const password = prompt('This 7z archive appears to be password protected. Enter password:') || '';
          if (!password) {
            throw new Error('Password required to import 7z archive');
          }
          // Clear output dir and retry
          try {
            const entries = sevenZip.FS.readdir(outputDir);
            for (const entry of entries) {
              if (entry !== '.' && entry !== '..') {
                sevenZip.FS.unlink(outputDir + entry);
              }
            }
          } catch (e) { /* ignore */ }
          
          // Retry with password
          const retryArgs = ['e', `-p${password}`, archivePath, `-o${outputDir}`, '-y'];
          console.log('Retrying with password:', retryArgs);
          sevenZip.callMain(retryArgs);
          
          // Read again
          const entries2 = sevenZip.FS.readdir(outputDir);
          console.log('Files after retry:', entries2);
          for (const entry of entries2) {
            if (entry === '.' || entry === '..') continue;
            const lowerName = entry.toLowerCase();
            if (videoExtensions.some(ext => lowerName.endsWith(ext)) || imageExtensions.some(ext => lowerName.endsWith(ext))) {
              extractedFiles.push(entry);
            }
          }
        }
        
        if (extractedFiles.length === 0) {
          throw new Error('No media files found in the 7z archive');
        }
      }

      // Create folder
      const folderName = selectedFile.name.replace(/\.7z$/i, '');
      const newFolder = {
        id: crypto.randomUUID(),
        name: folderName,
        createdAt: Date.now(),
        isArchive: true,
        archiveFile: selectedFile,
        sourceType: 'local' as const,
        archivePassword: archivePassword || undefined,
      };

      await addFolder(newFolder);

      // Add extracted files to database
      setExtractionProgress(`Adding ${extractedFiles.length} files to database...`);
      let processedCount = 0;

      for (const fileName of extractedFiles) {
        try {
          const filePath = outputDir + fileName;
          console.log('Reading file:', filePath);
          const fileData = sevenZip.FS.readFile(filePath);
          console.log('File data type:', typeof fileData, 'length:', fileData.length || fileData.byteLength);
          
          // Convert to standard Uint8Array if needed
          const uint8Data = new Uint8Array(fileData);
          const blob = new Blob([uint8Data]);
          
          // Determine mime type
          const lowerName = fileName.toLowerCase();
          let mimeType = 'application/octet-stream';
          if (lowerName.endsWith('.mp4')) mimeType = 'video/mp4';
          else if (lowerName.endsWith('.webm')) mimeType = 'video/webm';
          else if (lowerName.endsWith('.mov')) mimeType = 'video/quicktime';
          else if (lowerName.endsWith('.mkv')) mimeType = 'video/x-matroska';
          else if (lowerName.endsWith('.avi')) mimeType = 'video/x-msvideo';
          else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (lowerName.endsWith('.png')) mimeType = 'image/png';
          else if (lowerName.endsWith('.gif')) mimeType = 'image/gif';
          else if (lowerName.endsWith('.webp')) mimeType = 'image/webp';

          // Create File from Blob
          const file = new File([blob], fileName, { type: mimeType });

          const newVideo: VideoZip = {
            id: crypto.randomUUID(),
            folderId: newFolder.id,
            name: fileName.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp)$/i, ''),
            file: file,
            createdAt: Date.now(),
            sourceType: 'local',
            isCached: false,
          };

          await addVideoZip(newVideo);
          processedCount++;
          
          // Cleanup
          try {
            sevenZip.FS.unlink(filePath);
          } catch (e) {
            // Ignore
          }
        } catch (err) {
          console.error(`Error processing ${fileName}:`, err);
        }
      }

      // Cleanup archive
      try {
        sevenZip.FS.unlink(archivePath);
      } catch (e) {
        // Ignore
      }

      console.log(`Successfully imported ${processedCount} files from 7z archive`);
      onSuccess(newFolder.id);
      onClose();
    } catch (err) {
      console.error('Error importing 7z archive:', err);
      setError(err instanceof Error ? err.message : 'Failed to import 7z archive');
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

  const handlePasswordSubmit = async () => {
    if (!password || !archiveExplorer) return;

    setIsUploading(true);
    setError('');

    try {
      await archiveExplorer.setPassword(password);
      setNeedsPassword(false);
      setIsUploading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password');
      setIsUploading(false);
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
              <FileIcon size={24} className="text-green-400" />
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

        {/* Password Input */}
        {needsPassword && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-amber-400 mb-3">
              <Lock size={18} />
              <span className="font-medium">Password Required</span>
            </div>
            <p className="text-sm text-amber-300 mb-3">
              This archive is password protected. Please enter the password to extract its contents.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter archive password..."
              className="w-full px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) {
                  handlePasswordSubmit();
                }
              }}
            />
            <button
              onClick={handlePasswordSubmit}
              disabled={!password || isUploading}
              className="mt-3 w-full py-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:opacity-50 text-white font-medium transition-colors"
            >
              {isUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Verifying...
                </span>
              ) : (
                'Unlock Archive'
              )}
            </button>
          </div>
        )}

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
            disabled={!selectedFile || !archiveExplorer || isUploading}
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