// File System Access API utilities for managing local folders
import { openDB } from 'idb';

export interface FileSystemHandle {
  name: string;
  kind: 'directory' | 'file';
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied'>;
  }
}

/**
 * Request permission to access a directory
 * Uses File System Access API
 */
export async function requestLocalFolderAccess(): Promise<{ handle: FileSystemDirectoryHandle | null; error?: string }> {
  try {
    if (!window.showDirectoryPicker) {
      return { handle: null, error: 'File System Access API not supported. Please use Chrome or Edge browser.' };
    }

    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'desktop'
    });

    if (dirHandle.requestPermission) {
      const permission = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        return { handle: null, error: 'Permission denied. Please grant write permission to create folders.' };
      }
    }

    return { handle: dirHandle };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { handle: null, error: 'Selection canceled. You need to select a folder to continue.' };
    }
    // Log the actual error for debugging
    console.error('Error requesting folder access:', err);
    // Check for specific error types
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') {
        return { handle: null, error: 'Permission denied. The browser blocked access to the file system. Please check browser permissions.' };
      }
      if (err.name === 'SecurityError') {
        return { handle: null, error: 'Security error. Make sure you are using HTTPS or localhost, and not in an iframe.' };
      }
    }
    return { handle: null, error: 'Failed to access directory. Make sure you have write permissions and are using Chrome/Edge browser.' };
  }
}

/**
 * Create a folder within a directory handle
 */
export async function createFolderInDirectory(
  parentHandle: FileSystemDirectoryHandle,
  folderName: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const newFolderHandle = await parentHandle.getDirectoryHandle(folderName, { create: true });
    return newFolderHandle;
  } catch (err) {
    console.error('Error creating folder:', err);
    return null;
  }
}

/**
 * Save a blob/file to a directory
 */
export async function saveFileToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<{ success: boolean; error?: string }> {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { success: true };
  } catch (err: any) {
    console.error('Error saving file:', err);
    let errorMessage = 'Unknown error';
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') {
        errorMessage = 'Permission denied. The browser revoked write access. Please set up the local folder again.';
      } else if (err.name === 'SecurityError') {
        errorMessage = 'Security error. Check browser permissions.';
      } else {
        errorMessage = `${err.name}: ${err.message}`;
      }
    } else if (err?.message) {
      errorMessage = err.message;
    }
    return { success: false, error: errorMessage };
  }
}

/**
 * Check if browser supports File System Access API
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Get browser-specific guidance for enabling file system access
 */
export function getFileSystemAccessHelp(): string {
  const ua = navigator.userAgent;
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    return 'Safari does not support File System Access API. Please use Chrome or Edge browser.';
  }
  if (/Firefox/.test(ua)) {
    return 'Firefox does not support File System Access API. Please use Chrome or Edge browser.';
  }
  if (/Chrome/.test(ua)) {
    return 'Chrome supports this feature. Make sure you are on a secure connection (HTTPS or localhost) and not in an incognito/private window.';
  }
  return 'Please use Chrome or Edge browser for local folder support.';
}

/**
 * Check if a file exists in directory
 */
export async function fileExistsInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Store directory handle reference in IndexedDB for persistence
 */
export async function storeDirectoryHandle(folderId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDirectoryHandleDB();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    store.put({ folderId, handle, timestamp: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error storing directory handle:', err);
  }
}

/**
 * Retrieve stored directory handle
 */
export async function getStoredDirectoryHandle(folderId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDirectoryHandleDB();
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const request = store.get(folderId);
    
    const result = await new Promise<{ handle: FileSystemDirectoryHandle } | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (result?.handle) {
      // Try to verify we can still access it without prompting
      try {
        // @ts-ignore - try to access directory to verify permission
        await result.handle.values().next();
        return result.handle;
      } catch (err) {
        // Permission may have been revoked, try requesting it
        if (result.handle.requestPermission) {
          const permission = await result.handle.requestPermission({ mode: 'readwrite' });
          if (permission === 'granted') {
            return result.handle;
          }
        }
      }
    }
    return null;
  } catch (err) {
    console.error('Error retrieving directory handle:', err);
    return null;
  }
}

/**
 * Remove stored directory handle for a folder (unmount)
 */
export async function removeDirectoryHandle(folderId: string): Promise<void> {
  try {
    const db = await openDirectoryHandleDB();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    store.delete(folderId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error removing directory handle:', err);
  }
}

/**
 * Open IndexedDB for storing directory handles
 */
async function openDirectoryHandleDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('video-vault-handles', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles', { keyPath: 'folderId' });
      }
    };
  });
}

/**
 * Initialize local folder for a gallery folder
 * Creates folder on desktop and stores the handle
 */
export async function initializeLocalFolder(
  folderId: string,
  folderName: string
): Promise<{ success: boolean; handle?: FileSystemDirectoryHandle; path?: string; error?: string }> {
  // Try to get existing handle first
  let handle = await getStoredDirectoryHandle(folderId);

  if (handle) {
    return { success: true, handle, path: handle.name };
  }

  // Request new folder access
  const { handle: parentHandle, error: accessError } = await requestLocalFolderAccess();
  if (!parentHandle) {
    return { success: false, error: accessError || 'Failed to access directory' };
  }

  // Create subfolder with the gallery name
  const folderHandle = await createFolderInDirectory(parentHandle, folderName);
  if (!folderHandle) {
    return { success: false, error: 'Failed to create subfolder. The folder may already exist.' };
  }

  // Store the handle for future use
  await storeDirectoryHandle(folderId, folderHandle);

  return { success: true, handle: folderHandle, path: `${parentHandle.name}/${folderName}` };
}

