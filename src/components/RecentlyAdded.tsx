import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock, Folder as FolderIcon } from 'lucide-react';
import { listStorageFiles, storageUrl, formatBytes, StorageFileEntry } from '../lib/electronStorage';
import { VideoOrThumb } from './VideoOrThumb';

const MAX_ITEMS = 12;

export function RecentlyAdded({ onPlay, onOpenFolder, blurEnabled, refreshTrigger }: {
  onPlay: (url: string, name: string) => void;
  onOpenFolder?: (relPath: string) => void;
  blurEnabled?: boolean;
  refreshTrigger?: number;
}) {
  const [items, setItems] = useState<StorageFileEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listStorageFiles().then((files) => {
      const videos = files
        .filter(f => f.kind === 'video')
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, MAX_ITEMS);
      setItems(videos);
    });
  }, [refreshTrigger]);

  if (items.length === 0) return null;

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 440, behavior: 'smooth' });
  };

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={20} className="text-zinc-400" />
          <h2 className="text-2xl font-bold text-white">Recently Added</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => scroll(-1)}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={18} className="text-white" />
          </button>
          <button
            onClick={() => scroll(1)}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center justify-center transition-colors"
          >
            <ChevronRight size={18} className="text-white" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide items-start"
        style={{ scrollbarWidth: 'none' }}
      >
        {items.map((f) => (
          <React.Fragment key={f.relPath}>
            <VideoCard file={f} onPlay={onPlay} onOpenFolder={onOpenFolder} blurEnabled={blurEnabled} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function VideoCard({ file, onPlay, onOpenFolder, blurEnabled }: { file: StorageFileEntry; onPlay: (url: string, name: string) => void; onOpenFolder?: (relPath: string) => void; blurEnabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const url = storageUrl(file.relPath);
  const folder = file.relPath.includes('/') ? file.relPath.split('/').slice(0, -1).join('/') : '';

  // Clamp between 9:16 portrait and 2.39:1 ultrawide
  const aspect = 2 / 3; // uniform 2:3 vertical tiles

  return (
    <div
      className="group flex-shrink-0 bg-zinc-900/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 transition-all cursor-pointer"
      style={{ width: 260 }}
      onClick={() => onPlay(url, file.name)}
      title={file.relPath}
    >
      <div className="bg-zinc-800 relative overflow-hidden" style={{ aspectRatio: `${aspect}` }}>
        <VideoOrThumb relPath={file.relPath} className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
        {folder && onOpenFolder && (
          <span
            role="button"
            title={`Open folder: ${folder}`}
            onClick={(e) => { e.stopPropagation(); onOpenFolder(folder); }}
            className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/40"
          >
            <FolderIcon size={13} className="text-amber-300" />
          </span>
        )}
        <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 pointer-events-none">
          <p className="text-sm text-white font-medium truncate">{file.name}</p>
          <p className="text-xs text-zinc-400 truncate">
            {folder && <span className="mr-2">{folder}</span>}
            {formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
