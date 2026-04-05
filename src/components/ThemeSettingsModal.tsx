import { motion, AnimatePresence } from 'motion/react';
import { X, Monitor } from 'lucide-react';

interface ThemeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ThemeSettingsModal({ isOpen, onClose }: ThemeSettingsModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm"
          >
            <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h2 className="text-lg font-semibold text-white">Theme</h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} className="text-zinc-400" />
                </button>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-lg bg-zinc-950 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center shadow-lg">
                    <Monitor size={28} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-white">Midnight (Dark)</h3>
                    <p className="text-sm text-zinc-400">Dark mode is enabled</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
