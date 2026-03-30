import JSZip from 'jszip';
import { addVideoZip, addFolder, dbPromise } from './db';
import { extractAllTo } from 'adm-zip';
import * as Mega from 'megajs';

export interface MegaDownloadProgress {
  status: 'idle' | 'downloading' | 'extracting' | 'importing' | 'complete' | 'error';
  progress: number; // 0-100
  message: string;
  error?: string;
}

export interface MegaLinkInfo {
  fileId: string;
  key: string;
  isFolder: boolean;
}

/**
 * Parse MEGA public link to extract file ID and decryption key
 * Supports formats:
 * - https://mega.nz/file/[fileId]#[key]
 * - https://mega.nz/folder/[folderId]#[key]
 * - https://mega.nz/#!fileId!key (old format)
 */
export function parseMegaLink(url: string): MegaLinkInfo | null {
  try {
    const urlObj = new URL(url);
    
    // New format: /file/[fileId]#[key] or /folder/[folderId]#[key]
    const fileMatch = urlObj.pathname.match(/\/file\/([^#]+)/);
    const folderMatch = urlObj.pathname.match(/\/folder\/([^#]+)/);
    const hash = urlObj.hash.slice(1); // Remove #
    
    if (fileMatch && hash) {
      return {
        fileId: fileMatch[1],
        key: hash,
        isFolder: false
      };
    }
    
    if (folderMatch && hash) {
      return {
        fileId: folderMatch[1],
        key: hash,
        isFolder: true
      };
    }
    
    // Old format: #!fileId!key
    const oldFormatMatch = urlObj.hash.match(/!([^!]+)!(.+)/);
    if (oldFormatMatch) {
      return {
        fileId: oldFormatMatch[1],
        key: oldFormatMatch[2],
        isFolder: false
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Download file from MEGA using megajs library
 * This bypasses browser behavior and handles decryption directly
 */
async function downloadFromMega(
  fileId: string,
  key: string,
  onProgress: (progress: number) => void
): Promise<Blob> {
  try {
    // Construct the full MEGA URL
    const megaUrl = `https://mega.nz/file/${fileId}#${key}`;
    
    // Create MEGA file instance using megajs
    const file = Mega.File.fromURL(megaUrl);
    
    // Download to buffer with progress tracking
    const buffer = await file.downloadBuffer({});
    
    // Convert buffer to Blob - handle both ArrayBuffer and Buffer types
    let bufferArray: Uint8Array;
    if (buffer instanceof ArrayBuffer) {
      bufferArray = new Uint8Array(buffer);
    } else {
      // Handle Buffer type - ensure we get the underlying ArrayBuffer
      const ab = buffer.buffer || buffer;
      const offset = buffer.byteOffset || 0;
      const length = buffer.byteLength || buffer.length;
      bufferArray = new Uint8Array(ab, offset, length);
    }
    
    // Ensure we have a proper ArrayBuffer for Blob creation
    const finalArray = new Uint8Array(bufferArray.buffer, bufferArray.byteOffset, bufferArray.byteLength);
    const finalBuffer = finalArray.buffer instanceof ArrayBuffer ? 
      finalArray.buffer :
      new ArrayBuffer(0);
    return new Blob([finalBuffer], { type: 'application/octet-stream' });
    
  } catch (error) {
    console.error('MEGA download failed:', error);
    throw new Error(`MEGA download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypt MEGA file using AES-CTR
 * MEGA uses a specific key derivation and encryption scheme
 */
async function decryptMegaFile(
  encryptedData: Uint8Array,
  keyStr: string,
  fileSize: number
): Promise<Blob> {
  // Parse the base64 key
  const keyData = base64ToBytes(keyStr);
  
  // MEGA key structure: [u_k (16 bytes), m_k (16 bytes), ...]
  // For file decryption, we use the second half as the AES key
  const aesKey = keyData.slice(16, 32);
  const aesNonce = keyData.slice(0, 16);
  
  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    aesKey,
    { name: 'AES-CTR' },
    false,
    ['decrypt']
  );
  
  // Decrypt using AES-CTR with the file-specific IV
  // MEGA uses a counter that increments for each 16-byte block
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-CTR',
      counter: aesNonce,
      length: 128
    },
    cryptoKey,
    encryptedData.buffer instanceof ArrayBuffer ? 
      encryptedData.buffer :
      new ArrayBuffer(0)
  );
  
  return new Blob([decrypted]);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  // MEGA uses URL-safe base64, replace chars
  const standardBase64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  
  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

/**
 * Extract ZIP file and import videos to gallery
 */
async function extractAndImportZip(
  zipBlob: Blob,
  folderId: string,
  onProgress: (message: string, progress: number) => void
): Promise<number> {
  onProgress('Reading ZIP file...', 0);
  
  const zip = await JSZip.loadAsync(zipBlob);
  const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.mcgi'];
  const videoFiles: { name: string; blob: Blob }[] = [];
  
  // Find all video files in ZIP
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext && videoExtensions.includes('.' + ext)) {
      const blob = await file.async('blob');
      videoFiles.push({
        name: path.split('/').pop() || path,
        blob
      });
    }
  }
  
  if (videoFiles.length === 0) {
    throw new Error('No video files found in the ZIP archive');
  }
  
  onProgress(`Found ${videoFiles.length} videos...`, 20);
  
  // Import each video
  let imported = 0;
  for (let i = 0; i < videoFiles.length; i++) {
    const { name, blob } = videoFiles[i];
    
    const newVideo = {
      id: crypto.randomUUID(),
      folderId,
      name: name.replace(/\.(zip|mp4|webm|mov|mkv|avi|m4v|mcgi)$/i, ''),
      file: blob,
      createdAt: Date.now(),
      sourceType: 'mega' as const,
      isCached: true,
    };
    
    await addVideoZip(newVideo);
    imported++;
    
    onProgress(
      `Importing ${name}...`,
      20 + Math.round((i / videoFiles.length) * 80)
    );
  }
  
  return imported;
}

/**
 * Main function to download from MEGA and import to gallery
 */
export async function downloadFromMegaAndImport(
  megaUrl: string,
  targetFolderId: string | null, // null = create new folder
  onProgress: (progress: MegaDownloadProgress) => void
): Promise<{ success: boolean; folderId?: string; count?: number; error?: string }> {
  onProgress({
    status: 'idle',
    progress: 0,
    message: 'Parsing MEGA link...'
  });
  
  try {
    // Parse the link
    const linkInfo = parseMegaLink(megaUrl);
    
    if (!linkInfo) {
      throw new Error('Invalid MEGA link format');
    }
    
    if (linkInfo.isFolder) {
      throw new Error('Folder links are not yet supported. Please use a direct file link.');
    }
    
    // Download from MEGA first to get the blob
    onProgress({
      status: 'downloading',
      progress: 0,
      message: 'Starting download from MEGA...'
    });
    
    const downloadedBlob = await downloadFromMega(
      linkInfo.fileId,
      linkInfo.key,
      (progress) => {
        onProgress({
          status: 'downloading',
          progress,
          message: `Downloading: ${progress}%`
        });
      }
    );
    
    // Create or use existing folder
    let folderId = targetFolderId;
    
    if (!folderId) {
      onProgress({
        status: 'downloading',
        progress: 0,
        message: 'Creating new gallery...'
      });
      
      const newFolder = {
        id: crypto.randomUUID(),
        name: `MEGA Archive ${new Date().toLocaleDateString()}`,
        createdAt: Date.now(),
        isArchive: true,
        archiveFile: new File([downloadedBlob], 'archive.zip', { type: 'application/zip' }),
        sourceType: 'mega' as const,
      };
      
      await addFolder(newFolder);
      folderId = newFolder.id;
    }
    
    // Check if it's a ZIP file
    const isZip = downloadedBlob.type === 'application/zip' || 
                  downloadedBlob.type === 'application/x-zip-compressed' ||
                  (await downloadedBlob.slice(0, 4).text()).startsWith('PK');
    
    let importedCount = 0;
    
    if (isZip) {
      // Extract and import ZIP
      onProgress({
        status: 'extracting',
        progress: 0,
        message: 'Extracting ZIP archive...'
      });
      
      importedCount = await extractAndImportZip(
        downloadedBlob,
        folderId,
        (message, progress) => {
          onProgress({
            status: 'extracting',
            progress,
            message
          });
        }
      );
    } else {
      // Single video file
      onProgress({
        status: 'importing',
        progress: 50,
        message: 'Importing video...'
      });
      
      const newVideo = {
        id: crypto.randomUUID(),
        folderId,
        name: `MEGA Video ${new Date().toLocaleTimeString()}`,
        file: downloadedBlob,
        createdAt: Date.now(),
        sourceType: 'mega' as const,
        isCached: true,
      };
      
      await addVideoZip(newVideo);
      importedCount = 1;
    }
    
    onProgress({
      status: 'complete',
      progress: 100,
      message: `Successfully imported ${importedCount} video(s)`
    });
    
    return {
      success: true,
      folderId,
      count: importedCount
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    onProgress({
      status: 'error',
      progress: 0,
      message: 'Download failed',
      error: errorMessage
    });
    
    return {
      success: false,
      error: errorMessage
    };
  }
}
