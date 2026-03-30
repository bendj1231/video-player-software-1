import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Monitor, Sun, Cloud, Droplets } from 'lucide-react';

export type Theme = 'dark' | 'light' | 'futuristic' | 'smokey';

interface ThemeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const themes = [
  {
    id: 'dark' as Theme,
    name: 'Midnight',
    description: 'Dark glassmorphism with subtle gradients',
    icon: Monitor,
    preview: 'bg-zinc-950',
    accent: 'from-zinc-800 to-zinc-900',
  },
  {
    id: 'light' as Theme,
    name: 'Daylight',
    description: 'Clean light mode with soft shadows',
    icon: Sun,
    preview: 'bg-zinc-100',
    accent: 'from-zinc-200 to-white',
  },
  {
    id: 'futuristic' as Theme,
    name: 'Cyber Blue',
    description: 'Futuristic cyan and blue glow effects',
    icon: Cloud,
    preview: 'bg-slate-950',
    accent: 'from-cyan-500/20 to-blue-600/20',
  },
  {
    id: 'smokey' as Theme,
    name: 'Smokey Glass',
    description: 'Grey glassy UI with heavy blur',
    icon: Droplets,
    preview: 'bg-neutral-900',
    accent: 'from-neutral-700/50 to-neutral-800/50',
  },
];

export function ThemeSettingsModal({ isOpen, onClose, currentTheme, onThemeChange }: ThemeSettingsModalProps) {
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
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h2 className="text-lg font-semibold text-white">Theme Settings</h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} className="text-zinc-400" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {themes.map((theme) => {
                  const Icon = theme.icon;
                  const isActive = currentTheme === theme.id;

                  return (
                    <button
                      key={theme.id}
                      onClick={() => onThemeChange(theme.id)}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-300 ${
                        isActive
                          ? 'bg-white/10 border border-white/20'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className={`w-16 h-16 rounded-lg ${theme.preview} ${theme.accent} bg-gradient-to-br flex items-center justify-center shadow-lg`}>
                        <Icon size={28} className={isActive ? 'text-white' : 'text-zinc-400'} />
                      </div>
                      <div className="flex-1 text-left">
                        <h3 className="font-medium text-white">{theme.name}</h3>
                        <p className="text-sm text-zinc-400">{theme.description}</p>
                      </div>
                      {isActive && (
                        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check size={16} className="text-emerald-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
