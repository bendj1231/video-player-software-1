import { openDB, DBSchema } from 'idb';
import { 
  getCacheSettings, 
  calculateTotalCacheSize, 
  getVideoSizeMB, 
  wouldExceedCacheLimit, 
  getVideosToEvict 
} from './storageCache';

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  coverImage?: File;
  localFolderPath?: string;
  isArchive?: boolean;
  archiveFile?: File;
  archivePassword?: string;
  sourceType?: 'mega' | 'local';
  parentId?: string | null;
  groupByDate?: boolean; // Group photos by date taken (EXIF)
  timeGapMinutes?: number; // Time gap for grouping (default 240 = 4 hours)
}

export interface VideoZip {
  id: string;
  folderId: string;
  name: string;
  file: Blob;
  previewImage?: Blob;
  createdAt: number;
  sourceType?: 'local' | 'mega' | 'cloud'; // Track if video is from cloud or local
  isCached?: boolean; // If true, video is cached from cloud but not saved locally yet
  isPasswordProtected?: boolean; // For archive files - indicates if password protected
  sourceArchiveId?: string; // ID of the archive this file was extracted from
  sourceArchiveName?: string; // Name of the archive this file was extracted from
}

interface VideoVaultDB extends DBSchema {
  folders: {
    key: string;
    value: Folder;
    indexes: { 'by-parent': string | null };
  };
  videoZips: {
    key: string;
    value: VideoZip;
    indexes: { 'by-folder': string };
  };
  archivePreviews: {
    key: string;
    value: {
      archiveId: string;
      folderId: string;
      previewUrls: string[];
      updatedAt: number;
    };
    indexes: { 'by-folder': string };
  };
}

export const dbPromise = openDB<VideoVaultDB>('video-vault-db', 5, {
  upgrade(db, oldVersion, newVersion, transaction) {
    // Create folders store
    if (!db.objectStoreNames.contains('folders')) {
      const folderStore = db.createObjectStore('folders', { keyPath: 'id' });
      folderStore.createIndex('by-parent', 'parentId');
    } else if (oldVersion < 2) {
      // Migration: add parent index to existing folders store
      const folderStore = transaction.objectStore('folders');
      folderStore.createIndex('by-parent', 'parentId');
    }
    
    // Migration for version 4: add groupByDate support (no schema change needed, just default values)
    if (oldVersion < 4) {
      console.log('Migrating to version 4: groupByDate support enabled');
    }
    
    // Migration for version 5: add archivePreviews store
    if (oldVersion < 5) {
      console.log('Migrating to version 5: archivePreviews store added');
      if (!db.objectStoreNames.contains('archivePreviews')) {
        const previewStore = db.createObjectStore('archivePreviews', { keyPath: 'archiveId' });
        previewStore.createIndex('by-folder', 'folderId');
      }
    }
    
    // Create videoZips store - always check and create if missing
    if (!db.objectStoreNames.contains('videoZips')) {
      const videoStore = db.createObjectStore('videoZips', { keyPath: 'id' });
      videoStore.createIndex('by-folder', 'folderId');
    }
  },
});

export async function getFolders() {
  const db = await dbPromise;
  return db.getAll('folders');
}

export async function getSubfolders(parentId: string | null): Promise<Folder[]> {
  const db = await dbPromise;
  return db.getAllFromIndex('folders', 'by-parent', parentId);
}

export async function getFolderById(id: string): Promise<Folder | undefined> {
  const db = await dbPromise;
  return db.get('folders', id);
}

export async function addFolder(folder: Folder) {
  const db = await dbPromise;
  await db.put('folders', folder);
}

export async function updateFolder(folder: Folder) {
  const db = await dbPromise;
  await db.put('folders', folder);
}

export async function getVideosByFolder(folderId: string) {
  const db = await dbPromise;
  return db.getAllFromIndex('videoZips', 'by-folder', folderId);
}

