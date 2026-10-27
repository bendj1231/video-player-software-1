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
import { StorageExplorer } from './components/StorageExplorer';
import { StorageGalleries } from './components/StorageGalleries';
import { StorageNetflix } from './components/StorageNetflix';
import { StorageMindmap } from './components/StorageMindmap';
import { isElectron, logRecentView } from './lib/electronStorage';
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
  const [storageFolder, setStorageFolder] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<{ blob: Blob | null, id: string | null, name: string | null, directUrl?: string | null, queue?: { url: string; name: string }[] }>({ blob: null, id: null, name: null });
  const [privacyMode, setPrivacyMode] = useState<'none' | 'blur' | 'cover'>('blur');
  const [peekMode, setPeekMode] = useState<boolean>(() => localStorage.getItem('wmplayer.peek') === '1');
  const togglePeek = () => setPeekMode(p => { localStorage.setItem('wmplayer.peek', p ? '0' : '1'); return !p; });
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
    if (view === 'storage-explorer') {
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

  const handlePlayDirect = (url: string, name: string, queue?: { url: string; name: string }[]) => {
    const rel = url.startsWith('media://local/') ? decodeURIComponent(url.slice('media://local/'.length)) : null;
    if (rel) logRecentView({ relPath: rel, name, kind: 'video' });
    setPlayingVideo({ blob: null, id: null, name, directUrl: url, queue });
  };

  const handleOpenStorageFolder = (relPath: string) => {
    if (relPath) logRecentView({ relPath, name: relPath.split('/').pop() || relPath, kind: 'folder' });
    setStorageFolder(relPath);
    setCurrentView('storage-explorer');
    setSidebarOpen(false);
  };

  // Drag-and-drop import into Electron storage
  const [dragActive, setDragActive] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragCounter = useRef(0);
  useEffect(() => {
    if (!window.wmplayer?.isElectron) return;

    const dropTargetDir = (e: DragEvent): string | null => {
      const el = (e.target as Element | null)?.closest?.('[data-dropdir]');
      return el ? (el.getAttribute('data-dropdir') || null) : null;
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragTarget(dropTargetDir(e));
    };
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.types.includes('Files')) setDragActive(true);
    };
    const onDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current <= 0) { dragCounter.current = 0; setDragActive(false); setDragTarget(null); }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragActive(false);
      const destDir = dropTargetDir(e) || undefined;
      setDragTarget(null);
      const { pathsFromFiles, importPaths } = await import('./lib/electronStorage');

      // Resolve File objects from every channel Chromium exposes
      const files: File[] = [];
      const items = e.dataTransfer?.items ? Array.from(e.dataTransfer.items) : [];

      for (const item of items) {
        if (item.kind !== 'file') continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      if (e.dataTransfer?.files?.length) {
        for (const f of Array.from(e.dataTransfer.files)) {
          if (!files.includes(f)) files.push(f);
        }
      }
      // Last resort: webkitGetAsEntry can yield entries when getAsFile() fails
      if (files.length === 0) {
        const entryFiles = await Promise.all(items.map((item) => new Promise<File | null>((res) => {
          try {
            const entry = (item as any).webkitGetAsEntry?.();
            if (entry?.isFile) entry.file(res, () => res(null));
            else res(null);
          } catch { res(null); }
        })));
        for (const f of entryFiles) if (f) files.push(f);
      }

      console.log('[drop] types:', e.dataTransfer?.types,
        '| items:', items.map(i => `${i.kind}:${i.type}`),
        '| files:', files.map(f => `${f.name}(${f.size})`));

      const paths = pathsFromFiles(files);
      console.log('[drop] resolved paths:', paths);
      if (paths.length === 0) {
        alert(files.length > 0
          ? 'Could not resolve dropped items to file paths.'
          : 'No files found in drop. Drag a real folder or files from Finder — screenshot thumbnails and Dock previews can\'t be dropped.');
        return;
      }
      const result = await importPaths(paths, destDir);
      console.log('[drop] import result:', result);
      if (!result) return;
      if (result.files > 0) {
        setRefreshTrigger(prev => prev + 1);
      } else {
        alert(`Imported ${paths.length} item(s) but 0 files were copied (folders may have been empty).`);
      }
      if (result.errors?.length) {
        alert('Some items failed to import:\n' + result.errors.join('\n'));
      }
    };

    // capture: true so inner drop zones (GalleryView etc.) can't swallow the event
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, []);

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
        peekEnabled={peekMode}
        onTogglePeek={togglePeek}
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
          {currentView === 'home' && <HomeView onPlayVideo={handlePlayVideo} onPlayDirect={handlePlayDirect} onSelectFolder={handleSelectFolder} onViewAllContents={handleViewAllContents} onOpenStorageFolder={handleOpenStorageFolder} onStorageChanged={() => setRefreshTrigger(prev => prev + 1)} blurEnabled={privacyMode === 'blur'} refreshTrigger={refreshTrigger} />}
          {currentView === 'multiview' && <MultiViewPlayer onBack={() => setCurrentView('home')} onFullscreenChange={handleMultiviewFullscreenChange} />}
          {currentView === 'mindmap' && (
            isElectron()
              ? <StorageMindmap onOpenFolder={handleOpenStorageFolder} onPlay={handlePlayDirect} blurEnabled={privacyMode !== 'none'} peekEnabled={peekMode} refreshTrigger={refreshTrigger} />
              : <MindMapView onSelectFolder={handleSelectFolder} onImportComplete={() => {
                console.log('File import complete');
                alert(`Import complete! Check console (F12) for details.`);
                setRefreshTrigger(prev => prev + 1);
              }} />
          )}
          {currentView === 'netflix' && (
            isElectron()
              ? <StorageNetflix onPlay={handlePlayDirect} onOpenFolder={handleOpenStorageFolder} blurEnabled={privacyMode === 'blur'} refreshTrigger={refreshTrigger} />
              : <NetflixMode onSelectFolder={handleSelectFolder} onPlayVideo={handlePlayVideo} onViewAllContents={handleViewAllContents} blurEnabled={privacyMode === 'blur'} />
          )}
          {currentView === 'galleries' && (
            isElectron()
              ? <StorageGalleries onOpenFolder={handleOpenStorageFolder} blurEnabled={privacyMode === 'blur'} refreshTrigger={refreshTrigger} />
              : <GalleryView onSelectFolder={handleSelectFolder} blurEnabled={privacyMode === 'blur'} />
          )}
          {currentView === 'storage-explorer' && storageFolder && (
            <StorageExplorer
              folderPath={storageFolder}
              onBack={() => setCurrentView('home')}
              onPlay={handlePlayDirect}
              blurEnabled={privacyMode === 'blur'}
              onChanged={() => setRefreshTrigger(prev => prev + 1)}
            />
          )}
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

      {dragActive && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="border-2 border-dashed border-emerald-400 rounded-3xl px-16 py-12 text-center bg-zinc-900/80">
            <p className="text-2xl font-bold text-white mb-2">
              {dragTarget ? `Drop into "${dragTarget.split('/').pop()}"` : 'Drop to import'}
            </p>
            <p className="text-zinc-400">
              {dragTarget
                ? 'Items will be moved into that folder'
                : 'Folders and files will be copied into your media library'}
            </p>
          </div>
        </div>
      )}

      <VideoPlayerModal
        zipBlob={playingVideo.blob}
        directUrl={playingVideo.directUrl || undefined}
        videoId={playingVideo.id || undefined}
        videoName={playingVideo.name || undefined}
        queue={playingVideo.queue}
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