/**
 * Clear all cached data including stored directory handles, localStorage, and orphaned videos
 * Also verifies local folder files and removes videos that don't exist locally
 */
export async function clearCache(): Promise<{ success: boolean; message: string; deletedVideos?: number; folderCounts?: { folderId: string; folderName: string; remainingVideos: number; localFiles?: number }[] }> {
  try {
    // Clear watch history from localStorage
    localStorage.removeItem('watchHistory');
    localStorage.removeItem('recentFolders');

    let deletedCount = 0;
    const folderCounts: { folderId: string; folderName: string; remainingVideos: number; localFiles?: number }[] = [];
    
    try {
      const videoDB = await openDB('video-vault-db', 2);
      
      // Get stored directory handles first
      const handleDB = await openDirectoryHandleDB();
      const handleTx = handleDB.transaction('handles', 'readonly');
      const handleStore = handleTx.objectStore('handles');
      const allHandlesRequest = handleStore.getAll();
      const allHandles: { folderId: string; handle: FileSystemDirectoryHandle }[] = await new Promise((resolve, reject) => {
        allHandlesRequest.onsuccess = () => resolve(allHandlesRequest.result);
        allHandlesRequest.onerror = () => reject(allHandlesRequest.error);
      });
      const handleMap = new Map(allHandles.map((h: any) => [h.folderId, h.handle]));
      
      // Get all folders
      const folderTx = videoDB.transaction('folders', 'readonly');
      const folderStore = folderTx.objectStore('folders');
      const allFolders = await folderStore.getAll();
      
      // Get all videos
      const videoTx = videoDB.transaction('videoZips', 'readwrite');
      const videoStore = videoTx.objectStore('videoZips');
      const allVideos = await videoStore.getAll();
      
      // For each folder with a local handle, verify actual files
      const localFilesPerFolder = new Map<string, string[]>();
      
      for (const { folderId, handle } of allHandles) {
        try {
          const files: string[] = [];
          // @ts-ignore - FileSystemDirectoryHandle iteration
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              files.push(entry.name);
            }
          }
          localFilesPerFolder.set(folderId, files);
        } catch (err) {
          console.error(`Error reading local folder for ${folderId}:`, err);
          localFilesPerFolder.set(folderId, []);
        }
      }
      
      // Delete videos that are not properly synced
      for (const video of allVideos) {
        let shouldDelete = false;
        
        // Check if video is not local or cached
        const isLocalSynced = video.sourceType === 'local' && video.isCached === false;
        
        if (!isLocalSynced) {
          // Not a properly synced local video - delete it
          shouldDelete = true;
        } else {
          // It's marked as local - verify file exists in local folder
          const localFiles = localFilesPerFolder.get(video.folderId);
          if (localFiles !== undefined) {
            // Folder has local storage - check if file exists (even if empty array)
            const fileExists = localFiles.length > 0 && localFiles.some(f => f.toLowerCase().startsWith(video.name.toLowerCase()));
            if (!fileExists) {
              // File doesn't exist locally or folder is empty - delete from DB
              shouldDelete = true;
            }
          } else {
            // No local folder handle found for this folder - can't verify, delete it
            shouldDelete = true;
          }
        }
        
        if (shouldDelete) {
          await videoStore.delete(video.id);
          deletedCount++;
        }
      }
      
      await videoTx.done;
      
      // Clear IndexedDB handles after processing
      const clearTx = handleDB.transaction('handles', 'readwrite');
      const clearStore = clearTx.objectStore('handles');
      const clearRequest = clearStore.clear();
      await new Promise<void>((resolve, reject) => {
        clearRequest.onsuccess = () => resolve();
        clearRequest.onerror = () => reject(clearRequest.error);
      });
      await new Promise<void>((resolve, reject) => {
        clearTx.oncomplete = () => resolve();
        clearTx.onerror = () => reject(clearTx.error);
      });
      
      // Clear all folders from the database
      const clearFoldersTx = videoDB.transaction('folders', 'readwrite');
      const clearFoldersStore = clearFoldersTx.objectStore('folders');
      await clearFoldersStore.clear();
      await clearFoldersTx.done;
      
      // Get remaining video counts per folder
      const countTx = videoDB.transaction('videoZips', 'readonly');
      const countStore = countTx.objectStore('videoZips');
      const index = countStore.index('by-folder');
      
      for (const folder of allFolders) {
        const remainingVideos = await index.count(IDBKeyRange.only(folder.id));
        const localFiles = localFilesPerFolder.get(folder.id);
        folderCounts.push({
          folderId: folder.id,
          folderName: folder.name,
          remainingVideos,
          localFiles: localFiles?.length
        });
      }
      
      await countTx.done;
      videoDB.close();
      handleDB.close();
    } catch (videoErr) {
      console.error('Error clearing videos:', videoErr);
    }

    // Build folder count summary
    const folderSummary = folderCounts
      .map(f => {
        if (f.localFiles !== undefined) {
          return `${f.folderName}: ${f.remainingVideos} videos (local folder: ${f.localFiles} files)`;
        }
        return `${f.folderName}: ${f.remainingVideos} videos`;
      })
      .join('\n');

    const message = deletedCount > 0 
      ? `Cache cleared. Removed ${deletedCount} orphaned/non-local video(s).\n\nUpdated folder counts:\n${folderSummary || 'No videos remaining'}`
      : `Cache cleared. All videos verified.\n\nFolder counts:\n${folderSummary || 'No videos remaining'}`;

    return { success: true, message, deletedVideos: deletedCount, folderCounts };
  } catch (err) {
    console.error('Error clearing cache:', err);
    return { success: false, message: 'Failed to clear cache. Please try again.' };
  }
}
