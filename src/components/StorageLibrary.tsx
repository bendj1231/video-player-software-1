import React, { useState, useEffect, useRef } from 'react';
import { Folder as FolderIcon, FolderOpen, Trash2, Plus, FolderPlus, Upload } from 'lucide-react';
import { listStorageFiles, storageUrl, deleteStoragePath, openStoragePath, importViaPicker, mkdirStorage, formatBytes, StorageFileEntry } from '../lib/electronStorage';
import { ImageViewerModal } from './ImageViewerModal';
import { VideoOrThumb } from './VideoOrThumb';

export function StorageLibrary({ onPlay, onOpenFolder, blurEnabled, refreshTrigger, onChanged }: {
  onPlay: (url: string, name: string) => void;
  blurEnabled?: boolean;
  onOpenFolder?: (relPath: string) => void;
  refreshTrigger?: number;
  onChanged?: () => void;
}) {
  const [files, setFiles] = useState<StorageFileEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = () => listStorageFiles().then(setFiles);

  useEffect(() => { refresh(); }, [refreshTrigger]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handleNewFolder = async () => {
    setMenuOpen(false);
    const name = prompt('Folder name:', 'New Folder');
    if (!name) return;
    await mkdirStorage(name);
    await refresh();
    onChanged?.();
  };

  const handleUpload = async () => {
    setMenuOpen(false);
    setImporting(true);
    try {
      const result = await importViaPicker();
      if (result?.errors?.length) {
        alert('Some items failed to import:\n' + result.errors.join('\n'));
      }
      await refresh();
      onChanged?.();
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (relPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${relPath}" from storage?`)) return;
    await deleteStoragePath(relPath);
    await refresh();
    onChanged?.();
  };

  // Only TOP-LEVEL folders and root-level files on home
  const topFolders = files.filter(f => f.kind === 'folder' && !f.relPath.includes('/'));
  const rootMedia = files.filter(f => (f.kind === 'video' || f.kind === 'photo') && !f.relPath.includes('/'));
  const rootPhotos = rootMedia.filter(f => f.kind === 'photo');

  const DeleteBtn = ({ relPath }: { relPath: string }) => (
    <button
      onClick={(e) => handleDelete(relPath, e)}
      className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/60 z-10"
    >
      <Trash2 size={14} className="text-zinc-300" />
    </button>
  );

  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-2xl font-bold text-white">Media Library</h2>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={importing}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center justify-center transition-colors disabled:opacity-50"
            title="Add to library"
          >
            <Plus size={18} className={`text-white ${importing ? 'animate-pulse' : ''}`} />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-10 z-50 w-52 bg-zinc-900 border border-white/15 rounded-xl shadow-2xl overflow-hidden">
              <button
                onClick={handleNewFolder}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-white/10 transition-colors"
              >
                <FolderPlus size={16} className="text-zinc-400" />
                New Folder
              </button>
              <button
                onClick={handleUpload}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-white/10 transition-colors"
              >
                <Upload size={16} className="text-zinc-400" />
                Upload Folder / Files
              </button>
            </div>
          )}
        </div>
        {importing && <span className="text-sm text-zinc-500">Moving files in…</span>}
      </div>

      {topFolders.length === 0 && rootMedia.length === 0 ? (
        <div className="bg-zinc-900/40 border border-dashed border-white/10 rounded-2xl p-10 text-center">
          <FolderOpen size={36} className="text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400">Drop folders here, or use + to create a folder or upload.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 items-start">
          {topFolders.map((f, i) => (
            <div
              key={f.relPath}
              className={`group relative bg-zinc-900/60 border border-white/10 rounded-xl hover:border-amber-500/40 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[180px] ${
                i === 0 && topFolders.length > 3 ? 'sm:col-span-2 sm:row-span-2' : ''
              }`}
              onClick={() => onOpenFolder ? onOpenFolder(f.relPath) : openStoragePath(f.relPath)}
              title={f.relPath}
            >
              <DeleteBtn relPath={f.relPath} />
              <FolderIcon size={i === 0 ? 52 : 36} className="text-amber-500/70 group-hover:text-amber-400 transition-colors" />
              <p className="text-sm text-white font-medium truncate mt-3 max-w-full px-3">{f.name}</p>
              <p className="text-xs text-zinc-500">Open folder</p>
            </div>
          ))}
          {rootMedia.map((f) => <React.Fragment key={f.relPath}><MediaCard
            f={f}
            onPlay={onPlay}
            onPhotoClick={() => setViewerIndex(rootPhotos.indexOf(f))}
            onDelete={handleDelete}
            blurEnabled={blurEnabled}
          /></React.Fragment>)}
        </div>
      )}

      <ImageViewerModal
        url={viewerIndex !== null && rootPhotos[viewerIndex] ? storageUrl(rootPhotos[viewerIndex].relPath) : null}
        name={viewerIndex !== null ? rootPhotos[viewerIndex]?.name : undefined}
        onClose={() => setViewerIndex(null)}
        hasNext={viewerIndex !== null && viewerIndex < rootPhotos.length - 1}
        hasPrevious={viewerIndex !== null && viewerIndex > 0}
        onNext={() => setViewerIndex(i => i !== null ? i + 1 : i)}
        onPrevious={() => setViewerIndex(i => i !== null ? i - 1 : i)}
      />
    </div>
  );
}

function MediaCard({ f, onPlay, onPhotoClick, onDelete, blurEnabled }: {
  f: StorageFileEntry;
  onPlay: (url: string, name: string) => void;
  blurEnabled?: boolean;
  onPhotoClick: () => void;
  onDelete: (relPath: string, e: React.MouseEvent) => void;
}) {
  const isVideo = f.kind === 'video';
  const url = storageUrl(f.relPath);
  const [ratio, setRatio] = useState<number | null>(null);
  const aspect = 2 / 3; // uniform 2:3 vertical tiles

  return (
    <div
      className="group relative bg-zinc-900/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 transition-all cursor-pointer"
      onClick={() => isVideo ? onPlay(url, f.name) : onPhotoClick()}
      title={f.relPath}
    >
      <div className="bg-zinc-800 relative" style={{ aspectRatio: `${aspect}` }}>
        {isVideo ? (
          <VideoOrThumb relPath={f.relPath} className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
        ) : (
          <img
            src={url}
            alt={f.name}
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
            }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <button
          onClick={(e) => onDelete(f.relPath, e)}
          className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/60 z-10"
        >
          <Trash2 size={14} className="text-zinc-300" />
        </button>
        {isVideo && (
          <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 pointer-events-none">
          <p className="text-sm text-white font-medium truncate">{f.name}</p>
          <p className="text-xs text-zinc-400">{formatBytes(f.size)}</p>
        </div>
      </div>
    </div>
  );
}
