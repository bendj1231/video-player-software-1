import React, { useState, useEffect } from 'react';
import { Folder as FolderIcon, FolderOpen } from 'lucide-react';
import { listStorageFiles, storageUrl, formatBytes, StorageFileEntry } from '../lib/electronStorage';

interface FolderCard {
  name: string;
  relPath: string;
  preview?: StorageFileEntry;
  count: number;
  bytes: number;
}

export function StorageGalleries({ onOpenFolder, blurEnabled, refreshTrigger }: {
  blurEnabled?: boolean;
  onOpenFolder: (relPath: string) => void;
  refreshTrigger?: number;
}) {
  const [cards, setCards] = useState<FolderCard[]>([]);
  const [looseCount, setLooseCount] = useState(0);

  useEffect(() => {
    listStorageFiles().then((files) => {
      const media = files.filter(f => f.kind === 'video' || f.kind === 'photo');
      const topFolders = files.filter(f => f.kind === 'folder' && !f.relPath.includes('/'));

      const built = topFolders.map((folder) => {
        const inside = media.filter(f => f.relPath.startsWith(folder.relPath + '/'));
        const preview = inside.find(f => f.kind === 'video') || inside[0];
        return {
          name: folder.name,
          relPath: folder.relPath,
          preview,
          count: inside.length,
          bytes: inside.reduce((s, f) => s + f.size, 0),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      setCards(built);
      setLooseCount(media.filter(f => !f.relPath.includes('/')).length);
    });
  }, [refreshTrigger]);

  return (
    <div className="p-10 w-full">
      <h1 className="text-5xl font-bold text-white mb-8 tracking-tight">Galleries</h1>

      {cards.length === 0 && looseCount === 0 ? (
        <div className="bg-zinc-900/40 border border-dashed border-white/10 rounded-2xl p-16 text-center">
          <FolderOpen size={48} className="text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400 text-lg">No folders in storage yet.</p>
          <p className="text-zinc-600 text-sm mt-1">Import folders from Home — they'll appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 items-start">
          {cards.map((c) => {
            const previewUrl = c.preview ? storageUrl(c.preview.relPath) : null;
            return (
              <div
                key={c.relPath}
                className="group relative bg-zinc-900/60 border border-white/10 rounded-xl overflow-hidden hover:border-amber-500/40 transition-all cursor-pointer"
                onClick={() => onOpenFolder(c.relPath)}
                title={c.relPath}
              >
                <div className="bg-zinc-800 relative" style={{ aspectRatio: '0.75' }}>
                  {previewUrl && c.preview?.kind === 'video' ? (
                    <video src={previewUrl} muted loop playsInline autoPlay preload="metadata" className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt={c.name} loading="lazy" className={`absolute inset-0 w-full h-full object-cover ${blurEnabled ? 'blur-[35px] scale-125 saturate-0 brightness-75' : ''}`} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FolderIcon size={44} className="text-amber-500/60" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-8 pointer-events-none">
                    <p className="text-sm text-white font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-zinc-400">{c.count} items · {formatBytes(c.bytes)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
