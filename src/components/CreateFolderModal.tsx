import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, FolderPlus } from 'lucide-react';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export function CreateFolderModal({ isOpen, onClose, onCreate }: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmed = folderName.trim();
    if (!trimmed) {
      setError('Please enter a folder name');
      return;
    }
    
    onCreate(trimmed);
    setFolderName('');
    setError('');
    onClose();
  };

  const handleClose = () => {
    setFolderName('');
    setError('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <FolderPlus size={20} className="text-emerald-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Create New Folder</h2>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} className="text-zinc-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Folder Name
                  </label>
                  <input
                    type="text"
                    value={folderName}
                    onChange={(e) => {
                      setFolderName(e.target.value);
                      setError('');
                    }}
                    placeholder="Enter folder name..."
                    className="w-full px-4 py-3 bg-zinc-800/50 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    autoFocus
                  />
                  {error && (
                    <p className="mt-2 text-sm text-red-400">{error}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-colors font-medium"
                  >
                    Create Folder
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
