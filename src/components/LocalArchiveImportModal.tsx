import React, { useState } from 'react';
import { X, FolderPlus, File as FileIcon, AlertCircle, CheckCircle, Loader2, Lock } from 'lucide-react';
import JSZip from 'jszip';
import { addFolder, addVideoZip, VideoZip } from '../lib/db';
import { VirtualArchiveExplorer, getArchiveFormat } from '../lib/archive';
import { Archive } from 'libarchive.js';

// 7z-wasm is loaded dynamically to avoid build issues
let init7zWasm: () => Promise<any>;
let extract7zFile: (file: File, fileName: string, password?: string) => Promise<Blob>;

// Dynamically import archive7z only when needed - completely optional
async function load7zWasm() {
  if (!init7zWasm) {
    try {
      const archive7z = await import('../lib/archive7z');
      init7zWasm = archive7z.init7zWasm;
      extract7zFile = archive7z.extract7zFile;
    } catch (err) {
      console.error('Failed to load 7z-wasm:', err);
      throw new Error('7z archive support not available');
    }
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
            
            const result = await addVideoZip(newVideo);
            if (result.success) processedCount++;
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

      // Get list of files first using 7z's built-in list command
      setExtractionProgress('Listing archive contents...');
      const listArgs = archivePassword ? ['l', `-p${archivePassword}`, archivePath] : ['l', archivePath];
      
      // Redirect stdout to capture file list
      let fileListOutput = '';
      const originalPrint = sevenZip.print;
      sevenZip.print = (text: string) => {
        fileListOutput += text + '\n';
      };
      
      sevenZip.callMain(listArgs);
      sevenZip.print = originalPrint;
      
      // Parse the file list to find media files
      const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi', '.m2ts', '.ts', '.m2t', '.mts', '.m4p', '.3gp', '.3g2', '.flv', '.f4v', '.wmv', '.asf', '.ogv', '.ogg', '.ogm', '.divx', '.xvid', '.dv', '.qt', '.mqv', '.hevc', '.h265', '.h264'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
      
      // Parse 7z output to find files (lines contain file names)
      const lines = fileListOutput.split('\n');
      const mediaFiles: string[] = [];
      
      // 7z list output format: files are listed after headers
      // Format can be:
      // "2024-01-15 10:30:00 ....A        1234567    1234567  filename.ext"
      // "2024-01-15 10:30:00 ....A        1234567    1234567  folder/filename with spaces.ext"
      // Or just: "filename.ext" in some versions
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Skip header/footer lines
        if (trimmed.startsWith('7-zip') || 
            trimmed.startsWith('Scanning') || 
            trimmed.startsWith('Listing') ||
            trimmed.startsWith('Path =') ||
            trimmed.startsWith('Type =') ||
            trimmed.startsWith('Physical') ||
            trimmed.startsWith('Headers') ||
            trimmed.startsWith('Method') ||
            trimmed.startsWith('Solid') ||
            trimmed.startsWith('Blocks') ||
            trimmed.startsWith('0M') ||
            trimmed.startsWith('----------') ||
            trimmed.includes('Date') && trimmed.includes('Time') && trimmed.includes('Attr') ||
            trimmed.includes('Compressed') && trimmed.includes('Size') ||
            trimmed.match(/^\d+ files?$/) ||
            trimmed.includes('----')) continue;
        
        // Extract filename from the line
        // Lines with files typically have a pattern with date/time at the start
        // We'll try to extract the filename from the end of the line
        let fileName = '';
        
        // Try pattern: Date Time Attr Size Compressed Name
        // Example: "2024-01-15 10:30:00 ....A     1234567   1234567  folder/file name.mov"
        const datePattern = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/;
        if (datePattern.test(trimmed)) {
          // Remove the date/time part and attributes, keep the rest
          // Split by 2+ spaces to separate columns
          const parts = trimmed.split(/\s{2,}/);
          if (parts.length >= 4) {
            // Last part should be the filename
            fileName = parts[parts.length - 1];
          }
        } else if (!trimmed.includes('  ') && trimmed.length > 0) {
          // Simple filename line (no table formatting)
          fileName = trimmed;
        }
        
        if (!fileName) continue;
        
        const lowerName = fileName.toLowerCase();
        
        // Check for media files OR zip files (for nested extraction)
        const isMedia = videoExtensions.some(ext => lowerName.endsWith(ext)) || 
                        imageExtensions.some(ext => lowerName.endsWith(ext)) ||
                        lowerName.endsWith('.zip'); // Include zip files for nested extraction
        
        // Accept files with folder paths and spaces
        if (isMedia && fileName.length > 3 && !fileName.includes('\\') && !fileName.includes(':/')) {
          mediaFiles.push(fileName);
        }
      }
      
      console.log('Found media files in archive:', mediaFiles);
      console.log('7z list output (first 50 lines):', lines.slice(0, 50));
      
      // If no media files found but we have a password, still try to proceed
      // The archive might be encrypted in a way that hides file listing
      if (mediaFiles.length === 0) {
        if (archivePassword) {
          console.log('No files in listing but password provided - attempting blind extraction');
          // Don't throw error - try to extract anyway, might work if archive structure is encrypted
        } else {
          throw new Error('No media files found. If the archive is password protected, please provide a password.');
        }
      }
      
      // Create output directory
      const outputDir = '/output/';
      try {
        sevenZip.FS.mkdir(outputDir);
      } catch (e) {
        // May exist
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

      // Helper function to process nested zip files
      const processNestedZip = async (zipBlob: Blob, folderId: string): Promise<number> => {
        const zip = await JSZip.loadAsync(zipBlob);
        let nestedCount = 0;
        
        for (const [path, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;
          
          const fileName = path.split('/').pop() || path;
          const lowerName = fileName.toLowerCase();
          
          // Check if this is a media file
          const isMedia = videoExtensions.some(ext => lowerName.endsWith(ext)) || 
                          imageExtensions.some(ext => lowerName.endsWith(ext));
          
          if (isMedia) {
            try {
              const content = await zipEntry.async('uint8array');
              const blob = new Blob([content]);
              
              // Determine mime type
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

              const file = new File([blob], fileName, { type: mimeType });
              
              const newVideo: VideoZip = {
                id: crypto.randomUUID(),
                folderId: folderId,
                name: fileName.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp)$/i, ''),
                file: file,
                createdAt: Date.now(),
                sourceType: 'local',
                isCached: false,
              };

              const result = await addVideoZip(newVideo);
              if (result.success) nestedCount++;
            } catch (err) {
              console.error(`Error processing nested file ${path}:`, err);
            }
          }
        }
        
        return nestedCount;
      };

      // Extract files one at a time to save memory
      setExtractionProgress(`Extracting ${mediaFiles.length} files...`);
      let processedCount = 0;

      for (let i = 0; i < mediaFiles.length; i++) {
        const fileName = mediaFiles[i];
        try {
          setExtractionProgress(`Extracting ${fileName} (${i + 1}/${mediaFiles.length})...`);
          
          // Clear output directory before each extraction
          try {
            const existing = sevenZip.FS.readdir(outputDir);
            for (const entry of existing) {
              if (entry !== '.' && entry !== '..') {
                sevenZip.FS.unlink(outputDir + entry);
              }
            }
          } catch (e) { /* ignore */ }
          
          // Extract single file - wrap filename in quotes to handle spaces
          const quotedFileName = `"${fileName}"`;
          const extractArgs = archivePassword 
            ? ['e', `-p${archivePassword}`, archivePath, quotedFileName, `-o${outputDir}`, '-y', '-bb0']
            : ['e', archivePath, quotedFileName, `-o${outputDir}`, '-y', '-bb0'];
          
          const result = sevenZip.callMain(extractArgs);
          if (result !== 0) {
            console.error(`Failed to extract ${fileName}, exit code:`, result);
            continue;
          }
          
          // Read the extracted file
          const filePath = outputDir + fileName.split('/').pop();
          const fileData = sevenZip.FS.readFile(filePath);
          
          // Convert to standard Uint8Array
          const uint8Data = new Uint8Array(fileData);
          const blob = new Blob([uint8Data]);
          
          const lowerName = fileName.toLowerCase();
          
          // If this is a zip file, process its contents
          if (lowerName.endsWith('.zip')) {
            const nestedCount = await processNestedZip(blob, newFolder.id);
            processedCount += nestedCount;
          } else {
            // Determine mime type
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
            const file = new File([blob], fileName.split('/').pop() || fileName, { type: mimeType });

            const newVideo: VideoZip = {
              id: crypto.randomUUID(),
              folderId: newFolder.id,
              name: (fileName.split('/').pop() || fileName).replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp)$/i, ''),
              file: file,
              createdAt: Date.now(),
              sourceType: 'local',
              isCached: false,
            };

            const result = await addVideoZip(newVideo);
            if (result.success) processedCount++;
          }
          
          // Immediately cleanup extracted file to free memory
          try {
            sevenZip.FS.unlink(filePath);
          } catch (e) {
            // Ignore
          }
          
          // Force garbage collection hint
          if (processedCount % 5 === 0) {
            // Process in batches to allow GC
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (err) {
          console.error(`Error processing ${fileName}:`, err);
        }
      }

      // If mediaFiles is empty but we have a password, try extracting everything with wildcard
      if (mediaFiles.length === 0 && archivePassword) {
        setExtractionProgress('Attempting blind extraction with password...');
        
        try {
          // Clear output directory
          try {
            const existing = sevenZip.FS.readdir(outputDir);
            for (const entry of existing) {
              if (entry !== '.' && entry !== '..') {
                sevenZip.FS.unlink(outputDir + entry);
              }
            }
          } catch (e) { /* ignore */ }
          
          // Extract all files using wildcard
          const extractArgs = ['e', `-p${archivePassword}`, archivePath, `-o${outputDir}`, '-y', '-bb0', '-r'];
          const result = sevenZip.callMain(extractArgs);
          
          if (result === 0) {
            // Read all extracted files
            const extractedFiles = sevenZip.FS.readdir(outputDir).filter(f => f !== '.' && f !== '..');
            console.log('Blind extraction found files:', extractedFiles);
            
            for (const extractedName of extractedFiles) {
              const lowerName = extractedName.toLowerCase();
              const isMedia = videoExtensions.some(ext => lowerName.endsWith(ext)) || 
                              imageExtensions.some(ext => lowerName.endsWith(ext));
              
              if (isMedia) {
                try {
                  const filePath = outputDir + extractedName;
                  const fileData = sevenZip.FS.readFile(filePath);
                  const uint8Data = new Uint8Array(fileData);
                  const blob = new Blob([uint8Data]);
                  
                  // Determine mime type
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

                  const file = new File([blob], extractedName, { type: mimeType });

                  const newVideo: VideoZip = {
                    id: crypto.randomUUID(),
                    folderId: newFolder.id,
                    name: extractedName.replace(/\.(mp4|webm|mov|mkv|avi|m4v|mcgi|m2ts|ts|m2t|mts|m4p|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|ogm|divx|xvid|dv|qt|mqv|hevc|h265|h264|jpg|jpeg|png|gif|webp)$/i, ''),
                    file: file,
                    createdAt: Date.now(),
                    sourceType: 'local',
                    isCached: false,
                  };

                  const result = await addVideoZip(newVideo);
                  if (result.success) processedCount++;
                } catch (err) {
                  console.error(`Error processing blind-extracted file ${extractedName}:`, err);
                }
              }
            }
          }
        } catch (err) {
          console.error('Blind extraction failed:', err);
        }
      }

      // Cleanup
      try {
        sevenZip.FS.unlink(archivePath);
        // Clean up any remaining files in output dir
        const remaining = sevenZip.FS.readdir(outputDir);
        for (const entry of remaining) {
          if (entry !== '.' && entry !== '..') {
            try {
              sevenZip.FS.unlink(outputDir + entry);
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        // Ignore
      }

      console.log(`Successfully imported ${processedCount} files from 7z archive`);
      
      if (processedCount === 0) {
        throw new Error('No media files could be extracted. The archive may be password protected or contain no supported media files.');
      }
      
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