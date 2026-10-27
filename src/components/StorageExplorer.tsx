import React, { useState, useEffect } from 'react';
import { ArrowLeft, Folder as FolderIcon, Trash2, CheckSquare, LayoutGrid, ListTree, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { listStorageFiles, storageUrl, formatBytes, trashStoragePaths, StorageFileEntry } from '../lib/electronStorage';
import { ImageViewerModal } from './ImageViewerModal';
import { VideoOrThumb } from './VideoOrThumb';

export function StorageExplorer({ folderPath, onBack, onPlay, blurEnabled, onChanged }: {
  blurEnabled?: boolean;
  folderPath: string;
  onBack: () => void;
  onPlay: (url: string, name: string) => void;
  onChanged?: () => void;
}) {
  const [files, setFiles] = useState<StorageFileEntry[]>([]);
  const [current, setCurrent] = useState(folderPath);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [galleryMode, setGalleryMode] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => { listStorageFiles().then(setFiles); }, [folderPath]);
  useEffect(() => { setCurrent(folderPath); }, [folderPath]);
  useEffect(() => { setSelected(new Set()); }, [current, selectMode]);

  const folders = files.filter(f => f.kind === 'folder').sort((a, b) => a.relPath.localeCompare(b.relPath));
  const isDirectChild = (f: StorageFileEntry, dir: string) =>
    f.relPath.startsWith(dir + '/') && !f.relPath.slice(dir.length + 1).includes('/');
  const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');

  const directFiles = files.filter(f => f.kind !== 'folder' && isDirectChild(f, current));
  const allInside = files.filter(f => f.kind !== 'folder' && f.relPath.startsWith(current + '/'));
  const subfolders = folders.filter(f => parentOf(f.relPath) === current);
  const photos = files.filter(f => f.kind === 'photo' && isDirectChild(f, current));
  const breadcrumb = current.split('/');

  const trash = async (relPaths: string[]) => {
    if (!relPaths.length) return;
    const label = relPaths.length === 1 ? `"${relPaths[0]}"` : `${relPaths.length} items`;
    if (!confirm(`Move ${label} to the Trash?`)) return;
    await trashStoragePaths(relPaths);
    setFiles(await listStorageFiles());
    setSelected(new Set());
    setSelectMode(false);
    onChanged?.();
  };

  const MediaCard = ({ f }: { f: StorageFileEntry }) => {
    const isVideo = f.kind === 'video';
    const url = storageUrl(f.relPath);
    const isSel = selected.has(f.relPath);
    const aspect = 2 / 3;
    return (
      <div
        className={`group relative bg-zinc-900/60 border rounded-xl overflow-hidden transition-all cursor-pointer ${isSel ? 'border-amber-400 ring-1 ring-amber-400' : 'border-white/10 hover:border-white/30'}`}
        onClick={() => {
          if (selectMode) {
            setSelected(s => { const n = new Set(s); n.has(f.relPath) ? n.delete(f.relPath) : n.add(f.relPath); return n; });
            return;
          }
          isVideo ? onPlay(url, f.name) : setViewerIndex(photos.indexOf(f));
        }}
        title={f.relPath}
      >
        <div className="bg-zinc-800 relative overflow-hidden" style={{ aspectRatio: `${aspect}` }}>
          {isVideo ? (
            <VideoOrThumb relPath={f.relPath} className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
          ) : (
            <img src={url} alt={f.name} loading="lazy"
              className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
          )}
          {selectMode ? (
            <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${isSel ? 'bg-amber-400 border-amber-400 text-black' : 'border-white/60 bg-black/40'}`}>
              {isSel ? '✓' : ''}
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); trash([f.relPath]); }}
              className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/60 z-10"
              title="Move to Trash"
            >
              <Trash2 size={14} className="text-zinc-300" />
            </button>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 pointer-events-none">
          <p className="text-sm text-white font-medium truncate">{f.name}</p>
          <p className="text-xs text-zinc-400">{formatBytes(f.size)}</p>
        </div>
      </div>
    );
  };

  const GalleryCard = ({ f }: { f: StorageFileEntry }) => {
    const isVideo = f.kind === 'video';
    const isSel = selected.has(f.relPath);
    return (
      <div
        className={`group relative overflow-hidden bg-zinc-900 cursor-pointer ${isSel ? 'ring-2 ring-amber-400' : 'hover:ring-1 hover:ring-amber-400/80'}`}
        onClick={() => {
          if (selectMode) {
            setSelected(s => { const n = new Set(s); n.has(f.relPath) ? n.delete(f.relPath) : n.add(f.relPath); return n; });
            return;
          }
          isVideo ? onPlay(storageUrl(f.relPath), f.name) : setViewerIndex(photos.indexOf(f));
        }}
        title={f.relPath}
      >
        {isVideo ? (
          <VideoOrThumb relPath={f.relPath} className={`w-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
        ) : (
          <img src={storageUrl(f.relPath)} alt={f.name} loading="lazy" className={`w-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
        )}
        {selectMode ? (
          <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${isSel ? 'bg-amber-400 border-amber-400 text-black' : 'border-white/60 bg-black/40'}`}>
            {isSel ? '✓' : ''}
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); trash([f.relPath]); }}
            className="absolute top-2 right-2 p-1.5 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/60 z-10"
          >
            <Trash2 size={14} className="text-zinc-300" />
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-6 pointer-events-none">
          <p className="text-xs text-white font-medium truncate">{f.name}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full">
      {/* Folder rail — collapsible */}
      <div className={`${railOpen ? 'w-60 p-4' : 'w-0 p-0'} flex-shrink-0 border-r border-white/10 overflow-y-auto transition-all duration-300 overflow-x-hidden`}>
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-4 transition-colors whitespace-nowrap"
        >
          <ArrowLeft size={16} /> Library
        </button>
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Folders</p>
        {folders.map((f) => (
          <div key={f.relPath} className="group flex items-center">
            <button
              onClick={() => setCurrent(f.relPath)}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left truncate transition-colors ${
                current === f.relPath ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
              title={f.relPath}
            >
              <FolderIcon size={14} className={current === f.relPath ? 'text-amber-400' : 'text-amber-500/60'} />
              <span className="truncate">{f.relPath}</span>
            </button>
            <button
              onClick={() => trash([f.relPath])}
              className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/30 shrink-0"
              title="Move folder to Trash"
            >
              <Trash2 size={12} className="text-zinc-500 hover:text-red-300" />
            </button>
          </div>
        ))}
      </div>

      {/* Contents */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setRailOpen(o => !o)}
              className="p-2 bg-white/10 hover:bg-white/15 rounded-lg text-zinc-300 transition-colors"
              title={railOpen ? 'Hide folder rail' : 'Show folder rail'}
            >
              {railOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <h1 className="text-3xl font-bold text-white">
              {breadcrumb[breadcrumb.length - 1]}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGalleryMode(g => !g)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${galleryMode ? 'bg-violet-500/25 text-violet-200' : 'bg-white/10 hover:bg-white/15 text-zinc-300'}`}
              title="Show all files in this folder tree as one gallery"
            >
              {galleryMode ? <ListTree size={14} /> : <LayoutGrid size={14} />}
              {galleryMode ? 'Tree' : 'Gallery'}
            </button>
            <button
              onClick={() => setSelectMode(m => !m)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${selectMode ? 'bg-amber-500/25 text-amber-200' : 'bg-white/10 hover:bg-white/15 text-zinc-300'}`}
            >
              <CheckSquare size={14} />
              {selectMode ? 'Done' : 'Select'}
            </button>
            {selectMode && selected.size > 0 && (
              <button
                onClick={() => trash([...selected])}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/25 hover:bg-red-500/35 text-red-200 rounded-lg text-xs transition-colors"
              >
                <Trash2 size={14} /> Trash {selected.size}
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-zinc-500 mb-8">{current}</p>

        {galleryMode ? (
          allInside.length === 0 ? (
            <p className="text-zinc-500">This folder is empty.</p>
          ) : (
            /* masonry — same wall as the Mindmap contents grid */
            <div style={{ columns: '200px', columnGap: 4 }}>
              {allInside.map((f) => (
                <div key={f.relPath} className="mb-1 break-inside-avoid">
                  <GalleryCard f={f} />
                </div>
              ))}
            </div>
          )
        ) : directFiles.length === 0 && subfolders.length === 0 ? (
          <p className="text-zinc-500">This folder is empty.</p>
        ) : (
          <>
            {directFiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-10 items-start">
                {directFiles.map((f) => <React.Fragment key={f.relPath}><MediaCard f={f} /></React.Fragment>)}
              </div>
            )}

            {subfolders.map((sub) => {
              const subFiles = files.filter(f => f.kind !== 'folder' && isDirectChild(f, sub.relPath));
              return (
                <div key={sub.relPath} className="mb-10">
                  <div className="flex items-center gap-2 mb-4 group">
                    <button
                      onClick={() => setCurrent(sub.relPath)}
                      className="flex items-center gap-2 group"
                    >
                      <FolderIcon size={18} className="text-amber-500/70 group-hover:text-amber-400" />
                      <h3 className="text-lg font-semibold text-white group-hover:text-amber-300 transition-colors">{sub.name}</h3>
                      <span className="text-xs text-zinc-500">{subFiles.length} items</span>
                    </button>
                    <button
                      onClick={() => trash([sub.relPath])}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/30"
                      title="Move folder to Trash"
                    >
                      <Trash2 size={14} className="text-zinc-500 hover:text-red-300" />
                    </button>
                  </div>
                  {subFiles.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 items-start">
                      {subFiles.map((f) => <React.Fragment key={f.relPath}><MediaCard f={f} /></React.Fragment>)}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <ImageViewerModal
        url={viewerIndex !== null && photos[viewerIndex] ? storageUrl(photos[viewerIndex].relPath) : null}
        name={viewerIndex !== null ? photos[viewerIndex]?.name : undefined}
        onClose={() => setViewerIndex(null)}
        hasNext={viewerIndex !== null && viewerIndex < photos.length - 1}
        hasPrevious={viewerIndex !== null && viewerIndex > 0}
        onNext={() => setViewerIndex(i => i !== null ? i + 1 : i)}
        onPrevious={() => setViewerIndex(i => i !== null ? i - 1 : i)}
      />
    </div>
  );
}