export async function addVideoZip(videoZip: VideoZip): Promise<{ success: boolean; message?: string }> {
  const db = await dbPromise;
  
  // Check if a video with the same name already exists in this folder
  const existingVideos = await db.getAllFromIndex('videoZips', 'by-folder', videoZip.folderId);
  const duplicate = existingVideos.find(v => v.name === videoZip.name);
  
  if (duplicate) {
    console.warn(`Video "${videoZip.name}" already exists in this folder. Skipping.`);
    return { success: false, message: `Video "${videoZip.name}" already exists in this folder.` };
  }
  
  // Check cache limits before adding
  const settings = getCacheSettings();
  const newVideoSizeMB = getVideoSizeMB(videoZip);
  
  // Get all videos to calculate current cache size
  const allVideos = await db.getAll('videoZips');
  const currentSizeMB = allVideos.reduce((sum, v) => sum + getVideoSizeMB(v), 0);
  
  // Check if we need to evict videos to make room
  if (wouldExceedCacheLimit(currentSizeMB, newVideoSizeMB, settings.maxSizeMB)) {
    const spaceNeeded = (currentSizeMB + newVideoSizeMB) - settings.maxSizeMB;
    
    // Get videos sorted by eviction policy
    const videosWithMeta = allVideos.map(v => ({
      id: v.id,
      sizeMB: getVideoSizeMB(v),
      createdAt: v.createdAt
    }));
    
    const toEvict = getVideosToEvict(videosWithMeta, spaceNeeded, settings.evictionPolicy);
    
    if (toEvict.length === 0) {
      return { 
        success: false, 
        message: `Cannot add video: cache limit (${settings.maxSizeMB}MB) exceeded and no videos can be evicted.` 
      };
    }
    
    // Evict videos
    console.log(`Cache limit reached. Evicting ${toEvict.length} video(s) to make ${spaceNeeded.toFixed(1)}MB space...`);
    for (const videoId of toEvict) {
      await db.delete('videoZips', videoId);
    }
  }
  
  await db.put('videoZips', videoZip);
  return { success: true };
}

export async function deleteVideoZip(id: string) {
  const db = await dbPromise;
  await db.delete('videoZips', id);
}

export async function forceClearFolderVideos(folderId: string): Promise<number> {
  const db = await dbPromise;
  const tx = db.transaction('videoZips', 'readwrite');
  const index = tx.objectStore('videoZips').index('by-folder');
  let cursor = await index.openCursor(IDBKeyRange.only(folderId));
  let deletedCount = 0;
  while (cursor) {
    await cursor.delete();
    deletedCount++;
    cursor = await cursor.continue();
  }
  await tx.done;
  console.log(`Force cleared ${deletedCount} videos from folder ${folderId}`);
  return deletedCount;
}

export async function deleteFolder(id: string) {
  const db = await dbPromise;
  
  // Recursively delete all subfolders first
  const subfolders = await getSubfolders(id);
  for (const subfolder of subfolders) {
    await deleteFolder(subfolder.id);
  }
  
  // Delete all videos in this folder
  const tx = db.transaction(['folders', 'videoZips'], 'readwrite');
  const index = tx.objectStore('videoZips').index('by-folder');
  let cursor = await index.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  
  // Delete the folder itself
  await tx.objectStore('folders').delete(id);
  await tx.done;
}

// Delete a content gallery (folder with videos) - does NOT delete directory folders
export async function deleteGallery(id: string): Promise<boolean> {
  const db = await dbPromise;
  
  // Check if this folder has videos (is a content gallery)
  const videos = await getVideosByFolder(id);
  const folder = await getFolderById(id);
  
  // If folder has no videos and is a directory folder (mindmap organizational), don't delete it
  if (videos.length === 0 && folder?.sourceType === 'local') {
    // This is a directory folder without content - don't delete
    return false;
  }
  
  // This is a content gallery - proceed with deletion
  // Recursively delete all subfolders first (only if they have content)
  const subfolders = await getSubfolders(id);
  for (const subfolder of subfolders) {
    await deleteGallery(subfolder.id);
  }
  
  // Delete all videos in this folder
  const tx = db.transaction(['folders', 'videoZips'], 'readwrite');
  const index = tx.objectStore('videoZips').index('by-folder');
  let cursor = await index.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  
  // Delete the folder itself
  await tx.objectStore('folders').delete(id);
  await tx.done;
  
  return true;
}

export async function saveArchivePreview(archiveId: string, folderId: string, previewUrls: string[]) {
  const db = await dbPromise;
  await db.put('archivePreviews', {
    archiveId,
    folderId,
    previewUrls,
    updatedAt: Date.now(),
  });
}

export async function getArchivePreviewsByFolder(folderId: string): Promise<Map<string, string[]>> {
  const db = await dbPromise;
  const previews = await db.getAllFromIndex('archivePreviews', 'by-folder', folderId);
  const result = new Map<string, string[]>();
  for (const preview of previews) {
    result.set(preview.archiveId, preview.previewUrls);
  }
  return result;
}

export async function deleteArchivePreview(archiveId: string) {
  const db = await dbPromise;
  await db.delete('archivePreviews', archiveId);
}
