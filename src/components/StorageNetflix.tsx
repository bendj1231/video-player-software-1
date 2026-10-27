import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Folder as FolderIcon } from 'lucide-react';
import { listStorageFiles, storageUrl, formatBytes, StorageFileEntry } from '../lib/electronStorage';
import { VideoOrThumb } from './VideoOrThumb';

interface Row {
  folder: string;
  items: StorageFileEntry[];
}

export function StorageNetflix({ onPlay, onOpenFolder, blurEnabled, refreshTrigger }: {
  blurEnabled?: boolean;
  onPlay: (url: string, name: string) => void;
  onOpenFolder: (relPath: string) => void;
  refreshTrigger?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [hero, setHero] = useState<StorageFileEntry | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    listStorageFiles().then((files) => {
      const media = files
        .filter(f => f.kind === 'video')
        .sort((a, b) => b.modifiedAt - a.modifiedAt);

      setHero(media[0] || null);

      const groups = new Map<string, StorageFileEntry[]>();
      for (const f of media) {
        const dir = f.relPath.includes('/') ? f.relPath.split('/').slice(0, -1).join('/') : 'Unsorted';
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir)!.push(f);
      }
      setRows([...groups.entries()]
        .map(([folder, items]) => ({ folder, items }))
        .sort((a, b) => b.items[0].modifiedAt - a.items[0].modifiedAt));
    });
  }, [refreshTrigger]);

  const scroll = (key: string, dir: number) => {
    rowRefs.current[key]?.scrollBy({ left: dir * 660, behavior: 'smooth' });
  };

  if (!hero) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center">
        <p className="text-zinc-500 text-lg">No videos in storage yet.</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen pb-16">
      {/* Hero - newest video playing */}
      <div className="relative w-full aspect-[21/9] max-h-[65vh] overflow-hidden cursor-pointer" onClick={() => onPlay(storageUrl(hero.relPath), hero.name)}>
        <video
          src={storageUrl(hero.relPath)}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020202] via-transparent to-transparent" />
        <div className="absolute bottom-8 left-10 pointer-events-none">
          <p className="text-xs uppercase tracking-widest text-red-500 font-semibold mb-2">Recently Added</p>
          <h1 className="text-4xl font-bold text-white drop-shadow-lg max-w-2xl truncate">{hero.name}</h1>
          <p className="text-sm text-zinc-300 mt-2">{formatBytes(hero.size)} · {new Date(hero.modifiedAt).toLocaleDateString()}</p>
        </div>
      </div>

      {/* Rows per folder */}
      <div className="-mt-6 relative z-10 space-y-8 px-6">
        {rows.map((row) => (
          <div key={row.folder}>
            <button
              onClick={() => row.folder !== 'Unsorted' && onOpenFolder(row.folder)}
              className="flex items-center gap-2 mb-3 group"
            >
              <FolderIcon size={16} className="text-amber-500/70 group-hover:text-amber-400" />
              <h2 className="text-lg font-semibold text-white group-hover:text-amber-300 transition-colors">{row.folder}</h2>
              <span className="text-xs text-zinc-500">{row.items.length}</span>
            </button>
            <div className="relative">
              <button
                onClick={() => scroll(row.folder, -1)}
                className="absolute -left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/70 border border-white/15 flex items-center justify-center hover:bg-zinc-700 transition-colors"
              >
                <ChevronLeft size={18} className="text-white" />
              </button>
              <button
                onClick={() => scroll(row.folder, 1)}
                className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/70 border border-white/15 flex items-center justify-center hover:bg-zinc-700 transition-colors"
              >
                <ChevronRight size={18} className="text-white" />
              </button>
              <div
                ref={(el) => { rowRefs.current[row.folder] = el; }}
                className="flex gap-3 overflow-x-auto pb-2 items-start"
                style={{ scrollbarWidth: 'none' }}
              >
                {row.items.map((f) => (
                  <div
                    key={f.relPath}
                    className="group relative flex-shrink-0 w-56 bg-zinc-900/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/30 hover:scale-[1.03] transition-all cursor-pointer"
                    onClick={() => onPlay(storageUrl(f.relPath), f.name)}
                    title={f.relPath}
                  >
                    <div className="bg-zinc-800 relative" style={{ aspectRatio: '0.6667' }}>
                      <VideoOrThumb relPath={f.relPath} className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-6 pointer-events-none">
                        <p className="text-xs text-white font-medium truncate">{f.name}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
