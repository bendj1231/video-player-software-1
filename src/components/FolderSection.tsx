import { useState, useEffect } from 'react';
import { Folder, getFolders, getVideosByFolder } from '../lib/db';
import { FolderIcon, ChevronRight, HardDrive } from 'lucide-react';
import { getStoredDirectoryHandle } from '../lib/fileSystem';

interface FolderSectionProps {
  onSelectFolder: (id: string) => void;
  blurEnabled?: boolean;
  theme?: 'dark' | 'light' | 'futuristic' | 'smokey';
}

interface FolderWithCount extends Folder {
  videoCount: number;
  localFileCount: number;
}

const themeColors = {
  dark: {
    folder: 'bg-gradient-to-br from-zinc-700 to-zinc-800',
    tab: 'bg-zinc-600',
    icon: 'text-zinc-300',
    hover: 'hover:from-zinc-600 hover:to-zinc-700',
    synced: 'from-emerald-600/30 to-emerald-700/30',
    syncedTab: 'bg-emerald-500/40',
  },
  light: {
    folder: 'bg-gradient-to-br from-zinc-200 to-zinc-300',
    tab: 'bg-zinc-300',
    icon: 'text-zinc-600',
    hover: 'hover:from-zinc-300 hover:to-zinc-400',
    synced: 'from-emerald-400/50 to-emerald-500/50',
    syncedTab: 'bg-emerald-400/60',
  },
  futuristic: {
    folder: 'bg-gradient-to-br from-cyan-600/40 to-blue-700/40',
    tab: 'bg-cyan-500/50',
    icon: 'text-cyan-300',
    hover: 'hover:from-cyan-500/50 hover:to-blue-600/50',
    synced: 'from-emerald-500/40 to-cyan-600/40',
    syncedTab: 'bg-emerald-400/50',
  },
  smokey: {
    folder: 'bg-gradient-to-br from-neutral-600/60 to-neutral-700/60',
    tab: 'bg-neutral-500/50',
    icon: 'text-neutral-300',
    hover: 'hover:from-neutral-500/60 hover:to-neutral-600/60',
    synced: 'from-emerald-500/30 to-emerald-600/30',
    syncedTab: 'bg-emerald-400/40',
  },
};

export function FolderSection({ onSelectFolder, blurEnabled, theme = 'dark' }: FolderSectionProps) {
  const [folders, setFolders] = useState<FolderWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFolders();
  }, []);

  async function loadFolders() {
    setIsLoading(true);
    const folderList = await getFolders();
    
    const withCounts = await Promise.all(
      folderList.map(async (folder) => {
        const videos = await getVideosByFolder(folder.id);
        
        // Try to get local folder file count if synced
        let localFileCount = 0;
        if (folder.localFolderPath) {
          try {
            const handle = await getStoredDirectoryHandle(folder.id);
            if (handle) {
              // @ts-ignore
              for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                  localFileCount++;
                }
              }
            }
          } catch (err) {
            console.log('Could not access local folder for count:', folder.name);
          }
        }
        
        return { ...folder, videoCount: videos.length, localFileCount };
      })
    );
    
    setFolders(withCounts);
    setIsLoading(false);
  }

  const colors = themeColors[theme];

  if (isLoading) {
    return (
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Your Folders</h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="shrink-0 w-32 h-40 bg-white/10 rounded-t-lg rounded-b-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className={`mb-8 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
        <h2 className="text-xl font-semibold text-white mb-4">Your Folders</h2>
        <div className="p-8 glass-card rounded-2xl text-center text-zinc-400">
          <FolderIcon size={48} className="mx-auto mb-4 opacity-40" />
          <p>No folders yet. Create one to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-8 transition-all duration-300 ${blurEnabled ? 'blur-[20px]' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <button 
          onClick={() => onSelectFolder('')} 
          className="group flex items-center gap-2"
        >
          <h2 className="text-xl font-semibold text-white group-hover:text-violet-400 transition-colors">Your Folders</h2>
          <ChevronRight size={20} className="text-zinc-500 group-hover:text-violet-400 group-hover:translate-x-1 transition-all" />
        </button>
        <span className="text-zinc-500 text-sm">{folders.length} folders</span>
      </div>
      
      <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
        {folders.map((folder) => {
          const isSynced = !!folder.localFolderPath;
          const folderClass = isSynced 
            ? `bg-gradient-to-br ${colors.synced} ${colors.syncedTab}`
            : `${colors.folder} ${colors.tab} ${colors.hover}`;

          return (
            <button
              key={folder.id}
              onClick={() => onSelectFolder(folder.id)}
              className="group shrink-0 relative"
            >
              {/* Folder Tab */}
              <div className={`absolute -top-3 left-4 w-16 h-6 rounded-t-lg ${isSynced ? colors.syncedTab : colors.tab} opacity-90`} />
              
              {/* Folder Body */}
              <div className={`relative w-32 h-40 rounded-t-lg rounded-b-2xl ${folderClass} backdrop-blur-sm border border-white/10 shadow-xl transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl flex flex-col items-center justify-center gap-3`}>
                {/* Folder Icon */}
                <div className="relative">
                  <FolderIcon size={48} className={`${colors.icon} drop-shadow-lg`} strokeWidth={1.5} />
                  {isSynced && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                      <HardDrive size={12} className="text-white" />
                    </div>
                  )}
                </div>
                
                {/* Folder Info */}
                <div className="text-center px-2">
                  <p className="text-white font-medium truncate text-sm max-w-[100px]">{folder.name}</p>
                  <p className="text-white/50 text-xs">
                    {folder.videoCount > 0 
                      ? `${folder.videoCount} files`
                      : '0 files'
                    }
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
