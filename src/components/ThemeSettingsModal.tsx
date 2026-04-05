import { motion, AnimatePresence } from 'motion/react';
import { X, Monitor, Smartphone, Laptop, Tablet } from 'lucide-react';
import { useState, useEffect } from 'react';
import { clsx } from 'clsx';

interface ThemeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GraphicsProfile = 'auto' | 'iphone16' | 'macbook-m4' | 'ipad-pro-2015';

interface GraphicsSettings {
  blur: boolean;
  blurAmount: number;
  shadows: boolean;
  gradients: boolean;
  animations: boolean;
  contentVisibility: boolean;
  gridColumns: number;
}

const graphicsProfiles: { id: GraphicsProfile; name: string; description: string; icon: typeof Smartphone; settings: GraphicsSettings }[] = [
  {
    id: 'auto',
    name: 'Auto Detect',
    description: 'Automatically detect your device',
    icon: Monitor,
    settings: { blur: true, blurAmount: 16, shadows: true, gradients: true, animations: true, contentVisibility: true, gridColumns: 280 }
  },
  {
    id: 'iphone16',
    name: 'iPhone 16',
    description: 'High performance, full effects',
    icon: Smartphone,
    settings: { blur: true, blurAmount: 20, shadows: true, gradients: true, animations: true, contentVisibility: true, gridColumns: 160 }
  },
  {
    id: 'macbook-m4',
    name: 'MacBook M4 Air 16GB',
    description: 'Ultra quality, all effects maxed',
    icon: Laptop,
    settings: { blur: true, blurAmount: 32, shadows: true, gradients: true, animations: true, contentVisibility: false, gridColumns: 300 }
  },
  {
    id: 'ipad-pro-2015',
    name: 'iPad Pro 12.9" 2015',
    description: 'Memory optimized, no blur/effects',
    icon: Tablet,
    settings: { blur: false, blurAmount: 0, shadows: false, gradients: false, animations: false, contentVisibility: true, gridColumns: 200 }
  }
];

// Auto-detect device
function detectDevice(): GraphicsProfile {
  const ua = navigator.userAgent;
  const width = window.innerWidth;
  
  // iPad Pro 12.9" 1st gen detection
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIPad && width >= 1024 && width <= 1366) {
    return 'ipad-pro-2015';
  }
  
  // iPhone 16 detection (approximate based on screen size and pixel ratio)
  const isIPhone = /iPhone/.test(ua);
  if (isIPhone && window.devicePixelRatio >= 3) {
    return 'iphone16';
  }
  
  // Mac detection (M4 would be ARM64)
  const isMac = /Mac/.test(ua) && !isIPad;
  if (isMac && navigator.hardwareConcurrency >= 8) {
    return 'macbook-m4';
  }
  
  return 'auto';
}

export function ThemeSettingsModal({ isOpen, onClose }: ThemeSettingsModalProps) {
  const [selectedProfile, setSelectedProfile] = useState<GraphicsProfile>('auto');
  const [detectedDevice, setDetectedDevice] = useState<GraphicsProfile>('auto');

  useEffect(() => {
    const detected = detectDevice();
    setDetectedDevice(detected);
    setSelectedProfile(detected);
  }, []);

  const applyProfile = (profileId: GraphicsProfile) => {
    setSelectedProfile(profileId);
    const profile = graphicsProfiles.find(p => p.id === profileId);
    if (!profile) return;

    // Apply CSS variables for graphics settings
    const root = document.documentElement;
    root.style.setProperty('--glass-blur', profile.settings.blur ? `${profile.settings.blurAmount}px` : '0px');
    root.style.setProperty('--enable-shadows', profile.settings.shadows ? '1' : '0');
    root.style.setProperty('--enable-gradients', profile.settings.gradients ? '1' : '0');
    root.style.setProperty('--enable-animations', profile.settings.animations ? '1' : '0');
    root.style.setProperty('--content-visibility', profile.settings.contentVisibility ? 'auto' : 'visible');
    root.style.setProperty('--grid-min-size', `${profile.settings.gridColumns}px`);

    // Store preference
    localStorage.setItem('graphics-profile', profileId);
  };

  // Load saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem('graphics-profile') as GraphicsProfile;
    if (saved && graphicsProfiles.find(p => p.id === saved)) {
      applyProfile(saved);
    }
  }, []);

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
            <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h2 className="text-lg font-semibold text-white">Graphics Settings</h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} className="text-zinc-400" />
                </button>
              </div>

              {/* Device Info */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <Monitor size={20} className="text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-400">Detected Device</p>
                    <p className="text-white font-medium">
                      {detectedDevice === 'auto' && 'Unknown Device'}
                      {detectedDevice === 'iphone16' && 'iPhone 16 Series'}
                      {detectedDevice === 'macbook-m4' && 'MacBook M4 Air'}
                      {detectedDevice === 'ipad-pro-2015' && 'iPad Pro 12.9" (2015)'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Graphics Profiles */}
              <div className="p-4 space-y-3">
                <p className="text-sm text-zinc-500 mb-2">Select Graphics Profile</p>
                {graphicsProfiles.map((profile) => {
                  const Icon = profile.icon;
                  const isActive = selectedProfile === profile.id;
                  const isDetected = detectedDevice === profile.id;

                  return (
                    <button
                      key={profile.id}
                      onClick={() => applyProfile(profile.id)}
                      className={clsx(
                        "w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200",
                        isActive
                          ? 'bg-white/10 border border-white/20'
                          : 'hover:bg-white/5 border border-transparent'
                      )}
                    >
                      <div className={clsx(
                        "w-12 h-12 rounded-xl flex items-center justify-center",
                        isActive ? 'bg-zinc-800' : 'bg-zinc-800/50'
                      )}>
                        <Icon size={24} className={isActive ? 'text-white' : 'text-zinc-400'} />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-white">{profile.name}</h3>
                          {isDetected && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                              Detected
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-400">{profile.description}</p>
                      </div>
                      {isActive && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Current Settings Summary */}
              <div className="p-4 border-t border-white/10 bg-zinc-800/50">
                <p className="text-sm text-zinc-500 mb-3">Active Settings</p>
                {(() => {
                  const profile = graphicsProfiles.find(p => p.id === selectedProfile);
                  if (!profile) return null;
                  return (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={profile.settings.blur ? 'text-emerald-400' : 'text-zinc-500'}>
                          {profile.settings.blur ? '✓' : '✗'}
                        </span>
                        <span className="text-zinc-300">Blur ({profile.settings.blurAmount}px)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={profile.settings.shadows ? 'text-emerald-400' : 'text-zinc-500'}>
                          {profile.settings.shadows ? '✓' : '✗'}
                        </span>
                        <span className="text-zinc-300">Shadows</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={profile.settings.gradients ? 'text-emerald-400' : 'text-zinc-500'}>
                          {profile.settings.gradients ? '✓' : '✗'}
                        </span>
                        <span className="text-zinc-300">Gradients</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={profile.settings.animations ? 'text-emerald-400' : 'text-zinc-500'}>
                          {profile.settings.animations ? '✓' : '✗'}
                        </span>
                        <span className="text-zinc-300">Animations</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
