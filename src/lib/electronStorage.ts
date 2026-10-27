// Typed wrapper around the Electron preload bridge (window.wmplayer).
// Falls back gracefully in the browser where the bridge doesn't exist.

export interface StorageStats {
  dir: string;
  videos: number;
  photos: number;
  other: number;
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
}

export interface StorageFileEntry {
  name: string;
  relPath: string;
  kind: 'video' | 'photo' | 'folder' | 'other';
  size: number;
  modifiedAt: number;
}

interface WmplayerBridge {
  pickFile: (opts?: any) => Promise<string[]>;
  pickFolder: () => Promise<string | null>;
  saveDialog: (defaultName: string) => Promise<string | null>;
  getStorageDir: () => Promise<string>;
  setStorageDir: () => Promise<string | null>;
  getStorageStats: () => Promise<StorageStats>;
  listStorageFiles: () => Promise<StorageFileEntry[]>;
  saveFileToStorage: (relPath: string, data: ArrayBuffer | Uint8Array) => Promise<string>;
  importPaths: (paths: string[], destDir?: string) => Promise<{ files: number; bytes: number; errors: string[] }>;
  importPick: () => Promise<{ files: number; bytes: number; errors: string[] } | null>;
  mkdirStorage: (name: string, parentRel?: string) => Promise<string>;
  moveStoragePath: (src: string, destDir?: string) => Promise<{ success: boolean; relPath?: string; error?: string }>;
  renameStoragePath: (src: string, newName: string) => Promise<{ success: boolean; relPath?: string; error?: string }>;
  deleteStoragePath: (relPath: string) => Promise<{ success: boolean; error?: string }>;
  openStoragePath: (relPath: string) => Promise<string>;
  openInVlc: (relPath: string) => Promise<{ success: boolean; error?: string }>;
  trashStoragePaths: (relPaths: string[]) => Promise<{ success: boolean; results?: any[] }>;
  vlcStart: (relPath: string, width?: number) => Promise<{ success: boolean; error?: string }>;
  vlcCtl: (cmd: string) => Promise<{ success: boolean; error?: string }>;
  vlcStop: () => Promise<{ success: boolean }>;
  onVlcFrame: (cb: (data: { w: number; h: number; data: Uint8Array }) => void) => () => void;
  onVlcEnded: (cb: () => void) => () => void;
  getPathForFile: (file: File) => string;
  getThumbnail: (relPath: string) => Promise<string | null>;
  transcode: (relPath: string) => Promise<{ url: string; pending?: boolean; done?: boolean; error?: string } | null>;
  onTranscodeDone: (cb: (data: { key: string; ok: boolean }) => void) => () => void;
  storageUrl: (relPath: string) => string;
  platform: string;
  isElectron: true;
}

declare global {
  interface Window {
    wmplayer?: WmplayerBridge;
  }
}

export function isElectron(): boolean {
  return !!window.wmplayer?.isElectron;
}

export async function getStorageDir(): Promise<string | null> {
  return window.wmplayer?.getStorageDir() ?? null;
}

export async function pickStorageDir(): Promise<string | null> {
  return window.wmplayer?.setStorageDir() ?? null;
}

export async function getStorageStats(): Promise<StorageStats | null> {
  return window.wmplayer?.getStorageStats() ?? null;
}

export async function listStorageFiles(): Promise<StorageFileEntry[]> {
  return window.wmplayer?.listStorageFiles() ?? [];
}

export async function saveFileToStorage(relPath: string, blob: Blob): Promise<string | null> {
  if (!window.wmplayer) return null;
  const buf = await blob.arrayBuffer();
  return window.wmplayer.saveFileToStorage(relPath, buf);
}

export function pathsFromFiles(fileList: Iterable<File>): string[] {
  if (!window.wmplayer) return [];
  const paths: string[] = [];
  for (const file of fileList) {
    try {
      const p = window.wmplayer.getPathForFile(file);
      if (p) paths.push(p);
    } catch {}
  }
  return paths;
}

export async function importPaths(paths: string[], destDir?: string): Promise<{ files: number; bytes: number; errors: string[] } | null> {
  if (!window.wmplayer || paths.length === 0) return null;
  return window.wmplayer.importPaths(paths, destDir);
}

export async function importViaPicker(): Promise<{ files: number; bytes: number; errors: string[] } | null> {
  return window.wmplayer?.importPick() ?? null;
}

export async function mkdirStorage(name: string, parentRel?: string): Promise<string | null> {
  return window.wmplayer?.mkdirStorage(name, parentRel) ?? null;
}

export async function moveStoragePath(src: string, destDir?: string): Promise<{ success: boolean; relPath?: string; error?: string } | null> {
  return window.wmplayer?.moveStoragePath(src, destDir) ?? null;
}

export async function renameStoragePath(src: string, newName: string): Promise<{ success: boolean; relPath?: string; error?: string } | null> {
  return window.wmplayer?.renameStoragePath(src, newName) ?? null;
}

export async function deleteStoragePath(relPath: string): Promise<boolean> {
  return (await window.wmplayer?.deleteStoragePath(relPath))?.success ?? false;
}

export async function openStoragePath(relPath: string): Promise<void> {
  await window.wmplayer?.openStoragePath(relPath);
}

export async function openInVlc(relPath: string): Promise<{ success: boolean; error?: string } | null> {
  return window.wmplayer?.openInVlc(relPath) ?? null;
}

export async function trashStoragePaths(relPaths: string[]): Promise<boolean> {
  const r = await window.wmplayer?.trashStoragePaths(relPaths);
  return !!r?.success;
}

// ── Recently viewed log (localStorage, newest first, max 20) ──
export interface RecentView { relPath: string; name: string; kind: 'video' | 'photo' | 'folder'; ts: number }

export function logRecentView(v: Omit<RecentView, 'ts'>): void {
  try {
    const list: RecentView[] = JSON.parse(localStorage.getItem('wmplayer.recentViews') || '[]');
    const next = [{ ...v, ts: Date.now() }, ...list.filter(x => x.relPath !== v.relPath)].slice(0, 20);
    localStorage.setItem('wmplayer.recentViews', JSON.stringify(next));
    window.dispatchEvent(new Event('wmplayer:recentViews'));
  } catch {}
}

export function getRecentViews(): RecentView[] {
  try { return JSON.parse(localStorage.getItem('wmplayer.recentViews') || '[]'); } catch { return []; }
}

export async function getThumbnail(relPath: string): Promise<string | null> {
  return window.wmplayer?.getThumbnail(relPath) ?? null;
}

export async function transcodeForPlayback(relPath: string): Promise<string | null> {
  const r = await window.wmplayer?.transcode(relPath);
  return r?.url ?? null;
}

export function onTranscodeDone(cb: (data: { key: string; ok: boolean }) => void): () => void {
  return window.wmplayer?.onTranscodeDone(cb) ?? (() => {});
}

// Extract storage relPath from a media://local/<path> URL
export function relPathFromMediaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/^\/+/, '') || null;
  } catch { return null; }
}

export function storageUrl(relPath: string): string {
  return window.wmplayer?.storageUrl(relPath) ?? '';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
