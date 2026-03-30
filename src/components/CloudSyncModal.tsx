import { useState, useEffect } from 'react';
import { Cloud, CloudDownload, CloudUpload, Trash2, X, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoZip, getVideosByFolder, addVideoZip, deleteVideoZip } from '../lib/db';
import { listCloudVideos, downloadVideoFromCloud, uploadVideoToCloud, deleteVideoFromCloud } from '../lib/supabase';

interface CloudSyncModalProps {
  folderId: string;
  folderName: string;
  onClose: () => void;
}

interface CloudVideo {
  id: string;
  name: string;
  createdAt: string;
  size: number;
  isLocal: boolean;
  isSynced: boolean;
}

export function CloudSyncModal({ folderId, folderName, onClose }: CloudSyncModalProps) {
  const [cloudVideos, setCloudVideos] = useState<CloudVideo[]>([]);
  const [localVideos, setLocalVideos] = useState<VideoZip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadVideos();
  }, [folderId]);

  async function loadVideos() {
    setIsLoading(true);
    try {
      // Load local videos
      const locals = await getVideosByFolder(folderId);
      setLocalVideos(locals);

      // Load cloud videos
      const cloudFiles = await listCloudVideos(folderId);
      const cloudVids: CloudVideo[] = cloudFiles
        .filter(f => f.name.endsWith('.zip'))
        .map(f => {
          const match = f.name.match(/^(.+)_(.+)\.zip$/);
          const id = match ? match[1] : f.name;
          const name = match ? match[2] : f.name.replace('.zip', '');
          const localMatch = locals.find(v => v.id === id);
          return {
            id,
            name,
            createdAt: f.created_at || '',
            size: f.metadata?.size || 0,
            isLocal: !!localMatch,
            isSynced: !!localMatch,
          };
        });
      
      // Add local-only videos
      const localOnly = locals
        .filter(v => !cloudVids.find(cv => cv.id === v.id))
        .map(v => ({
          id: v.id,
          name: v.name,
          createdAt: new Date(v.createdAt).toISOString(),
          size: v.file.size,
          isLocal: true,
          isSynced: false,
        }));
      
      setCloudVideos([...cloudVids, ...localOnly]);
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
    setIsLoading(false);
  }

  const handleDownload = async (video: CloudVideo) => {
    setSyncingIds(prev => new Set(prev).add(video.id));
    try {
      const blob = await downloadVideoFromCloud(folderId, video.id, video.name);
      const newVideo: VideoZip = {
        id: video.id,
        folderId,
        name: video.name,
        file: blob,
        createdAt: Date.now(),
      };
      await addVideoZip(newVideo);
      await loadVideos();
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download from cloud');
    }
    setSyncingIds(prev => {
      const next = new Set(prev);
      next.delete(video.id);
      return next;
    });
  };

  const handleUpload = async (videoId: string) => {
    const video = localVideos.find(v => v.id === videoId);
    if (!video) return;
    
    setSyncingIds(prev => new Set(prev).add(videoId));
    try {
      await uploadVideoToCloud(folderId, videoId, video.file, video.name);
      await loadVideos();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload to cloud');
    }
    setSyncingIds(prev => {
      const next = new Set(prev);
      next.delete(videoId);
      return next;
    });
  };

  const handleDeleteLocal = async (videoId: string) => {
    if (!confirm('Delete this video from local storage? It will remain in the cloud if synced.')) return;
    try {
      await deleteVideoZip(videoId);
      await loadVideos();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleDeleteCloud = async (video: CloudVideo) => {
    if (!confirm('Delete this video from cloud storage?')) return;
    try {
      await deleteVideoFromCloud(folderId, video.id, video.name);
      await loadVideos();
    } catch (err) {
      console.error('Cloud delete failed:', err);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-card w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Cloud className="text-emerald-400" size={24} />
            <h2 className="text-xl font-semibold text-white">Cloud Sync - {folderName}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={20} className="text-white" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-emerald-400" size={32} />
            </div>
          ) : cloudVideos.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              <Cloud size={48} className="mx-auto mb-4 opacity-40" />
              <p>No videos in cloud or local storage</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cloudVideos.map(video => (
                <div
                  key={video.id}
                  className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{video.name}</p>
                    <div className="flex items-center gap-3 text-sm text-zinc-400 mt-1">
                      <span>{formatSize(video.size)}</span>
                      {video.isLocal && video.isSynced && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Check size={14} /> Synced
                        </span>
                      )}
                      {video.isLocal && !video.isSynced && (
                        <span className="text-amber-400">Local only</span>
                      )}
                      {!video.isLocal && (
                        <span className="text-blue-400">Cloud only</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!video.isLocal && (
                      <button
                        onClick={() => handleDownload(video)}
                        disabled={syncingIds.has(video.id)}
                        className="p-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-full transition-all disabled:opacity-50"
                        title="Download from cloud"
                      >
                        {syncingIds.has(video.id) ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <CloudDownload size={18} />
                        )}
                      </button>
                    )}

                    {video.isLocal && !video.isSynced && (
                      <button
                        onClick={() => handleUpload(video.id)}
                        disabled={syncingIds.has(video.id)}
                        className="p-2.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-full transition-all disabled:opacity-50"
                        title="Upload to cloud"
                      >
                        {syncingIds.has(video.id) ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <CloudUpload size={18} />
                        )}
                      </button>
                    )}

                    {video.isLocal && (
                      <button
                        onClick={() => handleDeleteLocal(video.id)}
                        className="p-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-full transition-all"
                        title="Delete from local"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}

                    {!video.isLocal && (
                      <button
                        onClick={() => handleDeleteCloud(video)}
                        className="p-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-full transition-all"
                        title="Delete from cloud"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 bg-white/5">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Cloud size={16} />
            <span>Cloud storage keeps your videos safe and accessible from anywhere</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
