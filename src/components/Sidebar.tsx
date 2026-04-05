import { motion } from 'motion/react';
import { ChevronRight, ChevronLeft, Folder, Home, Eye, EyeOff, Sun, Moon, Volume2, VolumeX, Trash2, Settings, ChevronDown, FolderOpen, Monitor, Cloud, CloudFog, Grid3X3, ImageIcon } from 'lucide-react';
import React, { useState, ReactNode, useEffect } from 'react';
import { clsx } from 'clsx';
import { Folder as FolderType, getSubfolders } from '../lib/db';

interface FolderTreeItem extends FolderType {
  subfolders: FolderTreeItem[];
  level: number;
}

export function Sidebar({ 
  currentView, 
  setView, 
  blurEnabled, 
  setBlurEnabled,
  privacyMode,
  setPrivacyMode,
  isMuted,
  setIsMuted,
  onClearCache,
  isOpen: externalIsOpen,
  setIsOpen: externalSetIsOpen,
  onOpenSettings,
  onSelectFolder
}: { 
  currentView: string, 
  setView: (v: string) => void,
  blurEnabled: boolean,
  setBlurEnabled: (v: boolean) => void,
  privacyMode?: 'none' | 'blur' | 'cover',
  setPrivacyMode?: (mode: 'none' | 'blur' | 'cover') => void,
  isMuted: boolean,
  setIsMuted: (v: boolean) => void,
  onClearCache?: () => void,
  isOpen?: boolean,
  setIsOpen?: (v: boolean) => void,
  onOpenSettings?: () => void,
  onSelectFolder?: (id: string) => void
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(true);
  const isOpen = externalIsOpen ?? internalIsOpen;
  const setIsOpen = externalSetIsOpen ?? setInternalIsOpen;
  const [folderTree, setFolderTree] = useState<FolderTreeItem[]>([]);
  const [galleriesExpanded, setGalleriesExpanded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadFolderTree();
  }, []);

  async function loadFolderTree() {
    const rootFolders = await getSubfolders(null);
    const tree: FolderTreeItem[] = [];
    
    for (const folder of rootFolders) {
      const subfolders = await getSubfolders(folder.id);
      tree.push({
        ...folder,
        subfolders: subfolders.map(sf => ({ ...sf, subfolders: [], level: 1 })),
        level: 0
      });
    }
    
    setFolderTree(tree);
  }

  const toggleFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleFolderClick = (folderId: string) => {
    console.log('Folder clicked:', folderId);
    onSelectFolder?.(folderId);
  };

  return (
    <motion.div
      initial={false}
      animate={{ width: isOpen ? 320 : 80 }}
      data-sidebar="true"
      className="h-screen flex flex-col relative z-50 shrink-0 backdrop-blur-xl bg-zinc-900/80 border-r border-white/10"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute -right-4 top-10 rounded-full p-3 min-w-[44px] min-h-[44px] text-white z-50 active:scale-95 transition-transform bg-zinc-700/80"
        aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      <div className={clsx(
        "flex flex-col gap-3 mt-16 flex-1 overflow-y-auto overscroll-contain",
        isOpen ? "p-4" : "p-3 items-center"
      )}>
        <SidebarItem id="home-btn" icon={<Home size={28} />} label="Home" isOpen={isOpen} active={currentView === 'home'} onClick={() => { console.log('Home clicked'); setView('home'); }} />
        
        <SidebarItem 
          id="multiview-btn"
          icon={<Grid3X3 size={28} />} 
          label="Multi-View" 
          isOpen={isOpen} 
          active={currentView === 'multiview'} 
          onClick={() => { console.log('MultiView clicked'); setView('multiview'); }} 
        />

        <SidebarItem 
          id="mindmap-btn"
          icon={<FolderOpen size={28} />} 
          label="MindMap" 
          isOpen={isOpen} 
          active={currentView === 'mindmap'} 
          onClick={() => { console.log('MindMap clicked'); setView('mindmap'); }} 
        />
        
        <div className="relative">
          <SidebarItem 
            id="galleries-btn"
            icon={<Folder size={28} />} 
            label="Galleries" 
            isOpen={isOpen} 
            active={currentView === 'galleries'} 
            onClick={() => {
              console.log('Galleries clicked');
              setView('galleries');
              if (isOpen) {
                setGalleriesExpanded(!galleriesExpanded);
              }
            }}
            rightIcon={isOpen ? (
              <ChevronDown 
                size={20} 
                className={clsx(
                  "transition-transform duration-75",
                  galleriesExpanded ? "rotate-180" : ""
                )} 
              />
            ) : undefined}
          />
          
          {isOpen && galleriesExpanded && folderTree.length > 0 && (
            <div className="mt-2 ml-4 pl-4 border-l border-white/10 space-y-1">
              {folderTree.map((folder) => (
                <div key={folder.id}>
                  <div className="flex items-center gap-2">
                    {folder.subfolders.length > 0 && (
                      <button
                        onClick={(e) => toggleFolder(folder.id, e)}
                        className={clsx(
                          "p-2 min-w-[44px] min-h-[44px] rounded-lg transition-colors active:scale-95 flex items-center justify-center",
                          "hover:bg-white/10 active:bg-white/20"
                        )}
                        aria-label={expandedFolders.has(folder.id) ? "Collapse folder" : "Expand folder"}
                      >
                        <ChevronDown 
                          size={14} 
                          className={clsx(
                            "transition-transform duration-75 text-zinc-400",
                            expandedFolders.has(folder.id) ? "rotate-180" : ""
                          )} 
                        />
                      </button>
                    )}
                    {folder.subfolders.length === 0 && <div className="w-6" />}
                    <button
                      onClick={() => handleFolderClick(folder.id)}
                      className={clsx(
                        "flex-1 flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl text-left transition-colors active:scale-[0.98]",
                        folder.localFolderPath 
                          ? "text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20"
                          : "text-zinc-400 hover:bg-white/5 hover:text-white active:bg-white/10"
                      )}
                    >
                      {folder.localFolderPath ? (
                        <FolderOpen size={16} />
                      ) : (
                        <Folder size={16} />
                      )}
                      <span className="text-sm truncate">{folder.name}</span>
                      {folder.localFolderPath && (
                        <span className="text-[10px] ml-auto text-emerald-500/70">synced</span>
                      )}
                    </button>
                  </div>
                  
                  {expandedFolders.has(folder.id) && folder.subfolders.length > 0 && (
                    <div className="ml-6 pl-4 border-l border-white/10 space-y-1 mt-1">
                      {folder.subfolders.map((subfolder) => (
                        <button
                          key={subfolder.id}
                          onClick={() => handleFolderClick(subfolder.id)}
                          className={clsx(
                            "w-full flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl text-left transition-colors active:scale-[0.98]",
                            subfolder.localFolderPath 
                              ? "text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20"
                              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300 active:bg-white/10"
                          )}
                        >
                          <Folder size={14} />
                          <span className="text-sm truncate">{subfolder.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {isOpen && galleriesExpanded && folderTree.length === 0 && (
            <div className="mt-2 ml-4 pl-4 text-sm text-zinc-500">
              No galleries yet
            </div>
          )}
        </div>
        
        <div className="flex-1"></div>
        
        <SidebarItem 
          icon={<Settings size={28} />} 
          label="Settings" 
          isOpen={isOpen} 
          active={false}
          onClick={() => onOpenSettings?.()} 
        />
        
        <SidebarItem 
          icon={privacyMode === 'blur' ? <EyeOff size={28} /> : privacyMode === 'cover' ? <ImageIcon size={28} /> : <Eye size={28} />} 
          label={privacyMode === 'blur' ? "Privacy: Blur" : privacyMode === 'cover' ? "Privacy: Cover" : "Privacy Off"} 
          isOpen={isOpen} 
          active={privacyMode !== 'none'}
          activeColor="amber"
          onClick={() => {
            if (setPrivacyMode) {
              const modes: ('none' | 'blur' | 'cover')[] = ['none', 'blur', 'cover'];
              const currentIndex = modes.indexOf(privacyMode || 'none');
              const nextMode = modes[(currentIndex + 1) % modes.length];
              setPrivacyMode(nextMode);
            }
          }} 
        />
        
        <SidebarItem 
          icon={isMuted ? <VolumeX size={28} /> : <Volume2 size={28} />} 
          label={isMuted ? "Muted" : "Unmuted"} 
          isOpen={isOpen} 
          active={isMuted}
          activeColor="amber"
          onClick={() => setIsMuted(!isMuted)} 
        />
        
        <SidebarItem 
          icon={<Trash2 size={28} />} 
          label="Delete All Gallery" 
          isOpen={isOpen} 
          active={false}
          onClick={() => {
            if (confirm("Delete all galleries? This will remove all folders and their videos from the app.")) {
              onClearCache?.();
            }
          }} 
        />
      </div>
    </motion.div>
  );
}

function SidebarItem({ 
  id,
  icon, 
  label, 
  isOpen, 
  active, 
  activeColor = "white",
  onClick,
  rightIcon
}: { 
  id?: string;
  icon: ReactNode, 
  label: string, 
  isOpen: boolean, 
  active: boolean,
  activeColor?: "white" | "amber",
  onClick: (e?: React.MouseEvent) => void,
  rightIcon?: ReactNode
}) {
  const activeClasses = activeColor === "amber" 
    ? "bg-amber-500/20 text-amber-300"
    : "bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]";

  return (
    <button
      id={id}
      onClick={(e) => onClick(e)}
      title={!isOpen ? label : undefined}
      className={clsx(
        "flex items-center rounded-2xl transition-all duration-300 overflow-hidden whitespace-nowrap w-full",
        isOpen ? "gap-4 p-4 min-h-[56px]" : "justify-center p-3 w-14 h-14 min-w-[56px] min-h-[56px]",
        active ? activeClasses : "text-zinc-400 hover:bg-white/5 hover:text-white active:bg-white/10"
      )}
    >
      <div className="flex items-center justify-center shrink-0 w-8 h-8">{icon}</div>
      {isOpen && (
        <>
          <span className="font-medium tracking-wide text-base flex-1 text-left">{label}</span>
          {rightIcon && <div className="shrink-0">{rightIcon}</div>}
        </>
      )}
    </button>
  );
}
