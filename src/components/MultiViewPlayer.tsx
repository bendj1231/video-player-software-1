import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VideoZip, getVideosByFolder, getFolders } from '../lib/db';
import { Play, Pause, Square, X, Plus, Trash2, Shuffle, ChevronLeft, ChevronRight, Folder, Maximize2, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';

interface VideoQueue {
  id: string;
  videos: VideoZip[];
  currentIndex: number;
}

interface MultiViewPlayerProps {
  onBack: () => void;
  initialFolderId?: string;
  theme?: 'dark' | 'light' | 'futuristic' | 'smokey';
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export function MultiViewPlayer({ onBack, initialFolderId, theme = 'dark', onFullscreenChange }: MultiViewPlayerProps) {
  const [videoCount, setVideoCount] = useState(4);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [hoveredScreen, setHoveredScreen] = useState<number | null>(null);
  const [queues, setQueues] = useState<VideoQueue[]>([
    { id: 'screen-1', videos: [], currentIndex: 0 },
    { id: 'screen-2', videos: [], currentIndex: 0 },
    { id: 'screen-3', videos: [], currentIndex: 0 },
    { id: 'screen-4', videos: [], currentIndex: 0 },
    { id: 'screen-5', videos: [], currentIndex: 0 },
    { id: 'screen-6', videos: [], currentIndex: 0 },
  ]);
  const [selectedScreen, setSelectedScreen] = useState<number | null>(null);
  const [showVideoSelector, setShowVideoSelector] = useState(false);
  const [showFolderSelector, setShowFolderSelector] = useState(false);
  const [availableVideos, setAvailableVideos] = useState<VideoZip[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(initialFolderId || null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [multiviewFullscreen, setMultiviewFullscreen] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean[]>([false, false, false, false, false, false]);
  
  const [showSingleVideo, setShowSingleVideo] = useState(false);
  const [singleVideoIndex, setSingleVideoIndex] = useState<number | null>(null);
  const [singleVideoQueue, setSingleVideoQueue] = useState<VideoZip[]>([]);
  const singleVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null, null, null]);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load folders on mount
  useEffect(() => {
    getFolders().then(folders => {
      setFolders(folders.map(f => ({ id: f.id, name: f.name })));
    });
  }, []);

  // Load videos when folder selected
  useEffect(() => {
    if (selectedFolder) {
      getVideosByFolder(selectedFolder).then(videos => {
        setAvailableVideos(videos);
      });
    }
  }, [selectedFolder]);

  // Sync play state across all videos
  useEffect(() => {
    videoRefs.current.forEach((ref, index) => {
      if (ref && queues[index]?.videos.length > 0) {
        if (isPlaying) {
          ref.play();
        } else {
          ref.pause();
        }
      }
    });
  }, [isPlaying, queues]);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  const handlePlayPause = () => {
    const newPlaying = !isPlaying;
    setIsPlaying(newPlaying);
    // Immediately hide controls when starting playback
    if (newPlaying) {
      setShowControls(false);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
  };

  const handleStop = () => {
    setIsPlaying(false);
    videoRefs.current.forEach(ref => {
      if (ref) {
        ref.pause();
        ref.currentTime = 0;
      }
    });
    setQueues(prev => prev.map(q => ({ ...q, currentIndex: 0 })));
  };

  const handleVideoEnded = useCallback((screenIndex: number) => {
    const queue = queues[screenIndex];
    const isShuffled = shuffleEnabled[screenIndex];
    
    if (queue.currentIndex < queue.videos.length - 1) {
      if (isShuffled) {
        // When shuffled, pick a random next video
        setQueues(prev => {
          const newQueues = [...prev];
          const randomIndex = Math.floor(Math.random() * newQueues[screenIndex].videos.length);
          newQueues[screenIndex] = {
            ...newQueues[screenIndex],
            currentIndex: randomIndex
          };
          return newQueues;
        });
      } else {
        // Normal sequential playback
        setQueues(prev => {
          const newQueues = [...prev];
          newQueues[screenIndex] = {
            ...newQueues[screenIndex],
            currentIndex: newQueues[screenIndex].currentIndex + 1
          };
          return newQueues;
        });
      }
    } else {
      // End of playlist - restart if playing
      if (isPlaying) {
        if (isShuffled) {
          setQueues(prev => {
            const newQueues = [...prev];
            const randomIndex = Math.floor(Math.random() * newQueues[screenIndex].videos.length);
            newQueues[screenIndex] = {
              ...newQueues[screenIndex],
              currentIndex: randomIndex
            };
            return newQueues;
          });
        } else {
          setQueues(prev => {
            const newQueues = [...prev];
            newQueues[screenIndex] = {
              ...newQueues[screenIndex],
              currentIndex: 0
            };
            return newQueues;
          });
        }
      }
    }
  }, [queues, isPlaying, videoCount, shuffleEnabled]);

  const shuffleQueue = (screenIndex: number) => {
    setShuffleEnabled(prev => {
      const newEnabled = [...prev];
      newEnabled[screenIndex] = !newEnabled[screenIndex];
      return newEnabled;
    });
  };

  const addVideoToQueue = (screenIndex: number, video: VideoZip) => {
    setQueues(prev => {
      const newQueues = [...prev];
      const currentVideos = newQueues[screenIndex].videos;
      // Limit to 10 videos per screen
      if (currentVideos.length >= 10) {
        return newQueues;
      }
      newQueues[screenIndex] = {
        ...newQueues[screenIndex],
        videos: [...currentVideos, video]
      };
      return newQueues;
    });
  };

  const removeVideoFromQueue = (screenIndex: number, videoIndex: number) => {
    setQueues(prev => {
      const newQueues = [...prev];
      const newVideos = newQueues[screenIndex].videos.filter((_, i) => i !== videoIndex);
      newQueues[screenIndex] = {
        ...newQueues[screenIndex],
        videos: newVideos,
        currentIndex: Math.min(newQueues[screenIndex].currentIndex, Math.max(0, newVideos.length - 1))
      };
      return newQueues;
    });
  };

  const clearQueue = (screenIndex: number) => {
    setQueues(prev => {
      const newQueues = [...prev];
      newQueues[screenIndex] = { ...newQueues[screenIndex], videos: [], currentIndex: 0 };
      return newQueues;
    });
  };

  const toggleFullscreen = () => {
    const newFullscreen = !isFullscreen;
    setIsFullscreen(newFullscreen);
    onFullscreenChange?.(newFullscreen);
  };

  const openSingleVideo = (screenIndex: number) => {
    const queue = queues[screenIndex];
    if (queue.videos.length === 0) return;
    
    // Get the folder of the current video
    const currentVideo = queue.videos[queue.currentIndex];
    if (!currentVideo || !selectedFolder) return;
    
    // Load all videos from the folder
    getVideosByFolder(selectedFolder).then(folderVideos => {
      setSingleVideoQueue(folderVideos);
      // Find index of current video in folder
      const idx = folderVideos.findIndex(v => v.id === currentVideo.id);
      setSingleVideoIndex(idx >= 0 ? idx : 0);
      setShowSingleVideo(true);
    });
  };

  const closeSingleVideo = () => {
    setShowSingleVideo(false);
    setSingleVideoIndex(null);
    setSingleVideoQueue([]);
  };

  const playNextVideo = () => {
    if (singleVideoIndex !== null && singleVideoQueue.length > 0) {
      setSingleVideoIndex((singleVideoIndex + 1) % singleVideoQueue.length);
    }
  };

  const playPrevVideo = () => {
    if (singleVideoIndex !== null && singleVideoQueue.length > 0) {
      setSingleVideoIndex((singleVideoIndex - 1 + singleVideoQueue.length) % singleVideoQueue.length);
    }
  };

  const openVideoSelector = (screenIndex: number) => {
    setSelectedScreen(screenIndex);
    setShowVideoSelector(true);
  };

  const getThemeStyles = () => {
    switch (theme) {
      case 'light':
        return {
          bg: 'bg-neutral-100',
          controlsBg: 'bg-neutral-200/80',
          controlsBorder: 'border-black/10',
          text: 'text-zinc-900',
          textMuted: 'text-zinc-600',
          buttonBg: 'bg-black/10 hover:bg-black/20',
          buttonActive: 'bg-emerald-500 hover:bg-emerald-600',
          buttonPause: 'bg-amber-500 hover:bg-amber-600',
          buttonStop: 'bg-red-500 hover:bg-red-600',
          screenBorder: 'border-white/20',
          screenBorderActive: 'border-blue-500',
          overlayBg: 'bg-black/40',
          badgeBg: 'bg-white/90',
          badgeText: 'text-zinc-900',
          shuffleBtn: 'bg-blue-500/80 hover:bg-blue-600',
          addBtn: 'bg-emerald-500/80 hover:bg-emerald-600',
        };
      case 'smokey':
        return {
          bg: 'bg-neutral-800',
          controlsBg: 'bg-neutral-700/60',
          controlsBorder: 'border-white/10',
          text: 'text-white',
          textMuted: 'text-neutral-300',
          buttonBg: 'bg-white/10 hover:bg-white/20',
          buttonActive: 'bg-emerald-500 hover:bg-emerald-600',
          buttonPause: 'bg-amber-500 hover:bg-amber-600',
          buttonStop: 'bg-red-500 hover:bg-red-600',
          screenBorder: 'border-white/10',
          screenBorderActive: 'border-blue-400',
          overlayBg: 'bg-black/50',
          badgeBg: 'bg-black/60',
          badgeText: 'text-white',
          shuffleBtn: 'bg-blue-500/80 hover:bg-blue-600',
          addBtn: 'bg-emerald-500/80 hover:bg-emerald-600',
        };
      case 'futuristic':
        return {
          bg: 'bg-slate-900',
          controlsBg: 'bg-slate-800/60',
          controlsBorder: 'border-cyan-500/30',
          text: 'text-white',
          textMuted: 'text-cyan-300',
          buttonBg: 'bg-cyan-500/20 hover:bg-cyan-500/30',
          buttonActive: 'bg-cyan-500 hover:bg-cyan-400',
          buttonPause: 'bg-amber-500 hover:bg-amber-400',
          buttonStop: 'bg-red-500 hover:bg-red-400',
          screenBorder: 'border-cyan-500/20',
          screenBorderActive: 'border-cyan-400',
          overlayBg: 'bg-slate-900/60',
          badgeBg: 'bg-cyan-900/80',
          badgeText: 'text-cyan-100',
          shuffleBtn: 'bg-cyan-600/80 hover:bg-cyan-500',
          addBtn: 'bg-cyan-500/80 hover:bg-cyan-400',
        };
      default:
        return {
          bg: 'bg-black',
          controlsBg: 'bg-zinc-800/60',
          controlsBorder: 'border-white/10',
          text: 'text-white',
          textMuted: 'text-zinc-400',
          buttonBg: 'bg-white/10 hover:bg-white/20',
          buttonActive: 'bg-white/20 hover:bg-white/30',
          buttonPause: 'bg-white/20 hover:bg-white/30',
          buttonStop: 'bg-white/20 hover:bg-white/30',
          screenBorder: 'border-white/10',
          screenBorderActive: 'border-white/40',
          overlayBg: 'bg-black/60',
          badgeBg: 'bg-white/10',
          badgeText: 'text-white',
          shuffleBtn: 'bg-white/20 hover:bg-white/30',
          addBtn: 'bg-white/20 hover:bg-white/30',
        };
    }
  };

  const styles = getThemeStyles();

  const renderVideoScreen = (index: number) => {
    const queue = queues[index];
    const currentVideo = queue.videos[queue.currentIndex];
    const hasVideos = queue.videos.length > 0;
    const isHovered = hoveredScreen === index;

    return (
      <div 
        key={index}
        className={clsx(
          "relative bg-black overflow-hidden transition-all duration-300",
          "border-2",
          isHovered ? styles.screenBorderActive : styles.screenBorder,
          "rounded-xl"
        )}
        style={{ 
          height: isFullscreen ? 'calc(100vh - 120px)' : 'min(calc(100vh - 180px), 680px)',
          width: isFullscreen ? 'calc((100vh - 120px) * 9 / 16)' : 'calc(min(calc(100vh - 180px), 680px) * 9 / 16)',
          flex: '0 0 auto'
        }}
        onMouseEnter={() => setHoveredScreen(index)}
        onMouseLeave={() => setHoveredScreen(null)}
      >
        <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden">
          {currentVideo ? (
            <video
              ref={el => { videoRefs.current[index] = el; }}
              src={URL.createObjectURL(currentVideo.file)}
              className="w-full h-full object-contain cursor-pointer"
              onClick={() => openSingleVideo(index)}
              onEnded={() => handleVideoEnded(index)}
              muted
              playsInline
            />
          ) : (
            <div 
              className={clsx("flex flex-col items-center cursor-pointer", styles.textMuted)}
              onClick={() => openVideoSelector(index)}
            >
              <div className={clsx("w-16 h-16 rounded-full flex items-center justify-center mb-3", styles.buttonBg)}>
                <Plus size={24} />
              </div>
              <p className="text-sm">Click to add videos</p>
            </div>
          )}
          
          <div className={clsx("absolute top-3 left-3 px-2 py-1 rounded text-xs font-medium backdrop-blur-md", styles.badgeBg, styles.badgeText)}>
            {index + 1}
          </div>

          {hasVideos && (
            <div className={clsx("absolute top-3 right-3 px-2 py-1 rounded text-xs backdrop-blur-md flex items-center gap-1", styles.badgeBg, styles.badgeText)}>
              {queue.currentIndex + 1} / {queue.videos.length}
              {shuffleEnabled[index] && <Shuffle size={10} className="text-blue-400" />}
            </div>
          )}

          {isHovered && hasVideos && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); shuffleQueue(index); }}
                className={clsx(
                  "absolute top-12 right-3 p-2 rounded-full text-white transition-all duration-200 backdrop-blur-md shadow-lg",
                  styles.shuffleBtn
                )}
                title="Shuffle queue"
              >
                <Shuffle size={16} />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); clearQueue(index); }}
                className="absolute bottom-16 right-3 p-2 bg-red-500/80 hover:bg-red-600 rounded-full text-white transition-all duration-200 backdrop-blur-md shadow-lg"
                title="Clear queue"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}

          <button
            onClick={() => openVideoSelector(index)}
            className={clsx("absolute inset-0 transition-colors", styles.overlayBg)}
          />
        </div>
      </div>
    );
  };

  return (
    <div 
      className={clsx("h-screen flex flex-col relative overflow-hidden", styles.bg)}
      onMouseMove={handleMouseMove}
    >
      <div 
        className={clsx(
          "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 backdrop-blur-xl rounded-2xl px-6 py-3 flex items-center gap-4 shadow-2xl border",
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none",
          styles.controlsBg,
          styles.controlsBorder
        )}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVideoCount(Math.max(1, videoCount - 1))}
            className={clsx("p-2 rounded-full transition-colors", styles.buttonBg, styles.text)}
            disabled={videoCount <= 1}
          >
            <ChevronLeft size={20} />
          </button>
          <span className={clsx("text-sm font-medium min-w-[1.5rem] text-center", styles.text)}>
            {videoCount}
          </span>
          <button
            onClick={() => setVideoCount(Math.min(6, videoCount + 1))}
            className={clsx("p-2 rounded-full transition-colors", styles.buttonBg, styles.text)}
            disabled={videoCount >= 6}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className={clsx("w-px h-8", theme === 'light' ? 'bg-black/10' : 'bg-white/10')} />

        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayPause}
            className={clsx(
              "p-3 rounded-full transition-colors text-white shadow-lg",
              isPlaying ? styles.buttonPause : styles.buttonActive
            )}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          
          <button
            onClick={handleStop}
            className={clsx("p-3 rounded-full transition-colors text-white shadow-lg", styles.buttonStop)}
          >
            <Square size={24} />
          </button>
        </div>

        <div className={clsx("w-px h-8", theme === 'light' ? 'bg-black/10' : 'bg-white/10')} />

        <button
          onClick={() => setShowFolderSelector(true)}
          className={clsx(
            "p-3 rounded-full transition-all duration-200 text-white shadow-lg flex items-center gap-2",
            styles.addBtn
          )}
        >
          <Plus size={24} />
          <span className="text-sm font-medium">Add</span>
        </button>

        <div className={clsx("w-px h-8", theme === 'light' ? 'bg-black/10' : 'bg-white/10')} />

        <button
          onClick={toggleFullscreen}
          className={clsx("p-2 rounded-full transition-colors", styles.buttonBg, styles.text)}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>

        <button
          onClick={onBack}
          className={clsx("px-4 py-2 rounded-full transition-colors text-sm font-medium", styles.buttonBg, styles.text)}
        >
          Back
        </button>
      </div>

      <div className={clsx(
        "absolute top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between transition-opacity duration-500",
        showControls ? "opacity-100" : "opacity-0"
      )}>
        <h1 className={clsx("text-xl font-bold tracking-tight", styles.text)}>Multi-View</h1>
        <div className={clsx("text-sm", styles.textMuted)}>
          {videoCount} Screens
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center gap-2 p-2 overflow-auto content-center flex-nowrap">
        {Array.from({ length: videoCount }).map((_, index) => renderVideoScreen(index))}
      </div>

      {showFolderSelector && (
        <div className={clsx("fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md", theme === 'light' ? 'bg-white/90' : 'bg-black/90')}>
          <div className={clsx("rounded-2xl w-full h-full m-4 flex flex-col shadow-2xl border", 
            theme === 'light' ? 'bg-white border-black/10' : 'bg-zinc-900 border-white/10'
          )}>
            <div className={clsx("flex items-center justify-between p-4 border-b", theme === 'light' ? 'border-black/10' : 'border-white/10')}>
              <h2 className={clsx("font-semibold", styles.text)}>Select Folder</h2>
              <button 
                onClick={() => setShowFolderSelector(false)}
                className={clsx("p-2 rounded-full transition-colors", theme === 'light' ? 'hover:bg-black/10 text-zinc-600' : 'hover:bg-white/10 text-zinc-400')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden p-4">
              {folders.length > 0 ? (
                <div className="grid grid-cols-4 gap-4 h-full">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        setSelectedFolder(folder.id);
                        setShowFolderSelector(false);
                      }}
                      className={clsx(
                        "relative overflow-hidden transition-all rounded-xl border-2 group cursor-pointer flex flex-col items-center justify-center gap-4 p-6",
                        theme === 'light' 
                          ? 'border-black/10 hover:border-blue-500 bg-neutral-100' 
                          : 'border-white/10 hover:border-white/40 bg-zinc-800'
                      )}
                    >
                      <div className={clsx("w-20 h-20 rounded-full flex items-center justify-center", theme === 'light' ? 'bg-neutral-200' : 'bg-zinc-700')}>
                        <Folder size={40} className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'} />
                      </div>
                      <span className={clsx("font-medium text-center", styles.text)}>{folder.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full">
                  <p className={styles.textMuted}>No folders available</p>
                  <p className={clsx("text-sm mt-1", styles.textMuted)}>Create a folder first to add videos</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showVideoSelector && selectedScreen !== null && (
        <div className={clsx("fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md", theme === 'light' ? 'bg-white/90' : 'bg-black/90')}>
          <div className={clsx("rounded-2xl w-[90vw] h-[85vh] max-w-6xl flex flex-col shadow-2xl border", 
            theme === 'light' ? 'bg-white border-black/10' : 'bg-zinc-900 border-white/10'
          )}>
            <div className={clsx("p-4 border-b flex items-center justify-between gap-4", theme === 'light' ? 'border-black/10' : 'border-white/10')}>
              <div className="flex items-center gap-4 flex-1">
                <span className={clsx("text-sm font-medium", styles.text)}>Screen {selectedScreen + 1}:</span>
                
                {/* Folder Dropdown with Search */}
                <div className="relative flex-1 max-w-md">
                  <select
                    value={selectedFolder || ''}
                    onChange={(e) => setSelectedFolder(e.target.value || null)}
                    className={clsx(
                      "w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer",
                      theme === 'light' 
                        ? 'bg-neutral-100 border border-black/10 text-zinc-900' 
                        : 'bg-zinc-800 border border-white/10 text-white'
                    )}
                  >
                    <option value="">Select a folder...</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronRight size={16} className={clsx("rotate-90", styles.textMuted)} />
                  </div>
                </div>

                {/* Search Input */}
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="text"
                    placeholder="Search videos..."
                    className={clsx(
                      "w-full px-3 py-2 rounded-lg text-sm",
                      theme === 'light' 
                        ? 'bg-neutral-100 border border-black/10 text-zinc-900 placeholder-zinc-500' 
                        : 'bg-zinc-800 border border-white/10 text-white placeholder-zinc-500'
                    )}
                  />
                </div>
              </div>
              
              <button 
                onClick={() => setShowVideoSelector(false)}
                className={clsx("p-2 rounded-full transition-colors", theme === 'light' ? 'hover:bg-black/10 text-zinc-600' : 'hover:bg-white/10 text-zinc-400')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Videos Grid - Scrollable with smaller thumbnails */}
              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                {availableVideos.length > 0 ? (
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                    {availableVideos.map((video, idx) => {
                      const isAlreadyAdded = selectedScreen !== null && queues[selectedScreen].videos.some(v => v.id === video.id);
                      return (
                        <button
                          key={video.id}
                          onClick={() => {
                            if (selectedScreen !== null && !isAlreadyAdded) {
                              addVideoToQueue(selectedScreen, video);
                            }
                          }}
                          disabled={isAlreadyAdded}
                          className={clsx(
                            "relative overflow-hidden transition-all rounded-xl border-2 group cursor-pointer",
                            theme === 'light' 
                              ? 'border-white/20 hover:border-white/60 bg-black' 
                              : 'border-white/10 hover:border-white/40 bg-black',
                            isAlreadyAdded && "opacity-50 cursor-not-allowed border-green-500/50"
                          )}
                          style={{ aspectRatio: '9/16', maxHeight: '200px' }}
                        >
                          <video
                            src={URL.createObjectURL(video.file)}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <div className={clsx("absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center",
                            isAlreadyAdded ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          )}>
                            {isAlreadyAdded ? (
                              <span className="text-green-400 font-medium text-xs">Added</span>
                            ) : (
                              <Plus size={24} className="text-white" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-12">
                    <p className={styles.textMuted}>No videos available</p>
                    <p className={clsx("text-sm mt-1", styles.textMuted)}>
                      {selectedFolder ? "This folder is empty" : "Select a folder to view videos"}
                    </p>
                  </div>
                )}
              </div>

              {/* Selected Queue Preview - Horizontal at bottom */}
              {selectedScreen !== null && queues[selectedScreen].videos.length > 0 && (
                <div className={clsx("border-t p-3 overflow-x-auto", theme === 'light' ? 'border-black/10 bg-neutral-50' : 'border-white/10 bg-zinc-800/50')}>
                  <div className="flex items-center gap-2">
                    <span className={clsx("text-xs font-medium whitespace-nowrap", styles.text)}>Screen {selectedScreen + 1} Queue ({queues[selectedScreen].videos.length}/10):</span>
                    {queues[selectedScreen].videos.map((video, videoIdx) => (
                      <div key={`${video.id}-${videoIdx}`} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/20 flex-shrink-0">
                        <span className={clsx("text-xs w-5 h-5 rounded flex items-center justify-center", theme === 'light' ? 'bg-neutral-300 text-zinc-700' : 'bg-zinc-700 text-zinc-300')}>{videoIdx + 1}</span>
                        <span className={clsx("text-xs truncate max-w-[80px]", styles.textMuted)}>{video.name}</span>
                        <button
                          onClick={() => removeVideoFromQueue(selectedScreen, videoIdx)}
                          className="p-0.5 hover:bg-red-500/20 rounded transition-colors"
                        >
                          <X size={10} className="text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={clsx("p-4 border-t flex justify-between items-center", theme === 'light' ? 'border-black/10' : 'border-white/10')}>
              <div className="flex items-center gap-4">
                <p className={clsx("text-sm", styles.textMuted)}>
                  {availableVideos.length > 0 ? `Click videos to add to Screen ${selectedScreen + 1}` : 'Select a folder with videos'}
                </p>
                {selectedScreen !== null && queues[selectedScreen].videos.length >= 10 && (
                  <span className="text-xs text-red-400">Max 10 videos reached</span>
                )}
              </div>
              <button
                onClick={() => setShowVideoSelector(false)}
                className={clsx("px-4 py-2 rounded-lg transition-colors",
                  theme === 'light'
                    ? 'bg-neutral-100 hover:bg-neutral-200 text-zinc-900'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                )}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {showSingleVideo && singleVideoIndex !== null && singleVideoQueue.length > 0 && (
        <div className={clsx("fixed inset-0 z-50 flex flex-col", theme === 'light' ? 'bg-white' : 'bg-black')}>
          {/* Header */}
          <div className={clsx("flex items-center justify-between px-4 py-3 border-b", theme === 'light' ? 'border-black/10 bg-white' : 'border-white/10 bg-zinc-900')}>
            <h2 className={clsx("font-semibold", styles.text)}>
              {singleVideoQueue[singleVideoIndex].name}
            </h2>
            <button 
              onClick={closeSingleVideo}
              className={clsx("p-2 rounded-full transition-colors", theme === 'light' ? 'hover:bg-black/10 text-zinc-600' : 'hover:bg-white/10 text-zinc-400')}
            >
              <X size={24} />
            </button>
          </div>

          {/* Main Video Area */}
          <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
            <video
              ref={singleVideoRef}
              src={URL.createObjectURL(singleVideoQueue[singleVideoIndex].file)}
              className="max-w-full max-h-full object-contain"
              autoPlay
              controls
              playsInline
            />
            
            {/* Prev/Next Buttons */}
            <button
              onClick={playPrevVideo}
              className="absolute left-4 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronLeft size={32} />
            </button>
            <button
              onClick={playNextVideo}
              className="absolute right-4 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronRight size={32} />
            </button>
          </div>

          {/* Gallery Strip */}
          <div className={clsx("h-24 border-t flex items-center gap-2 px-4 overflow-x-auto", theme === 'light' ? 'border-black/10 bg-neutral-50' : 'border-white/10 bg-zinc-900')}>
            {singleVideoQueue.map((video, idx) => (
              <button
                key={video.id}
                onClick={() => setSingleVideoIndex(idx)}
                className={clsx(
                  "flex-shrink-0 w-16 h-20 rounded-lg overflow-hidden transition-all border-2",
                  idx === singleVideoIndex 
                    ? "border-blue-500 ring-2 ring-blue-500/50" 
                    : "border-transparent opacity-70 hover:opacity-100"
                )}
              >
                <video
                  src={URL.createObjectURL(video.file)}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
