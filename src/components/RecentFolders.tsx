import { useState, useEffect } from 'react';
import { FolderOpen, Clock, Trash2, RefreshCw, Upload } from 'lucide-react';
import { getRecentFolders, removeRecentFolder, RecentFolder } from '../lib/recentFolders';

interface RecentFoldersProps {
  onReupload: (folderPath: string) => void;
  isDarkMode?: boolean;
}

export function RecentFolders({ onReupload, isDarkMode = true }: RecentFoldersProps) {
  const [folders, setFolders] = useState<RecentFolder[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    loadRecentFolders();
  }, []);

  function loadRecentFolders() {
    const recent = getRecentFolders();
    setFolders(recent);
  }

  function handleRemove(id: string) {
    removeRecentFolder(id);
    loadRecentFolders();
  }

  function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  if (folders.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-2xl border border-white/10 overflow-hidden ${isDarkMode ? 'bg-zinc-900/50' : 'bg-white/50'}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Clock size={20} className="text-emerald-400" />
          <h3 className={`font-medium ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
            Recent Uploads
          </h3>
          <span className="text-sm text-zinc-500">({folders.length})</span>
        </div>
        <div className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-400">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="px-6 pb-4">
          <div className="flex flex-col gap-2">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className={`flex items-center gap-3 p-3 rounded-xl border border-white/10 ${
                  isDarkMode 
                    ? 'bg-zinc-800/50 hover:bg-zinc-800' 
                    : 'bg-white hover:bg-zinc-50'
                } transition-colors group`}
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <FolderOpen size={20} className="text-emerald-400" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                    {folder.name}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {formatTimeAgo(folder.lastUploaded)}
                    {folder.fileCount && ` • ${folder.fileCount} files`}
                  </p>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onReupload(folder.path)}
                    className="p-2 hover:bg-emerald-500/20 rounded-lg transition-colors text-emerald-400"
                    title="Re-sync folder"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button
                    onClick={() => handleRemove(folder.id)}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
                    title="Remove from recent"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {folders.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500 text-center">
              Click the refresh icon to quickly re-sync a folder
            </p>
          )}
        </div>
      )}
    </div>
  );
}
