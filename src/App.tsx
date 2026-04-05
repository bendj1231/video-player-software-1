import React, { useState, useEffect, useRef, ChangeEvent, useCallback, memo, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { GalleryView } from './components/GalleryView';
import { FolderView } from './components/FolderView';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { MultiViewPlayer } from './components/MultiViewPlayer';
import { ThemeSettingsModal } from './components/ThemeSettingsModal';
import { MindMapView } from './components/MindMapView';
import { deleteVideoZip } from './lib/db';
import { clearCache } from './lib/fileSystem';

// iPad Pro 12.9" 1st gen detection for performance mode
const isIPadPro129 = () => {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isLargeScreen = window.innerWidth >= 1024 && window.innerWidth <= 1366;
  return isIPad && isLargeScreen;
};

export default function App() {
  const [currentView, setCurrentView] = useState('home');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<{ blob: Blob | null, id: string | null }>({ blob: null, id: null });
  const [privacyMode, setPrivacyMode] = useState<'none' | 'blur' | 'cover'>('none');
  const [isMuted, setIsMuted] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Get theme-based styles - DARK MODE ONLY
  const themeStyles = {
    bg: 'bg-[#020202]',
    text: 'text-white',
    gradient1: 'bg-indigo-600/10',
    gradient2: 'bg-emerald-600/8',
    gradient3: 'bg-purple-600/8',
  };

  const handleSetView = (view: string) => {
    console.log('View changing to:', view);
    setCurrentView(view);
    if (view !== 'folder') {
      setSelectedFolderId(null);
    }
    // Auto-fold sidebar in multiview
    if (view === 'multiview') {
      setSidebarOpen(false);
    }
  };

  const handleSelectFolder = (id: string) => {
    setSelectedFolderId(id);
    setCurrentView('folder');
    setSidebarOpen(false); // Fold sidebar when opening folder
  };

  const handlePlayVideo = (blob: Blob, videoId: string) => {
    setPlayingVideo({ blob, id: videoId });
  };

  const handleDeleteVideo = async (videoId: string) => {
    await deleteVideoZip(videoId);
  };

  const handleNavigateToFolder = (id: string) => {
    setSelectedFolderId(id);
  };

  const handleBackFromFolder = () => {
    handleSetView('galleries');
  };

  const [multiviewFullscreen, setMultiviewFullscreen] = useState(false);
  const sidebarStateBeforeFullscreen = useRef(true);

  const handleMultiviewFullscreenChange = (isFullscreen: boolean) => {
    setMultiviewFullscreen(isFullscreen);
    if (isFullscreen) {
      sidebarStateBeforeFullscreen.current = sidebarOpen;
      setSidebarOpen(false);
    } else {
      setSidebarOpen(sidebarStateBeforeFullscreen.current);
    }
  };

  const handleClearCache = async () => {
    const result = await clearCache();
    if (result.success) {
      alert(result.message);
      // Wait for IndexedDB to fully commit before reloading
      await new Promise(resolve => setTimeout(resolve, 500));
      window.location.reload();
    } else {
      alert(result.message);
    }
  };

  return (
    <div className={`flex h-screen w-screen ${themeStyles.bg} ${themeStyles.text} overflow-hidden font-sans selection:bg-white/30 relative origin-top-left`}>
      {/* Theme-based background gradients */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-[-10%] left-[-5%] w-[50%] h-[50%] ${themeStyles.gradient1} blur-[80px] rounded-full`} />
        <div className={`absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] ${themeStyles.gradient2} blur-[80px] rounded-full`} />
        <div className={`absolute top-[30%] right-[30%] w-[30%] h-[30%] ${themeStyles.gradient3} blur-[80px] rounded-full`} />
      </div>

      <Sidebar 
        currentView={currentView} 
        setView={handleSetView} 
        blurEnabled={privacyMode === 'blur'}
        setBlurEnabled={(enabled) => setPrivacyMode(enabled ? 'blur' : 'none')}
        privacyMode={privacyMode}
        setPrivacyMode={setPrivacyMode}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onClearCache={handleClearCache}
        isOpen={sidebarOpen && !multiviewFullscreen}
        setIsOpen={setSidebarOpen}
        onOpenSettings={() => setShowSettings(true)}
        onSelectFolder={handleSelectFolder}
      />

      <main className="flex-1 overflow-y-auto relative z-10">
        <div className={currentView === 'galleries' || currentView === 'multiview' ? '' : 'max-w-7xl mx-auto'}>
          {currentView === 'home' && <HomeView onPlayVideo={handlePlayVideo} onSelectFolder={handleSelectFolder} blurEnabled={privacyMode === 'blur'} />}
          {currentView === 'multiview' && <MultiViewPlayer onBack={() => setCurrentView('home')} onFullscreenChange={handleMultiviewFullscreenChange} />}
          {currentView === 'mindmap' && <MindMapView />}
          {currentView === 'galleries' && <GalleryView onSelectFolder={handleSelectFolder} blurEnabled={privacyMode === 'blur'} />}
          {currentView === 'folder' && selectedFolderId && (
            <FolderView
              folderId={selectedFolderId}
              onBack={handleBackFromFolder}
              onPlayVideo={handlePlayVideo}
              blurEnabled={privacyMode === 'blur'}
              onNavigateToFolder={handleNavigateToFolder}
              isMuted={isMuted}
            />
          )}
        </div>
      </main>

      <VideoPlayerModal
        zipBlob={playingVideo.blob}
        videoId={playingVideo.id || undefined}
        onClose={() => setPlayingVideo({ blob: null, id: null })}
        isMuted={isMuted}
        blurEnabled={privacyMode === 'blur'}
      />
      <ThemeSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
