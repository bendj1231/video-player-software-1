import { openDB, DBSchema } from 'idb';

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
  parentId?: string | null; // For nested folders - null means root folder
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
}

export const dbPromise = openDB<VideoVaultDB>('video-vault-db', 3, {
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

export async function getVideosByFolder(folderId: string) {
  const db = await dbPromise;
  return db.getAllFromIndex('videoZips', 'by-folder', folderId);
}

export async function addVideoZip(videoZip: VideoZip): Promise<boolean> {
  const db = await dbPromise;
  
  // Check if a video with the same name already exists in this folder
  const existingVideos = await db.getAllFromIndex('videoZips', 'by-folder', videoZip.folderId);
  const duplicate = existingVideos.find(v => v.name === videoZip.name);
  
  if (duplicate) {
    console.warn(`Video "${videoZip.name}" already exists in this folder. Skipping.`);
    return false; // Indicate that no new video was added
  }
  
  await db.put('videoZips', videoZip);
  return true; // Indicate success
}

export async function deleteVideoZip(id: string) {
  const db = await dbPromise;
  await db.delete('videoZips', id);
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
