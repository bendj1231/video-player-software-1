import React, { useState, useEffect, useRef, ChangeEvent, useCallback, memo, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { GalleryView } from './components/GalleryView';
import { FolderView } from './components/FolderView';
import { FolderPreview } from './components/FolderPreview';
import { FolderContentsView } from './components/FolderContentsView';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { MultiViewPlayer } from './components/MultiViewPlayer';
import { ThemeSettingsModal } from './components/ThemeSettingsModal';
import { MindMapView } from './components/MindMapView';
import { NetflixMode } from './components/NetflixMode';
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
  const [previousView, setPreviousView] = useState('home');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [previewFolderId, setPreviewFolderId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedArchiveName, setSelectedArchiveName] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<{ blob: Blob | null, id: string | null, name: string | null }>({ blob: null, id: null, name: null });
  const [privacyMode, setPrivacyMode] = useState<'none' | 'blur' | 'cover'>('none');
  const [isMuted, setIsMuted] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    // Track previous view before changing
    if (currentView !== 'folder-preview' && currentView !== 'folder') {
      setPreviousView(currentView);
    }
    setCurrentView(view);
    if (view !== 'folder' && view !== 'folder-preview') {
      setSelectedFolderId(null);
      setPreviewFolderId(null);
    }
    if (view === 'multiview') {
      setSidebarOpen(false);
    }
  };

  const handleSelectFolder = (id: string) => {
    console.log('handleSelectFolder called with id:', id);
    setPreviewFolderId(id);
    setCurrentView('folder-preview');
    setSidebarOpen(false);
    // Increment refresh trigger to reload folder preview data
    setRefreshTrigger(prev => prev + 1);
    console.log('View changed to folder-preview, previewFolderId set to:', id);
  };

  const handlePlayVideo = (blob: Blob, videoId: string, videoName?: string) => {
    setPlayingVideo({ blob, id: videoId, name: videoName || null });
  };

  const handleDeleteVideo = async (videoId: string) => {
    await deleteVideoZip(videoId);
  };

  const handleNavigateToFolder = (id: string) => {
    setSelectedFolderId(id);
    setPreviewFolderId(null);
  };

  const handleViewAllContents = (folderId: string, archiveId?: string, archiveName?: string) => {
    setPreviewFolderId(folderId);
    setSelectedArchiveId(archiveId || null);
    setSelectedArchiveName(archiveName || null);
    setCurrentView('folder-contents');
  };

  const handleBackFromFolder = () => {
    if (currentView === 'folder-preview') {
      handleSetView('mindmap');
    } else {
      handleSetView('galleries');
    }
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
          {currentView === 'home' && <HomeView onPlayVideo={handlePlayVideo} onSelectFolder={handleSelectFolder} onViewAllContents={handleViewAllContents} blurEnabled={privacyMode === 'blur'} refreshTrigger={refreshTrigger} />}
          {currentView === 'multiview' && <MultiViewPlayer onBack={() => setCurrentView('home')} onFullscreenChange={handleMultiviewFullscreenChange} />}
          {currentView === 'mindmap' && <MindMapView onSelectFolder={handleSelectFolder} onImportComplete={() => {
            console.log('File import complete');
            alert(`Import complete! Check console (F12) for details.`);
            setRefreshTrigger(prev => prev + 1);
          }} />}
          {currentView === 'netflix' && <NetflixMode onSelectFolder={handleSelectFolder} onPlayVideo={handlePlayVideo} onViewAllContents={handleViewAllContents} blurEnabled={privacyMode === 'blur'} />}
          {currentView === 'galleries' && <GalleryView onSelectFolder={handleSelectFolder} blurEnabled={privacyMode === 'blur'} />}
          {currentView === 'folder-contents' && previewFolderId && (
            <FolderContentsView
              folderId={previewFolderId}
              archiveId={selectedArchiveId || undefined}
              archiveName={selectedArchiveName || undefined}
              onBack={() => setCurrentView('folder-preview')}
              onPlayVideo={handlePlayVideo}
              blurEnabled={privacyMode === 'blur'}
              isMuted={isMuted}
            />
          )}
          {currentView === 'folder-preview' && previewFolderId && (
            <FolderPreview
              folderId={previewFolderId}
              onBack={handleBackFromFolder}
              onViewContents={() => {
                setCurrentView('folder-contents');
              }}
              onPlayVideo={handlePlayVideo}
              blurEnabled={privacyMode === 'blur'}
              isMuted={isMuted}
              refreshTrigger={refreshTrigger}
            />
          )}
          {currentView === 'folder-preview' && !previewFolderId && (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <p>No folder selected (previewFolderId is empty)</p>
                <button 
                  onClick={() => setCurrentView('home')}
                  className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg"
                >
                  Go Home
                </button>
              </div>
            </div>
          )}
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
          {!['home', 'multiview', 'mindmap', 'netflix', 'galleries', 'folder-preview', 'folder', 'folder-contents'].includes(currentView) && (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <p>Unknown view: {currentView}</p>
                <button 
                  onClick={() => setCurrentView('home')}
                  className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg"
                >
                  Go Home
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <VideoPlayerModal
        zipBlob={playingVideo.blob}
        videoId={playingVideo.id || undefined}
        videoName={playingVideo.name || undefined}
        onClose={() => setPlayingVideo({ blob: null, id: null, name: null })}
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
