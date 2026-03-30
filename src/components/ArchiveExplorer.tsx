import React, { useState, useRef, useEffect } from 'react';
import { VirtualArchiveExplorer, TempFileManager, ArchiveFile } from '../lib/archive';
import { Play, Lock, File, Folder, Download, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ArchiveExplorerProps {
  file: File;
  onPlay: (filePath: string) => void;
  onClose: () => void;
}

export function ArchiveExplorer({ file, onPlay, onClose }: ArchiveExplorerProps) {
  const [explorer] = useState(() => new VirtualArchiveExplorer());
  const [tempManager] = useState(() => new TempFileManager());
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadArchive();
  }, []);

  useEffect(() => {
    if (showPassword && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [showPassword]);

  const loadArchive = async () => {
    try {
      setIsLoading(true);
      setError('');
      await explorer.loadArchive(file);
      
      const archiveInfo = explorer.getArchiveInfo();
      if (archiveInfo.hasPassword) {
        setShowPassword(true);
      } else {
        const fileList = await explorer.listFiles();
        setFiles(fileList);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    try {
      setIsLoading(true);
      setError('');
      await explorer.setPassword(password);
      setShowPassword(false);
      
      const fileList = await explorer.listFiles();
      setFiles(fileList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilePlay = async (fileName: string) => {
    if (isPlaying) return;

    try {
      setIsPlaying(true);
      setSelectedFile(fileName);
      setError('');
      
      // Create temp directory
      const tempPath = await tempManager.createTempFile();
      
      // Extract and play the file
      const filePath = await explorer.extractVideoFile(fileName, tempPath);
      onPlay(filePath);
      
      // Cleanup after a delay to allow playback to start
      setTimeout(() => {
        tempManager.cleanupFile(filePath);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract file');
    } finally {
      setIsPlaying(false);
      setSelectedFile(null);
    }
  };

  const handleCleanup = async () => {
    try {
      await tempManager.cleanup();
      onClose();
    } catch (err) {
      console.error('Cleanup error:', err);
      onClose();
    }
  };

  const getIcon = (fileName: string) => {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    if (fileName.endsWith('/')) return <Folder size={20} />;
    if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mcgi'].includes(ext)) {
      return <Play size={20} />;
    }
    return <File size={20} />;
  };

  const formatFileSize = (size: number) => {
    if (size === 0) return 'Unknown size';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${Math.round(size / (1024 * 1024))} MB`;
  };

  if (showPassword) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-center justify-center z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white/10 glass-card rounded-2xl p-8 w-full max-w-md mx-4"
        >
          <div className="flex items-center gap-3 mb-6">
            <Lock className="text-yellow-400" size={24} />
            <div>
              <h2 className="text-xl font-semibold text-white">Password Required</h2>
              <p className="text-white/60 text-sm">This archive is password protected</p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-white/80 text-sm mb-2">Enter Password</label>
              <input
                ref={passwordInputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/50"
                placeholder="Enter archive password..."
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isLoading || !password.trim()}
                className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 px-4 py-3 rounded-lg transition-all backdrop-blur-md border border-blue-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Decrypting...' : 'Unlock Archive'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all border border-white/20"
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-zinc-900/90 to-black/90 glass-card rounded-2xl w-full max-w-4xl mx-4 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white">Archive Explorer</h2>
            <p className="text-white/60 text-sm mt-1">{file.name}</p>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleCleanup}
              className="p-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-all backdrop-blur-md border border-red-400/30"
              title="Close and cleanup"
            >
              <Trash2 size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all border border-white/20"
              title="Close"
            >
              <Download size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto"></div>
                <p className="text-white/60 mt-4">Loading archive...</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="text-red-400 text-center bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                <p className="font-medium">Error: {error}</p>
                <button
                  onClick={loadArchive}
                  className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-all"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {files.length === 0 ? (
                <div className="text-center text-white/60 py-12">
                  <File size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No files found in archive</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  <AnimatePresence mode="wait">
                    {files.map((archiveFile, index) => (
                      <motion.div
                        key={archiveFile.name}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ delay: index * 0.05 }}
                        className="group"
                      >
                        <div className="flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-all cursor-pointer"
                             onClick={() => handleFilePlay(archiveFile.name)}
                        >
                          <div className="text-white/60">
                            {getIcon(archiveFile.name)}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium truncate">{archiveFile.name}</span>
                              {archiveFile.name.toLowerCase().endsWith('.mcgi') && (
                                <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full border border-green-500/30">
                                  Will convert to .mp4
                                </span>
                              )}
                            </div>
                            <div className="text-white/50 text-sm">
                              {formatFileSize(archiveFile.size)}
                              {archiveFile.isEncrypted && (
                                <span className="ml-2 text-yellow-400">• Encrypted</span>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFilePlay(archiveFile.name);
                              }}
                              disabled={isPlaying}
                              className="flex items-center gap-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 px-4 py-2 rounded-lg transition-all backdrop-blur-md border border-green-400/30 disabled:opacity-50"
                            >
                              <Play size={16} />
                              {selectedFile === archiveFile.name && isPlaying ? 'Playing...' : 'Play'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-black/20">
          <div className="text-white/50 text-sm">
            Tip: Click any file to play it. Files are extracted temporarily and cleaned up after playback.
          </div>
        </div>
      </motion.div>
    </div>
  );
}