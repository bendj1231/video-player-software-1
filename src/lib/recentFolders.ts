// Recent folders tracking utility for quick re-sync

export interface RecentFolder {
  id: string;
  name: string;
  path: string;
  lastUploaded: number;
  fileCount?: number;
}

const RECENT_FOLDERS_KEY = 'recentFolders';
const MAX_RECENT_FOLDERS = 10;

/**
 * Get list of recently uploaded folders
 */
export function getRecentFolders(): RecentFolder[] {
  try {
    const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
    if (!stored) return [];
    const folders: RecentFolder[] = JSON.parse(stored);
    // Sort by most recent first
    return folders.sort((a, b) => b.lastUploaded - a.lastUploaded);
  } catch (err) {
    console.error('Error getting recent folders:', err);
    return [];
  }
}

/**
 * Add a folder to recent folders list
 */
export function addRecentFolder(folder: Omit<RecentFolder, 'id' | 'lastUploaded'>): void {
  try {
    const existing = getRecentFolders();
    
    // Check if folder with same path already exists
    const existingIndex = existing.findIndex(f => f.path === folder.path);
    
    const newFolder: RecentFolder = {
      ...folder,
      id: crypto.randomUUID(),
      lastUploaded: Date.now(),
    };
    
    if (existingIndex >= 0) {
      // Update existing entry
      existing[existingIndex] = newFolder;
    } else {
      // Add new entry
      existing.unshift(newFolder);
    }
    
    // Keep only max recent folders
    const trimmed = existing.slice(0, MAX_RECENT_FOLDERS);
    
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Error adding recent folder:', err);
  }
}

/**
 * Remove a folder from recent folders list
 */
export function removeRecentFolder(folderId: string): void {
  try {
    const existing = getRecentFolders();
    const filtered = existing.filter(f => f.id !== folderId);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Error removing recent folder:', err);
  }
}

/**
 * Clear all recent folders (but NOT watch history)
 */
export function clearRecentFolders(): void {
  try {
    localStorage.removeItem(RECENT_FOLDERS_KEY);
  } catch (err) {
    console.error('Error clearing recent folders:', err);
  }
}

/**
 * Clear all cache including recent folders and watch history
 */
export function clearAllCache(): { success: boolean; message: string } {
  try {
    // Clear recent folders
    localStorage.removeItem(RECENT_FOLDERS_KEY);
    // Clear watch history
    localStorage.removeItem('watchHistory');
    
    return { success: true, message: 'All cache cleared successfully.' };
  } catch (err) {
    console.error('Error clearing cache:', err);
    return { success: false, message: 'Failed to clear cache.' };
  }
}
