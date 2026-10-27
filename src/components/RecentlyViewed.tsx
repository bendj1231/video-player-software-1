import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, History, Folder as FolderIcon, Film } from 'lucide-react';
import { getRecentViews, RecentView, storageUrl } from '../lib/electronStorage';
import { VideoOrThumb } from './VideoOrThumb';

export function RecentlyViewed({ onPlay, onOpenFolder, blurEnabled }: {
  onPlay: (url: string, name: string) => void;
  onOpenFolder?: (relPath: string) => void;
  blurEnabled?: boolean;
}) {
  const [items, setItems] = useState<RecentView[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = () => setItems(getRecentViews());
  useEffect(() => {
    refresh();
    window.addEventListener('wmplayer:recentViews', refresh);
    return () => window.removeEventListener('wmplayer:recentViews', refresh);
  }, []);

  if (items.length === 0) return null;

  const scroll = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 440, behavior: 'smooth' });

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History size={20} className="text-zinc-400" />
          <h2 className="text-2xl font-bold text-white">Recently Viewed</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => scroll(-1)} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center justify-center transition-colors">
            <ChevronLeft size={18} className="text-white" />
          </button>
          <button onClick={() => scroll(1)} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 flex items-center justify-center transition-colors">
            <ChevronRight size={18} className="text-white" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {items.map((v) => (
          <button
            key={v.relPath}
            onClick={() => {
              if (v.kind === 'video') {
                onPlay(`media://local/${v.relPath.split('/').map(encodeURIComponent).join('/')}`, v.name);
              } else {
                const dir = v.kind === 'folder' ? v.relPath : v.relPath.split('/').slice(0, -1).join('/');
                onOpenFolder?.(dir);
              }
            }}
            className="group shrink-0 w-40 text-left"
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-zinc-800 border border-white/10 group-hover:border-white/30 transition-colors">
              <span
                role="button"
                title="Open folder"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFolder?.(v.relPath.split('/').slice(0, -1).join('/'));
                }}
                className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-amber-500/40"
              >
                <FolderIcon size={13} className="text-amber-300" />
              </span>
              {v.kind === 'video' ? (
                <VideoOrThumb relPath={v.relPath} className={`w-full h-full object-cover ${blurEnabled ? 'blur-[20px]' : ''}`} />
              ) : v.kind === 'photo' ? (
                <img src={storageUrl(v.relPath)} alt="" loading="lazy" className={`w-full h-full object-cover ${blurEnabled ? 'blur-[20px]' : ''}`} />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-500/15 to-violet-500/10">
                  <FolderIcon size={40} className="text-amber-300/80" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-zinc-300 truncate">{v.name}</p>
            <p className="text-[10px] text-zinc-600 flex items-center gap-1">
              {v.kind === 'folder' ? <FolderIcon size={9} /> : <Film size={9} />}
              {v.kind} · {new Date(v.ts).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
