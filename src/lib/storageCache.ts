// Storage cache manager for controlling IndexedDB size limits
// Prevents the app from using too much RAM by enforcing configurable cache limits

export type CacheSizeLimit = 500 | 2048 | 3072; // MB

const STORAGE_KEY = 'video-vault-cache-settings';

interface CacheSettings {
  maxSizeMB: CacheSizeLimit;
  evictionPolicy: 'oldest-first' | 'largest-first';
}

const DEFAULT_SETTINGS: CacheSettings = {
  maxSizeMB: 2048, // Default 2GB
  evictionPolicy: 'oldest-first'
};

// Cache size options for the UI
export const CACHE_SIZE_OPTIONS: { value: CacheSizeLimit; label: string }[] = [
  { value: 500, label: '500 MB' },
  { value: 2048, label: '2 GB' },
  { value: 3072, label: '3 GB' }
];

export function getCacheSettings(): CacheSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (err) {
    console.error('Error reading cache settings:', err);
  }
  return DEFAULT_SETTINGS;
}

export function setCacheSettings(settings: Partial<CacheSettings>): void {
  try {
    const current = getCacheSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Error saving cache settings:', err);
  }
}

// Calculate the size of a video in MB
export function getVideoSizeMB(video: { file: Blob }): number {
  return video.file.size / (1024 * 1024);
}

// Calculate total cache size from all videos
export async function calculateTotalCacheSize(
  getAllVideos: () => Promise<{ id: string; file: Blob; createdAt: number }[]>
): Promise<{ totalMB: number; videos: { id: string; sizeMB: number; createdAt: number }[] }> {
  const videos = await getAllVideos();
  const videosWithSize = videos.map(v => ({
    id: v.id,
    sizeMB: getVideoSizeMB(v),
    createdAt: v.createdAt
  }));
  
  const totalMB = videosWithSize.reduce((sum, v) => sum + v.sizeMB, 0);
  
  return { totalMB, videos: videosWithSize };
}

// Check if adding a new video would exceed the cache limit
export function wouldExceedCacheLimit(
  currentSizeMB: number,
  newVideoSizeMB: number,
  maxSizeMB: number
): boolean {
  return (currentSizeMB + newVideoSizeMB) > maxSizeMB;
}

// Get videos to evict to make room for new content
export function getVideosToEvict(
  videos: { id: string; sizeMB: number; createdAt: number }[],
  spaceNeededMB: number,
  policy: 'oldest-first' | 'largest-first'
): string[] {
  const sorted = [...videos];
  
  if (policy === 'oldest-first') {
    sorted.sort((a, b) => a.createdAt - b.createdAt);
  } else {
    sorted.sort((a, b) => b.sizeMB - a.sizeMB);
  }
  
  const toEvict: string[] = [];
  let spaceFreed = 0;
  
  for (const video of sorted) {
    if (spaceFreed >= spaceNeededMB) break;
    toEvict.push(video.id);
    spaceFreed += video.sizeMB;
  }
  
  return toEvict;
}

// Format bytes to human readable
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get cache usage percentage
export function getCacheUsagePercent(usedMB: number, maxMB: number): number {
  return Math.min(100, Math.round((usedMB / maxMB) * 100));
}
