import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Archive, Folder, FolderOpen, FileVideo, Plus, Trash2, X, Edit2, Check, Move, Link2, ShieldAlert, RefreshCw, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { getFolders, getSubfolders, addFolder, deleteFolder, getVideosByFolder, addVideoZip, Folder as FolderType, VideoZip } from '../lib/db';
import { browseExistingFolder, getFolderHierarchy, createFolderInDirectory, getStoredDirectoryHandle, storeDirectoryHandle, requestLocalFolderAccess, saveFileToDirectory, refreshLocalFolder, FolderHierarchy } from '../lib/fileSystem';

interface MindMapNode extends FolderType {
  x: number;
  y: number;
  children: MindMapNode[];
  videos: VideoZip[];
  isExpanded: boolean;
  isGroupNode?: boolean;
  groupedChildren?: MindMapNode[];
}

interface NodeConnection {
  from: string;
  to: string;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const LEVEL_SPACING = 150;  // Vertical spacing between levels
const SIBLING_SPACING = 220; // Horizontal spacing between siblings

interface MindMapViewProps {
  onSelectFolder: (folderId: string) => void;
  onImportComplete?: () => void; // Add callback for when import finishes
}

export function MindMapView({ onSelectFolder, onImportComplete }: MindMapViewProps) {
  const [nodes, setNodes] = useState<Map<string, MindMapNode>>(new Map());
  const [connections, setConnections] = useState<NodeConnection[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [parentForNewNode, setParentForNewNode] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showHelp, setShowHelp] = useState(true);
  const [availableFolders, setAvailableFolders] = useState<FolderType[]>([]);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<'zipped' | 'unzipped'>('zipped');
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  
  // Import existing folder hierarchy states
  const [folderHierarchy, setFolderHierarchy] = useState<FolderHierarchy | null>(null);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<Set<string>>(new Set());
  const [isBrowsingFolder, setIsBrowsingFolder] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  
  // Refresh connection states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ newFiles: string[]; removedFiles: string[] } | null>(null);
  
  // Local folder contents state
  const [localFolderFiles, setLocalFolderFiles] = useState<string[]>([]);
  const [isLoadingLocalFiles, setIsLoadingLocalFiles] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Load all folders and build tree structure
  const loadData = useCallback(async () => {
    const allFolders = await getFolders();
    const allVideos: { [key: string]: VideoZip[] } = {};

    // Get videos for each folder
    for (const folder of allFolders) {
      allVideos[folder.id] = await getVideosByFolder(folder.id);
    }

    // Set available folders - only show uploaded galleries (folders with content)
    const galleriesWithContent = allFolders.filter(f => {
      const videos = allVideos[f.id] || [];
      return videos.length > 0; // Only show folders with uploaded content
    });
    setAvailableFolders(galleriesWithContent);

    // Build hierarchical structure with top-down layout (org chart style)
    // Only include directory folders (folders without videos) in the main tree
    const buildTree = (parentId: string | null, level: number, startX: number, startY: number): MindMapNode[] => {
      // Get all folders with this parent - show ALL folders including those with content
      const allFoldersWithParent = allFolders.filter(f => f.parentId === parentId);
      
      const nodes: MindMapNode[] = [];

      // Calculate total width needed for this level
      const totalWidth = allFoldersWithParent.length * SIBLING_SPACING;
      const startOffset = startX - totalWidth / 2 + SIBLING_SPACING / 2;

      allFoldersWithParent.forEach((folder, index) => {
        // Horizontal layout for siblings
        let x = allFoldersWithParent.length === 1 ? startX : startOffset + index * SIBLING_SPACING;
        // Vertical layout - children go below parents
        const y = parentId === null ? 80 : startY + LEVEL_SPACING;

        // Ensure x doesn't go off-screen to the left (minimum margin)
        const MIN_X = 50;
        if (x < MIN_X) {
          x = MIN_X;
        }

        // Recursively build children - all folders
        const children = buildTree(folder.id, level + 1, x, y);

        nodes.push({
          ...folder,
          x,
          y,
          children,
          videos: allVideos[folder.id] || [],
          isExpanded: true
        });
      });

      return nodes;
    };

    // Get actual container width for centering (accounting for side panel)
    const containerWidth = containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth - 320 - 288 : 800);
    const centerX = containerWidth / 2;
    const tree = buildTree(null, 0, centerX, 80);

    // Flatten tree into map
    const nodeMap = new Map<string, MindMapNode>();
    const flattenTree = (nodes: MindMapNode[]) => {
      nodes.forEach(node => {
        nodeMap.set(node.id, node);
        flattenTree(node.children);
      });
    };
    flattenTree(tree);

    setNodes(nodeMap);
    updateConnections(nodeMap);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update SVG connections
  const updateConnections = (nodeMap: Map<string, MindMapNode>) => {
    const conns: NodeConnection[] = [];
    nodeMap.forEach((node) => {
      if (node.children) {
        node.children.forEach(child => {
          conns.push({ from: node.id, to: child.id });
        });
      }
    });
    setConnections(conns);
  };

  // Handle mouse events for dragging nodes
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const node = nodes.get(nodeId);
    if (!node) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDragging(true);
    setDragNodeId(nodeId);
    setDragOffset({
      x: (e.clientX - rect.left - pan.x) / scale - node.x,
      y: (e.clientY - rect.top - pan.y) / scale - node.y
    });
    setSelectedNode(nodeId);
  };

  // Handle panning - allow regular drag on canvas
  const handleContainerMouseDown = (e: React.MouseEvent) => {
    // Only start panning if not clicking on a node (nodes handle their own mouse events)
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && dragNodeId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const newX = (e.clientX - rect.left - pan.x) / scale - dragOffset.x;
      const newY = (e.clientY - rect.top - pan.y) / scale - dragOffset.y;

      setNodes(prev => {
        const newNodes = new Map<string, MindMapNode>(prev);
        const node = newNodes.get(dragNodeId);
        if (node) {
          const updatedNode: MindMapNode = { ...node, x: newX, y: newY };
          newNodes.set(dragNodeId, updatedNode);
        }
        return newNodes;
      });
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  }, [isDragging, dragNodeId, dragOffset, isPanning, panStart, pan, scale]);

  // Handle touch events for iPad/mobile panning
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsPanning(true);
      setPanStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isPanning && e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      setPan({
        x: touch.clientX - panStart.x,
        y: touch.clientY - panStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
  };

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragNodeId(null);
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (isDragging || isPanning) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isPanning, handleMouseMove, handleMouseUp]);

  // Handle zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const newScale = Math.max(0.3, Math.min(3, scale - e.deltaY * 0.001));
      setScale(newScale);
    }
  };

  // Create new folder/node
  const handleCreateNode = async () => {
    if (!newFolderName.trim() && selectedFolderPaths.size === 0) return;
    
    const folderName = newFolderName.trim() || folderHierarchy?.name || 'New Folder';

    // If importing existing folder hierarchy
    if (folderHierarchy && selectedFolderPaths.size > 0 && !parentForNewNode) {
      try {
        // Import selected folders from the hierarchy
        const importedFolders: FolderType[] = [];
        const folderIdMap = new Map<string, string>(); // Map original path to new ID
        
        // Helper to create folder and its children
        const importFolder = async (
          hierarchyFolder: FolderHierarchy, 
          parentId: string | null, 
          pathPrefix: string
        ): Promise<string | null> => {
          // Only import if selected or is root
          const isSelected = selectedFolderPaths.has(hierarchyFolder.path);
          const isRoot = !parentId;
          
          if (!isSelected && !isRoot) return null;
          
          const newFolderId = crypto.randomUUID();
          const newPath = pathPrefix ? `${pathPrefix}/${hierarchyFolder.name}` : hierarchyFolder.name;
          
          const newFolder: FolderType = {
            id: newFolderId,
            name: hierarchyFolder.name,
            createdAt: Date.now(),
            parentId: parentId,
            sourceType: 'local',
            localFolderPath: newPath
          };
          
          await addFolder(newFolder);
          importedFolders.push(newFolder);
          folderIdMap.set(hierarchyFolder.path, newFolderId);
          console.log('Created folder:', hierarchyFolder.name, 'path:', hierarchyFolder.path, 'id:', newFolderId);
          
          // Import children that are selected
          for (const child of hierarchyFolder.children) {
            await importFolder(child, newFolderId, newPath);
          }
          
          return newFolderId;
        };
        
        // Start importing from root
        await importFolder(folderHierarchy, null, '');
        
        // Now import ONLY filenames (metadata) from the local folders - not actual file contents
        const importFilesFromFolder = async (hierarchyFolder: FolderHierarchy) => {
          const folderId = folderIdMap.get(hierarchyFolder.path);
          console.log('Importing filenames for folder:', hierarchyFolder.name, 'folderId:', folderId, 'path:', hierarchyFolder.path);
          if (!folderId) {
            console.log('No folderId found for path, skipping:', hierarchyFolder.path);
            return;
          }
          
          let fileCount = 0;
          try {
            // Scan files in this folder
            // @ts-ignore
            for await (const entry of hierarchyFolder.handle.values()) {
              console.log('Entry found:', entry.name, 'kind:', entry.kind);
              if (entry.kind === 'file') {
                try {
                  const file = await entry.getFile();
                  const fileName = file.name;
                  console.log('Got file:', fileName, 'size:', file.size, 'type:', file.type);
                  
                  // For archive files, store actual content so we can extract later
                  // For other files, store metadata only
                  const isArchive = fileName.toLowerCase().endsWith('.7z') || 
                                   fileName.toLowerCase().endsWith('.zip') ||
                                   fileName.toLowerCase().endsWith('.rar');
                  
                  const fileBlob = isArchive ? file : new Blob([], { type: 'application/x-filename-placeholder' });
                  
                  // Add to database
                  const newVideo: VideoZip = {
                    id: crypto.randomUUID(),
                    folderId: folderId,
                    name: fileName,
                    file: fileBlob,
                    createdAt: Date.now(),
                    sourceType: 'local',
                    isCached: false,
                  };
                  const result = await addVideoZip(newVideo);
                  console.log('addVideoZip result:', result);
                  if (result.success || result.message?.includes('already exists')) {
                    fileCount++;
                  }
                } catch (fileErr) {
                  console.error('Error getting file:', entry.name, fileErr);
                }
              }
            }
            
            console.log(`Imported ${fileCount} filenames into folder ${hierarchyFolder.name}`);
            
            // Only recurse into SELECTED children
            for (const child of hierarchyFolder.children) {
              if (selectedFolderPaths.has(child.path)) {
                await importFilesFromFolder(child);
              }
            }
          } catch (err) {
            console.error('Error importing filenames from folder:', hierarchyFolder.name, err);
          }
        };
        
        // Import files from all SELECTED folders (not just the root)
        console.log('Starting file import from folder hierarchy:', folderHierarchy.name);
        console.log('Selected paths:', Array.from(selectedFolderPaths));
        
        // Import from root if selected
        if (selectedFolderPaths.has(folderHierarchy.path)) {
          await importFilesFromFolder(folderHierarchy);
        }
        
        // Also import from all other selected folders
        for (const selectedPath of selectedFolderPaths) {
          if (selectedPath !== folderHierarchy.path) {
            // Find this folder in the hierarchy
            const findFolder = (folder: FolderHierarchy): FolderHierarchy | null => {
              if (folder.path === selectedPath) return folder;
              for (const child of folder.children) {
                const found = findFolder(child);
                if (found) return found;
              }
              return null;
            };
            const folder = findFolder(folderHierarchy);
            if (folder) {
              await importFilesFromFolder(folder);
            }
          }
        }
        
        console.log('File import complete');
        
        // Trigger refresh callback to update other components
        onImportComplete?.();
        
        alert(`Import complete! Check console (F12) for details. Selected ${selectedFolderPaths.size} folders.`);
        
        // Reload to get the new folders and files in the tree
        await loadData();
        
        // Verify import by checking video counts
        for (const [path, folderId] of folderIdMap.entries()) {
          const videos = await getVideosByFolder(folderId);
          console.log(`Verification: Folder ${path} has ${videos.length} videos`);
        }
      } catch (importErr) {
        console.error('Import failed with error:', importErr);
        alert(`Import error: ${importErr instanceof Error ? importErr.message : 'Unknown error'}. Check console for details.`);
      } finally {
        // Always close modal even if something failed
        setShowCreateModal(false);
        setNewFolderName('');
        setParentForNewNode(null);
        setFolderHierarchy(null);
        setSelectedFolderPaths(new Set());
      }
      return;
    }

    // Original create logic for new folders
    const newFolder: FolderType = {
      id: crypto.randomUUID(),
      name: folderName,
      createdAt: Date.now(),
      parentId: parentForNewNode,
      sourceType: 'local'
    };

    // Create local folder if parent has local storage
    if (parentForNewNode) {
      const parentNode = nodes.get(parentForNewNode);
      if (parentNode) {
        // Try to get parent's directory handle
        let parentHandle = await getStoredDirectoryHandle(parentForNewNode);
        
        // If no handle found but parent has localFolderPath, try to request access
        if (!parentHandle && parentNode.localFolderPath) {
          const { handle, error } = await requestLocalFolderAccess();
          if (handle) {
            // Navigate to the parent folder in the hierarchy
            const pathParts = parentNode.localFolderPath.split('/');
            parentHandle = handle;
            for (const part of pathParts.slice(1)) {
              try {
                parentHandle = await parentHandle.getDirectoryHandle(part, { create: false });
              } catch {
                parentHandle = await createFolderInDirectory(parentHandle, part);
              }
            }
            // Store the recovered handle
            if (parentHandle) {
              await storeDirectoryHandle(parentForNewNode, parentHandle);
            }
          }
        }
        
        if (parentHandle) {
          const newFolderHandle = await createFolderInDirectory(parentHandle, newFolder.name);
          if (newFolderHandle) {
            await storeDirectoryHandle(newFolder.id, newFolderHandle);
            newFolder.localFolderPath = `${parentNode.localFolderPath || parentNode.name}/${newFolder.name}`;
          }
        }
      }
    } else {
      // Top-level folder - ask for directory
      const { handle } = await requestLocalFolderAccess();
      if (handle) {
        const folderHandle = await createFolderInDirectory(handle, newFolder.name);
        if (folderHandle) {
          await storeDirectoryHandle(newFolder.id, folderHandle);
          newFolder.localFolderPath = `${handle.name}/${newFolder.name}`;
        }
      }
    }

    await addFolder(newFolder);

    // Get parent node reference
    const parentNode = parentForNewNode ? nodes.get(parentForNewNode) : null;

    // Position new node below parent (top-down layout)
    // Use container center for root, parent's x for children
    const containerWidth = containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth - 320 - 288 : 800);
    const centerX = containerWidth / 2;
    const newNode: MindMapNode = {
      ...newFolder,
      x: parentNode ? parentNode.x : centerX, // Center if root, below parent if child
      y: parentNode ? parentNode.y + LEVEL_SPACING : 80,
      children: [],
      videos: [],
      isExpanded: true
    };

    setNodes(prev => {
      const newNodes = new Map<string, MindMapNode>(prev);
      
      // If subfolder, calculate proper spacing with siblings
      if (parentForNewNode) {
        const parentNode = newNodes.get(parentForNewNode);
        if (parentNode) {
          // Get all children including the new one - use references from nodes Map
          const existingChildren = parentNode.children.map(c => newNodes.get(c.id)).filter(Boolean) as MindMapNode[];
          const allChildren = [...existingChildren, newNode];
          const totalWidth = allChildren.length * SIBLING_SPACING;
          const startOffset = parentNode.x - totalWidth / 2 + SIBLING_SPACING / 2;
          
          // Reposition all children evenly - preserving their children arrays
          allChildren.forEach((child, index) => {
            const newX = allChildren.length === 1 ? parentNode.x : startOffset + index * SIBLING_SPACING;
            const updatedChild: MindMapNode = {
              ...child,
              x: newX,
              y: parentNode.y + LEVEL_SPACING
            };
            newNodes.set(child.id, updatedChild);
          });
          
          // Update parent with new children array (use updated references)
          const updatedParent: MindMapNode = {
            ...parentNode,
            children: allChildren.map(c => newNodes.get(c.id) || c)
          };
          newNodes.set(parentForNewNode, updatedParent);
        }
      } else {
        // Root node - just add it
        newNodes.set(newFolder.id, newNode);
      }

      return newNodes;
    });

    updateConnections(new Map([...nodes, [newFolder.id, newNode]]));
    setShowCreateModal(false);
    setNewFolderName('');
    setParentForNewNode(null);
  };

  // Handle folder drop from side panel onto a node
  const handleDropFolder = async (folderId: string, targetParentId: string) => {
    const folderToMove = availableFolders.find(f => f.id === folderId);
    const targetParent = nodes.get(targetParentId);
    
    if (!folderToMove || !targetParent) return;
    
    // Prevent dropping onto itself or its own descendants
    if (folderId === targetParentId) return;
    
    // Check if target is a descendant of the folder being moved
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = nodes.get(parentId);
      if (!parent) return false;
      if (parent.children.some(c => c.id === childId)) return true;
      return parent.children.some(c => isDescendant(c.id, childId));
    };
    
    if (isDescendant(folderId, targetParentId)) return;

    // Update folder's parent in database
    const updatedFolder: FolderType = {
      ...folderToMove,
      parentId: targetParentId
    };
    await addFolder(updatedFolder);

    // Reload the tree to reflect changes
    await loadData();
    
    setDraggedFolderId(null);
    setDragOverNodeId(null);
  };

  // Handle zipped file drop - move the 7z archive file between folders
  const handleDropZippedFile = async (sourceFolderId: string, targetFolderId: string) => {
    const sourceFolder = availableFolders.find(f => f.id === sourceFolderId);
    const targetFolder = nodes.get(targetFolderId);
    
    if (!sourceFolder || !targetFolder) return;
    
    // Only work with archive folders
    if (!sourceFolder.isArchive || !sourceFolder.archiveFile) {
      alert('This folder does not have a 7z archive file');
      return;
    }
    
    // Get target's directory handle
    let targetHandle = await getStoredDirectoryHandle(targetFolderId);
    
    // If no handle but has localFolderPath, try to recover
    if (!targetHandle && targetFolder.localFolderPath) {
      const { handle } = await requestLocalFolderAccess();
      if (handle) {
        const pathParts = targetFolder.localFolderPath.split('/');
        targetHandle = handle;
        for (const part of pathParts.slice(1)) {
          try {
            targetHandle = await targetHandle.getDirectoryHandle(part, { create: false });
          } catch {
            targetHandle = await createFolderInDirectory(targetHandle, part);
          }
        }
        if (targetHandle) {
          await storeDirectoryHandle(targetFolderId, targetHandle);
        }
      }
    }
    
    if (!targetHandle) {
      alert('Target folder does not have local storage access');
      return;
    }
    
    // Copy the archive file to target folder
    try {
      const fileName = sourceFolder.archiveFile.name;
      const result = await saveFileToDirectory(targetHandle, fileName, sourceFolder.archiveFile);
      
      if (result.success) {
        // Update the source folder to point to new location
        const updatedFolder: FolderType = {
          ...sourceFolder,
          parentId: targetFolderId,
          localFolderPath: `${targetFolder.localFolderPath || targetFolder.name}/${sourceFolder.name}`
        };
        await addFolder(updatedFolder);
        
        // Reload tree
        await loadData();
        alert(`Moved ${fileName} to ${targetFolder.name}`);
      } else {
        alert('Failed to move archive: ' + result.error);
      }
    } catch (err) {
      console.error('Error moving archive:', err);
      alert('Failed to move archive file');
    }
    
    setDraggedFolderId(null);
    setDragOverNodeId(null);
  };

  // Quick create child folder with local directory
  const handleQuickCreateChild = async (parentId: string, folderName: string) => {
    const parentNode = nodes.get(parentId);
    if (!parentNode) return;

    // Get parent's directory handle
    let parentHandle = await getStoredDirectoryHandle(parentId);
    
    // If no handle, prompt user to set up local folder for parent first
    if (!parentHandle) {
      const setupParent = confirm(`"${parentNode.name}" needs a local folder set up first. Would you like to select a directory on your disk where this folder hierarchy will be created?`);
      if (!setupParent) {
        // Create without local link
        const newFolder: FolderType = {
          id: crypto.randomUUID(),
          name: folderName,
          createdAt: Date.now(),
          parentId: parentId,
          sourceType: 'local'
        };
        await addFolder(newFolder);
        
        const containerWidth = containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth - 320 - 288 : 800);
        const newNode: MindMapNode = {
          ...newFolder,
          x: parentNode.x,
          y: parentNode.y + LEVEL_SPACING,
          children: [],
          videos: [],
          isExpanded: true
        };
        
        setNodes(prev => {
          const newNodes = new Map<string, MindMapNode>(prev);
          const existingChildren = parentNode.children.map(c => newNodes.get(c.id)).filter(Boolean) as MindMapNode[];
          const allChildren = [...existingChildren, newNode];
          const totalWidth = allChildren.length * SIBLING_SPACING;
          const startOffset = parentNode.x - totalWidth / 2 + SIBLING_SPACING / 2;
          
          allChildren.forEach((child, index) => {
            const newX = allChildren.length === 1 ? parentNode.x : startOffset + index * SIBLING_SPACING;
            const updatedChild: MindMapNode = {
              ...child,
              x: newX,
              y: parentNode.y + LEVEL_SPACING
            };
            newNodes.set(child.id, updatedChild);
          });
          
          const updatedParent: MindMapNode = {
            ...parentNode,
            children: allChildren.map(c => newNodes.get(c.id) || c)
          };
          newNodes.set(parentId, updatedParent);
          return newNodes;
        });
        
        updateConnections(new Map([...nodes, [newFolder.id, newNode]]));
        setEditingNode(newFolder.id);
        setEditName(folderName);
        return;
      }
      
      // Request directory access for parent
      const { handle, error } = await requestLocalFolderAccess();
      if (!handle) {
        alert(error || 'Failed to access directory');
        return;
      }
      
      // Store the handle for parent
      await storeDirectoryHandle(parentId, handle);
      parentHandle = handle;
      
      // Update parent node with local path
      const updatedParent = { ...parentNode, localFolderPath: handle.name };
      await addFolder(updatedParent);
      setNodes(prev => {
        const newNodes = new Map(prev);
        newNodes.set(parentId, { ...parentNode, localFolderPath: handle.name });
        return newNodes;
      });
    }

    // Create folder object
    const newFolder: FolderType = {
      id: crypto.randomUUID(),
      name: folderName,
      createdAt: Date.now(),
      parentId: parentId,
      sourceType: 'local'
    };

    let newFolderHandle: FileSystemDirectoryHandle | null = null;

    // Create local subfolder if parent has local storage
    if (parentHandle) {
      newFolderHandle = await createFolderInDirectory(parentHandle, folderName);
      if (newFolderHandle) {
        await storeDirectoryHandle(newFolder.id, newFolderHandle);
        newFolder.localFolderPath = `${parentNode.localFolderPath || parentNode.name}/${folderName}`;
      }
    }

    await addFolder(newFolder);

    // Create the node
    const containerWidth = containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth - 320 - 288 : 800);
    const centerX = containerWidth / 2;
    const newNode: MindMapNode = {
      ...newFolder,
      x: parentNode.x,
      y: parentNode.y + LEVEL_SPACING,
      children: [],
      videos: [],
      isExpanded: true
    };

    setNodes(prev => {
      const newNodes = new Map<string, MindMapNode>(prev);
      
      // Get all children including the new one
      const existingChildren = parentNode.children.map(c => newNodes.get(c.id)).filter(Boolean) as MindMapNode[];
      const allChildren = [...existingChildren, newNode];
      const totalWidth = allChildren.length * SIBLING_SPACING;
      const startOffset = parentNode.x - totalWidth / 2 + SIBLING_SPACING / 2;
      
      // Reposition all children evenly
      allChildren.forEach((child, index) => {
        const newX = allChildren.length === 1 ? parentNode.x : startOffset + index * SIBLING_SPACING;
        const updatedChild: MindMapNode = {
          ...child,
          x: newX,
          y: parentNode.y + LEVEL_SPACING
        };
        newNodes.set(child.id, updatedChild);
      });
      
      // Update parent with new children array
      const updatedParent: MindMapNode = {
        ...parentNode,
        children: allChildren.map(c => newNodes.get(c.id) || c)
      };
      newNodes.set(parentId, updatedParent);

      return newNodes;
    });

    updateConnections(new Map([...nodes, [newFolder.id, newNode]]));

    // Start editing the name immediately so user can rename
    setEditingNode(newFolder.id);
    setEditName(folderName);
  };

  // Delete node
  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm('Delete this folder and all its contents?')) return;

    await deleteFolder(nodeId);
    setNodes(prev => {
      const newNodes = new Map(prev);
      newNodes.delete(nodeId);
      return newNodes;
    });
    setSelectedNode(null);
  };

  // Handle node click - zoom into node and show details
  const handleNodeClick = async (nodeId: string) => {
    if (editingNode === nodeId) return; // Don't zoom if editing
    
    const node = nodes.get(nodeId);
    if (!node) return;
    
    const containerWidth = containerRef.current?.clientWidth || 800;
    const containerHeight = containerRef.current?.clientHeight || 600;
    
    // Calculate zoom level and pan to center the node
    const targetScale = 1.5;
    const targetPanX = (containerWidth / 2) - (node.x + NODE_WIDTH / 2) * targetScale;
    const targetPanY = (containerHeight / 2) - (node.y + NODE_HEIGHT / 2) * targetScale - 100;
    
    setScale(targetScale);
    setPan({ x: targetPanX, y: targetPanY });
    setFocusedNode(nodeId);
    setSelectedNode(nodeId);
    
    // Load local folder contents if connected
    if (node.localFolderPath) {
      await loadLocalFolderContents(nodeId);
    }
  };

  // Exit focus mode
  const handleExitFocus = () => {
    setFocusedNode(null);
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  // Load local folder contents from disk
  const loadLocalFolderContents = async (nodeId: string) => {
    setIsLoadingLocalFiles(true);
    try {
      let handle = await getStoredDirectoryHandle(nodeId);
      
      // If no handle found, try to request access
      if (!handle) {
        const node = nodes.get(nodeId);
        if (node?.localFolderPath) {
          const { handle: newHandle } = await requestLocalFolderAccess();
          if (newHandle) {
            await storeDirectoryHandle(nodeId, newHandle);
            handle = newHandle;
          }
        }
      }
      
      if (!handle) {
        setLocalFolderFiles([]);
        return;
      }
      
      // Request permission if needed
      // @ts-ignore - FileSystemHandle permission API
      if (handle.queryPermission) {
        // @ts-ignore
        const permission = await handle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') {
          // @ts-ignore
          const newPermission = await handle.requestPermission({ mode: 'read' });
          if (newPermission !== 'granted') {
            setLocalFolderFiles([]);
            return;
          }
        }
      }
      
      const files: string[] = [];
      // @ts-ignore - FileSystemDirectoryHandle iteration
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          files.push(entry.name);
        }
      }
      setLocalFolderFiles(files);
    } catch (err: any) {
      console.error('Error loading local folder contents:', err);
      // Handle NotFoundError - directory was moved or deleted
      if (err.name === 'NotFoundError') {
        // Clear the invalid handle
        // @ts-ignore
        if (window.showDirectoryPicker) {
          try {
            const newHandle = await window.showDirectoryPicker();
            if (newHandle) {
              await storeDirectoryHandle(nodeId, newHandle);
              // Try loading again with new handle
              const files: string[] = [];
              // @ts-ignore
              for await (const entry of newHandle.values()) {
                if (entry.kind === 'file') {
                  files.push(entry.name);
                }
              }
              setLocalFolderFiles(files);
              return;
            }
          } catch (pickErr) {
            console.log('User cancelled folder selection');
          }
        }
      }
      setLocalFolderFiles([]);
    } finally {
      setIsLoadingLocalFiles(false);
    }
  };
  const handleNavigateToFolder = () => {
    if (focusedNode) {
      onSelectFolder(focusedNode);
    }
  };

  // Refresh local folder connection and detect new files
  const handleRefreshConnection = async (nodeId: string) => {
    setIsRefreshing(true);
    setRefreshResult(null);
    
    const node = nodes.get(nodeId);
    if (!node) {
      setIsRefreshing(false);
      return;
    }
    
    // Get existing file names from the node's videos
    const existingFileNames = node.videos.map(v => v.name);
    
    const result = await refreshLocalFolder(nodeId, existingFileNames);
    
    if (result.success) {
      setRefreshResult({ newFiles: result.newFiles, removedFiles: result.removedFiles });
      
      // If there are new files, add them to the database
      if (result.newFiles.length > 0) {
        const handle = await getStoredDirectoryHandle(nodeId);
        if (handle) {
          for (const fileName of result.newFiles) {
            try {
              const fileHandle = await handle.getFileHandle(fileName);
              const file = await fileHandle.getFile();
              
              // Add to database as a video
              const newVideo: VideoZip = {
                id: crypto.randomUUID(),
                folderId: nodeId,
                name: fileName,
                file,
                createdAt: Date.now(),
              };
              await addVideoZip(newVideo);
            } catch (err) {
              console.error('Error adding new file:', fileName, err);
            }
          }
          
          // Reload to get the new files
          await loadData();
        }
      }
    } else {
      console.error('Refresh failed:', result.error);
    }
    
    setIsRefreshing(false);
  };

  const toggleExpansion = (nodeId: string) => {
    setNodes(prev => {
      const newNodes = new Map<string, MindMapNode>(prev);
      const node = newNodes.get(nodeId);
      if (node) {
        const updatedNode: MindMapNode = { ...node, isExpanded: !node.isExpanded };
        newNodes.set(nodeId, updatedNode);
      }
      return newNodes;
    });
  };

  // Start editing node name
  const startEditing = (node: MindMapNode) => {
    setEditingNode(node.id);
    setEditName(node.name);
  };

  // Save edited name
  const saveEdit = async () => {
    if (!editingNode || !editName.trim()) return;

    const node = nodes.get(editingNode);
    if (!node) return;

    const updatedFolder = { ...node, name: editName.trim() };
    await addFolder(updatedFolder);

    setNodes(prev => {
      const newNodes = new Map(prev);
      newNodes.set(editingNode, { ...node, name: editName.trim() });
      return newNodes;
    });

    setEditingNode(null);
    setEditName('');
  };

  // Browse for existing folder to import
  const handleBrowseExistingFolder = async () => {
    setIsBrowsingFolder(true);
    setBrowseError(null);
    
    const { hierarchy, error } = await browseExistingFolder();
    
    if (error) {
      setBrowseError(error);
    } else if (hierarchy) {
      setFolderHierarchy(hierarchy);
      // Auto-select all folders by default
      const allPaths = new Set<string>();
      const collectPaths = (folder: FolderHierarchy) => {
        allPaths.add(folder.path);
        folder.children.forEach(collectPaths);
      };
      collectPaths(hierarchy);
      setSelectedFolderPaths(allPaths);
      // Set default name from folder
      setNewFolderName(hierarchy.name);
    }
    
    setIsBrowsingFolder(false);
  };

  // Toggle folder selection in tree
  const toggleFolderSelection = (path: string) => {
    setSelectedFolderPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  // Check if folder contains archive files and return security info
  const getArchiveSecurityInfo = (node: MindMapNode) => {
    const archives = node.videos.filter(v => {
      const name = v.name?.toLowerCase() || '';
      return name.endsWith('.zip') || name.endsWith('.7z') || name.endsWith('.rar');
    });
    
    if (archives.length === 0) return null;
    
    const hasZip = archives.some(v => v.name?.toLowerCase().endsWith('.zip'));
    const has7z = archives.some(v => v.name?.toLowerCase().endsWith('.7z'));
    const hasRar = archives.some(v => v.name?.toLowerCase().endsWith('.rar'));
    
    // Check if any are password protected (assume not if no flag set)
    const unprotectedArchives = archives.filter(v => !v.isPasswordProtected);
    const isProtected = unprotectedArchives.length === 0;
    
    return {
      hasZip,
      has7z,
      hasRar,
      isProtected,
      count: archives.length,
      unprotectedCount: unprotectedArchives.length,
      archives: archives.map(v => ({
        name: v.name,
        isProtected: v.isPasswordProtected,
        is7z: v.name?.toLowerCase().endsWith('.7z'),
        isZip: v.name?.toLowerCase().endsWith('.zip'),
        isRar: v.name?.toLowerCase().endsWith('.rar')
      }))
    };
  };
  const getNodeColor = (node: MindMapNode) => {
    const archiveInfo = getArchiveSecurityInfo(node);
    
    if (archiveInfo) {
      // Check for unprotected 7z files (RED - highest priority)
      const hasUnprotected7z = archiveInfo.archives.some(a => a.is7z && !a.isProtected);
      if (hasUnprotected7z) {
        return 'from-red-600/30 to-red-800/30 border-red-500/40';
      }
      
      // Check for unprotected zip files (RED)
      const hasUnprotectedZip = archiveInfo.archives.some(a => a.isZip && !a.isProtected);
      if (hasUnprotectedZip) {
        return 'from-red-600/30 to-red-800/30 border-red-500/40';
      }
      
      // Check for password-protected 7z (GREEN)
      const hasProtected7z = archiveInfo.archives.some(a => a.is7z && a.isProtected);
      if (hasProtected7z) {
        return 'from-emerald-600/30 to-green-800/30 border-emerald-500/40';
      }
      
      // Check for password-protected zip (YELLOW)
      const hasProtectedZip = archiveInfo.archives.some(a => a.isZip && !a.is7z && a.isProtected);
      if (hasProtectedZip) {
        return 'from-yellow-600/30 to-amber-800/30 border-yellow-500/40';
      }
    }
    
    if (node.videos.length > 0) {
      return 'from-violet-600/30 to-purple-800/30 border-violet-500/40';
    }
    if (node.localFolderPath) {
      return 'from-emerald-600/30 to-teal-800/30 border-emerald-500/40';
    }
    return 'from-zinc-700/40 to-zinc-800/40 border-zinc-600/30';
  };

  // Get content galleries for a specific folder (shown when zoomed)
  const getFolderContents = (folderId: string) => {
    return Array.from(nodes.values()).filter((n: MindMapNode) => n.parentId === folderId && n.videos.length > 0);
  };

  // Get visible nodes with grouping for >5 children
  const getVisibleNodes = (): MindMapNode[] => {
    const visible: MindMapNode[] = [];
    const GROUP_SIZE = 3;
    const MAX_DIRECT_CHILDREN = 5;

    const addVisibleRecursive = (node: MindMapNode, depth: number = 0) => {
      visible.push(node);
      
      if (node.isExpanded && node.children && node.children.length > 0) {
        // If more than 5 children, show first few and group rest
        if (node.children.length > MAX_DIRECT_CHILDREN) {
          // Show first GROUP_SIZE children directly
          const directChildren = node.children.slice(0, GROUP_SIZE);
          directChildren.forEach(child => addVisibleRecursive(child, depth + 1));
          
          // Create a "group node" for the rest
          const groupSize = node.children.length - GROUP_SIZE;
          const groupNode: MindMapNode = {
            id: `${node.id}-group`,
            name: `+${groupSize} more`,
            parentId: node.id,
            x: node.x + SIBLING_SPACING * (GROUP_SIZE + 1),
            y: node.y + LEVEL_SPACING,
            children: [],
            videos: [],
            isExpanded: false,
            isGroupNode: true,
            groupedChildren: node.children.slice(GROUP_SIZE),
            createdAt: Date.now(),
          };
          visible.push(groupNode);
        } else {
          // Show all children directly
          node.children.forEach(child => addVisibleRecursive(child, depth + 1));
        }
      }
    };

    const allNodes = Array.from(nodes.values()) as MindMapNode[];
    const rootNodes = allNodes.filter(n => !n.parentId);
    rootNodes.forEach(node => addVisibleRecursive(node));
    return visible;
  };

  const visibleNodes = getVisibleNodes();
  const visibleConnections = connections.filter(c => {
    const fromNode = nodes.get(c.from);
    return fromNode?.isExpanded;
  });

  // Folder Tree View Component for importing existing folders
  const FolderTreeView: React.FC<{
    folder: FolderHierarchy;
    selectedPaths: Set<string>;
    onToggle: (path: string) => void;
    depth?: number;
  }> = ({ folder, selectedPaths, onToggle, depth = 0 }) => {
    const isSelected = selectedPaths.has(folder.path);
    const hasChildren = folder.children.length > 0;
    
    return (
      <div className="select-none">
        <div 
          className="flex items-center gap-2 py-1 hover:bg-white/5 rounded cursor-pointer"
          style={{ paddingLeft: `${depth * 16}px` }}
          onClick={() => onToggle(folder.path)}
        >
          <div className={clsx(
            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
            isSelected 
              ? "bg-indigo-600 border-indigo-600" 
              : "border-zinc-600 hover:border-zinc-500"
          )}>
            {isSelected && <Check size={12} className="text-white" />}
          </div>
          <Folder size={16} className={clsx(
            "transition-colors",
            isSelected ? "text-indigo-400" : "text-zinc-500"
          )} />
          <span className={clsx(
            "text-sm truncate",
            isSelected ? "text-white" : "text-zinc-400"
          )}>
            {folder.name}
          </span>
          {folder.fileCount > 0 && (
            <span className="text-xs text-zinc-600">
              ({folder.fileCount} files)
            </span>
          )}
        </div>
        {hasChildren && (
          <div>
            {folder.children.map(child => (
              <FolderTreeView
                key={child.path}
                folder={child}
                selectedPaths={selectedPaths}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative flex">
      {/* Side Panel - Content Galleries (from 7z archives) */}
      <div className="w-72 h-full bg-zinc-900/90 border-r border-white/10 flex flex-col shrink-0 z-20">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Archive size={18} className="text-violet-400" />
              Content Galleries
            </h3>
            {/* Drag Mode Toggle */}
            <div className="flex bg-zinc-800 rounded-lg p-1">
              <button
                onClick={() => setDragMode('zipped')}
                className={clsx(
                  "px-2 py-1 text-xs rounded-md transition-colors",
                  dragMode === 'zipped' ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
                )}
                title="Drag 7z zipped files"
              >
                7z
              </button>
              <button
                onClick={() => setDragMode('unzipped')}
                className={clsx(
                  "px-2 py-1 text-xs rounded-md transition-colors",
                  dragMode === 'unzipped' ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
                )}
                title="Drag extracted contents"
              >
                Unzipped
              </button>
            </div>
          </div>
          <p className="text-zinc-500 text-xs">
            {dragMode === 'zipped' 
              ? "Drag 7z archives to directory folders" 
              : "Drag content galleries to organize"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {availableFolders.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">
              {dragMode === 'zipped' ? "No 7z archives" : "No content galleries"}
            </p>
          ) : (
            availableFolders.map((folder) => (
              <div
                key={folder.id}
                draggable
                onDragStart={(e) => {
                  setDraggedFolderId(folder.id);
                  e.dataTransfer.setData('folderId', folder.id);
                  e.dataTransfer.setData('dragMode', dragMode);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDraggedFolderId(null)}
                className={clsx(
                  "p-3 rounded-xl border border-white/10 cursor-grab active:cursor-grabbing transition-all",
                  "bg-zinc-800/50 hover:bg-zinc-700/50",
                  draggedFolderId === folder.id && "opacity-50"
                )}
              >
                <div className="flex items-center gap-2">
                  {dragMode === 'zipped' ? (
                    <Archive size={16} className={folder.isArchive ? "text-amber-400" : "text-zinc-400"} />
                  ) : (
                    <FileVideo size={16} className="text-violet-400" />
                  )}
                  <span className="text-white text-sm truncate">{folder.name}</span>
                </div>
                {folder.localFolderPath && dragMode === 'unzipped' && (
                  <div className="text-emerald-500/60 text-[10px] mt-1 truncate">
                    {folder.localFolderPath}
                  </div>
                )}
                {folder.isArchive && dragMode === 'zipped' && (
                  <div className="text-amber-500/60 text-[10px] mt-1">
                    {folder.archiveFile?.name || "7z Archive"}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 h-full relative overflow-hidden">
        {/* Help overlay */}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute top-4 left-4 z-50 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 max-w-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-semibold">MindMap Controls</h3>
                <button onClick={() => setShowHelp(false)} className="text-zinc-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• Drag nodes to rearrange</li>
                <li>• Shift+drag to pan canvas</li>
                <li>• Ctrl+scroll to zoom</li>
                <li>• Drag folders from sidebar to add</li>
                <li>• Folders auto-create locally</li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toolbar */}
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          <button
            onClick={() => {
              setParentForNewNode(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors"
          >
            <Plus size={18} />
            New Root Folder
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 rounded-xl transition-colors"
          >
            ?
          </button>
          <div className="flex items-center gap-2 px-3 bg-zinc-800/80 rounded-xl text-zinc-400 text-sm">
            <span>{Math.round(scale * 100)}%</span>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
          onMouseDown={handleContainerMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => {
            // Exit focus mode when clicking empty canvas
            if (focusedNode) {
              handleExitFocus();
            }
          }}
          onWheel={handleWheel}
        >
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: '0 0'
            }}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="rgba(255,255,255,0.3)" />
              </marker>
            </defs>
            {visibleConnections.map((conn, i) => {
              const from = nodes.get(conn.from);
              const to = nodes.get(conn.to);
              if (!from || !to) return null;

              return (
                <line
                  key={`${conn.from}-${conn.to}`}
                  x1={from.x + NODE_WIDTH / 2}
                  y1={from.y + NODE_HEIGHT}
                  x2={to.x + NODE_WIDTH / 2}
                  y2={to.y}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={2}
                  markerEnd="url(#arrowhead)"
                />
              );
            })}
          </svg>

          {/* Nodes */}
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: '0 0'
            }}
          >
            {visibleNodes.map((node) => (
              <motion.div
                key={node.id}
                className={clsx(
                  "absolute rounded-2xl border backdrop-blur-md cursor-pointer select-none",
                  "bg-gradient-to-br shadow-lg transition-all duration-500",
                  getNodeColor(node),
                  selectedNode === node.id && "ring-2 ring-white/50 shadow-xl shadow-white/10",
                  dragOverNodeId === node.id && "ring-2 ring-emerald-400 shadow-lg shadow-emerald-400/20",
                  focusedNode && focusedNode !== node.id && "opacity-30 blur-sm pointer-events-none",
                  focusedNode === node.id && "ring-4 ring-indigo-500 shadow-2xl shadow-indigo-500/30 z-50"
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH,
                  minHeight: NODE_HEIGHT,
                  perspective: '1000px',
                  transformStyle: 'preserve-3d'
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ 
                  scale: focusedNode === node.id ? 1.1 : 1, 
                  opacity: focusedNode && focusedNode !== node.id ? 0.3 : 1 
                }}
                onClick={() => handleNodeClick(node.id)}
                onMouseDown={(e) => {
                  if (focusedNode === node.id) {
                    e.stopPropagation();
                    handleNodeMouseDown(e, node.id);
                  }
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverNodeId(node.id);
                }}
                onDragLeave={() => setDragOverNodeId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const folderId = e.dataTransfer.getData('folderId');
                  const mode = e.dataTransfer.getData('dragMode') as 'zipped' | 'unzipped';
                  if (folderId) {
                    if (mode === 'zipped') {
                      handleDropZippedFile(folderId, node.id);
                    } else {
                      handleDropFolder(folderId, node.id);
                    }
                  }
                }}
              >
                {/* 3D Hover Preview - Child folders/videos pop out BEHIND */}
                <AnimatePresence>
                  {hoveredNode === node.id && !focusedNode && (node.children.length > 0 || node.videos.length > 0) && (
                    <motion.div
                      className="absolute inset-[-32px] pointer-events-none z-0"
                      style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {/* Background layer with children */}
                      <div className="absolute inset-0 flex items-center justify-center" style={{ transformStyle: 'preserve-3d' }}>
                        {/* Show child folders as floating cards behind */}
                        {node.children.slice(0, 3).map((child, i) => (
                          <motion.div
                            key={child.id}
                            className="absolute w-20 h-14 rounded-xl bg-zinc-800/95 border border-white/30 shadow-2xl flex flex-col items-center justify-center"
                            initial={{ 
                              opacity: 0, 
                              y: 40,
                              rotateX: 60,
                              translateZ: -200
                            }}
                            animate={{ 
                              opacity: 1, 
                              y: -60 - (i * 35),
                              x: (i - 1) * 60,
                              rotateX: -20,
                              rotateY: (i - 1) * 15,
                              translateZ: -150 - (i * 40)
                            }}
                            exit={{ 
                              opacity: 0,
                              y: 40,
                              rotateX: 60,
                              translateZ: -200
                            }}
                            transition={{ 
                              duration: 0.5,
                              delay: i * 0.08,
                              ease: [0.25, 0.46, 0.45, 0.94]
                            }}
                            style={{ transformStyle: 'preserve-3d' }}
                          >
                            <Folder size={24} className="text-emerald-400" />
                            <span className="text-[9px] text-zinc-300 whitespace-nowrap mt-1 px-2 truncate max-w-[70px]">
                              {child.name.slice(0, 10)}{child.name.length > 10 ? '...' : ''}
                            </span>
                          </motion.div>
                        ))}
                        
                        {/* Show video thumbnails if no children */}
                        {node.children.length === 0 && node.videos.slice(0, 3).map((video, i) => (
                          <motion.div
                            key={video.id}
                            className="absolute w-20 h-24 rounded-lg bg-zinc-800/95 border border-white/30 shadow-2xl overflow-hidden flex flex-col"
                            initial={{ 
                              opacity: 0, 
                              y: 40,
                              rotateX: 60,
                              translateZ: -200
                            }}
                            animate={{ 
                              opacity: 1, 
                              y: -70 - (i * 40),
                              x: (i - 1) * 55,
                              rotateX: -15,
                              rotateY: (i - 1) * 12,
                              rotateZ: (i - 1) * -5,
                              translateZ: -180 - (i * 50)
                            }}
                            exit={{ 
                              opacity: 0,
                              y: 40,
                              rotateX: 60,
                              translateZ: -200
                            }}
                            transition={{ 
                              duration: 0.5,
                              delay: i * 0.1,
                              ease: [0.25, 0.46, 0.45, 0.94]
                            }}
                            style={{ transformStyle: 'preserve-3d' }}
                          >
                            <div className="w-full h-16 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
                              <FileVideo size={28} className="text-violet-400" />
                            </div>
                            <span className="text-[8px] text-zinc-400 whitespace-nowrap px-2 py-1 truncate">
                              {video.name.slice(0, 15)}{video.name.length > 15 ? '...' : ''}
                            </span>
                          </motion.div>
                        ))}
                        
                        {/* More indicator if there are more items */}
                        {(node.children.length > 3 || node.videos.length > 3) && (
                          <motion.div
                            className="absolute -top-28 text-xs text-zinc-300 bg-zinc-800/90 px-3 py-1.5 rounded-full border border-white/20 shadow-xl"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ delay: 0.3 }}
                          >
                            +{node.children.length > 3 ? node.children.length - 3 : node.videos.length - 3} more
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main folder content - ABOVE the 3D preview */}
                <div className="relative z-10 p-3 flex flex-col h-full">
                  {/* Header */}
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      {node.localFolderPath ? (
                        <FolderOpen size={18} className="text-emerald-400" />
                      ) : (
                        <Folder size={18} className="text-zinc-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingNode === node.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                            className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-white/40"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded">
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <span
                          className="text-white font-medium text-sm truncate block"
                          onDoubleClick={() => startEditing(node)}
                          title={node.name}
                        >
                          {node.name}
                        </span>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const archiveInfo = getArchiveSecurityInfo(node);
                          if (archiveInfo && archiveInfo.archives.length > 0) {
                            return (
                              <>
                                {/* Show all archive type badges with appropriate icons */}
                                {archiveInfo.archives.map((archive, idx) => (
                                  <span 
                                    key={idx}
                                    className={clsx(
                                      "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded",
                                      archive.is7z && archive.isProtected && "text-emerald-400 bg-emerald-500/10",
                                      archive.is7z && !archive.isProtected && "text-red-400 bg-red-500/10",
                                      archive.isZip && archive.isProtected && "text-yellow-400 bg-yellow-500/10",
                                      archive.isZip && !archive.isProtected && "text-red-400 bg-red-500/10"
                                    )}
                                  >
                                    {archive.isProtected ? (
                                      <ShieldCheck size={10} />
                                    ) : (
                                      <ShieldAlert size={10} />
                                    )}
                                    {archive.is7z ? "7z" : archive.isZip ? "ZIP" : "RAR"}
                                  </span>
                                ))}
                              </>
                            );
                          }
                          return null;
                        })()}
                        {node.videos.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-violet-300">
                            <FileVideo size={10} />
                            {node.videos.length}
                          </span>
                        )}
                        {node.children.length > 0 && (
                          <span className="text-xs text-zinc-500">
                            {node.children.length} sub
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-1">
                      {node.children.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpansion(node.id); }}
                          className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                          title={node.isExpanded ? "Collapse" : "Expand"}
                        >
                          <Link2 size={14} className={node.isExpanded ? "" : "rotate-90"} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditing(node); }}
                        className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        title="Rename"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={async (e) => { 
                          e.stopPropagation(); 
                          // Auto-create child folder with default name
                          const newFolderName = `Folder ${node.children.length + 1}`;
                          await handleQuickCreateChild(node.id, newFolderName);
                        }}
                        className="p-1.5 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                        title="Add child folder"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }}
                        className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Selection indicator */}
                {selectedNode === node.id && (
                  <div className="absolute -inset-1 border-2 border-white/30 rounded-2xl pointer-events-none" />
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Create Folder Modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
              onClick={() => setShowCreateModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-[32rem] max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-white font-semibold text-lg mb-4">
                  {parentForNewNode ? 'Create Subfolder' : 'Create Root Folder'}
                </h3>
                
                {!parentForNewNode && (
                  <div className="mb-4">
                    <button
                      onClick={handleBrowseExistingFolder}
                      disabled={isBrowsingFolder}
                      className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-colors flex items-center justify-center gap-2 border border-dashed border-zinc-600"
                    >
                      {isBrowsingFolder ? (
                        <span className="animate-pulse">Browsing...</span>
                      ) : (
                        <>
                          <FolderOpen size={18} />
                          Browse Existing Folder
                        </>
                      )}
                    </button>
                    <p className="text-zinc-500 text-xs mt-2 text-center">
                      Select an existing folder to import its hierarchy
                    </p>
                  </div>
                )}

                {browseError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-400 text-sm">
                    {browseError}
                  </div>
                )}

                {folderHierarchy && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-zinc-300 text-sm font-medium">
                        {folderHierarchy.name}
                      </p>
                      <button
                        onClick={() => setFolderHierarchy(null)}
                        className="text-zinc-500 hover:text-white text-xs"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 max-h-48 overflow-y-auto border border-white/5">
                      <FolderTreeView
                        folder={folderHierarchy}
                        selectedPaths={selectedFolderPaths}
                        onToggle={toggleFolderSelection}
                      />
                    </div>
                    <p className="text-zinc-500 text-xs mt-2">
                      {selectedFolderPaths.size} folder(s) selected
                    </p>
                  </div>
                )}
                
                <p className="text-zinc-400 text-sm mb-4">
                  {parentForNewNode
                    ? 'This will create a local folder on disk as well.'
                    : folderHierarchy 
                      ? 'Enter a name for the root folder or use the selected folder name.'
                      : 'Create a new folder or browse an existing one to import.'}
                </p>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateNode()}
                  placeholder="Folder name..."
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-white/40 mb-4"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateNode}
                    disabled={!newFolderName.trim() && selectedFolderPaths.size === 0}
                    className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                  >
                    {folderHierarchy ? 'Import Selected' : 'Create'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Exit Focus Button */}
        <AnimatePresence>
          {focusedNode && (
            <motion.button
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onClick={handleExitFocus}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-zinc-900/90 backdrop-blur-xl border border-white/20 rounded-full text-white text-sm font-medium hover:bg-zinc-800 transition-colors flex items-center gap-2"
            >
              <X size={16} />
              Exit Focus
            </motion.button>
          )}
        </AnimatePresence>

        {/* Focused Node Detail Panel */}
        <AnimatePresence>
          {focusedNode && (() => {
            const node = nodes.get(focusedNode);
            if (!node) return null;
            
            // Get connected galleries (folders with videos)
            const connectedGalleries = availableFolders.filter(f => 
              f.parentId === node.id || node.children.some(c => c.id === f.id)
            );
            
            return (
              <motion.div
                initial={{ opacity: 0, x: 100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 100 }}
                className="absolute right-4 top-20 bottom-4 w-80 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl z-50 flex flex-col overflow-hidden"
              >
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-3 pb-2 border-b border-white/10">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center">
                      <Folder size={20} className="text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{node.name}</h3>
                      <p className="text-zinc-500 text-xs">Directory Folder</p>
                    </div>
                  </div>
                  {/* Security Section */}
                  {(() => {
                    const archiveInfo = getArchiveSecurityInfo(node);
                    if (!archiveInfo || archiveInfo.count === 0) return null;
                    
                    // Check if any unprotected archives exist
                    const hasUnprotected = archiveInfo.archives.some(a => !a.isProtected);
                    
                    return (
                      <div className={clsx(
                        "p-3 rounded-lg border",
                        hasUnprotected 
                          ? "bg-red-950/40 border-red-500/30" 
                          : "bg-emerald-950/40 border-emerald-500/30"
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          {hasUnprotected ? (
                            <ShieldAlert size={16} className="text-red-400" />
                          ) : (
                            <ShieldCheck size={16} className="text-emerald-400" />
                          )}
                          <span className={clsx(
                            "font-medium text-sm",
                            hasUnprotected ? "text-red-300" : "text-emerald-300"
                          )}>
                            {hasUnprotected ? "Security Notice" : "All Archives Protected"}
                          </span>
                        </div>
                        
                        {/* List of all archive files with flags */}
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {archiveInfo.archives.map((archive, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs">
                              {archive.is7z ? (
                                archive.isProtected ? (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                                    <ShieldCheck size={10} />
                                    7z
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                                    <ShieldAlert size={10} />
                                    7z
                                  </span>
                                )
                              ) : archive.isZip ? (
                                archive.isProtected ? (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                                    <ShieldCheck size={10} />
                                    ZIP
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                                    <ShieldAlert size={10} />
                                    ZIP
                                  </span>
                                )
                              ) : (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                                  <ShieldCheck size={10} />
                                  RAR
                                </span>
                              )}
                              <span className={clsx(
                                "truncate",
                                archive.isProtected ? "text-emerald-400" : "text-red-400"
                              )}>
                                {archive.name}
                              </span>
                            </div>
                          ))}
                        </div>
                        
                        {hasUnprotected && (
                          <p className="text-red-500/60 text-xs mt-2">
                            Password protection is strongly recommended.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  
                  {/* Subfolders */}
                  {node.children.length > 0 && (
                    <div>
                      <h4 className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-2">
                        Subfolders ({node.children.length})
                      </h4>
                      <div className="space-y-2">
                        {node.children.map(child => (
                          <div 
                            key={child.id}
                            className="p-2 rounded-lg bg-zinc-800/50 border border-white/5 flex items-center gap-2"
                          >
                            <Folder size={14} className="text-zinc-400" />
                            <span className="text-zinc-300 text-sm truncate">{child.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Connected Galleries */}
                  {connectedGalleries.length > 0 && (
                    <div>
                      <h4 className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-2">
                        Connected Galleries ({connectedGalleries.length})
                      </h4>
                      <div className="space-y-2">
                        {connectedGalleries.map(gallery => (
                          <div 
                            key={gallery.id}
                            className="p-2 rounded-lg bg-violet-900/20 border border-violet-500/20 flex items-center gap-2"
                          >
                            <FileVideo size={14} className="text-violet-400" />
                            <span className="text-violet-300 text-sm truncate">{gallery.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Local Folder Contents - Shows actual files on disk */}
                  {node.localFolderPath && (
                    <div>
                      <h4 className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-2">
                        Local Folder Contents ({localFolderFiles.length})
                      </h4>
                      {isLoadingLocalFiles ? (
                        <div className="p-3 rounded-lg bg-zinc-800/50 border border-white/10">
                          <div className="flex items-center gap-2 text-zinc-400 text-sm">
                            <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
                            Loading files...
                          </div>
                        </div>
                      ) : localFolderFiles.length > 0 ? (
                        <div className="p-3 rounded-lg bg-zinc-800/50 border border-white/10 max-h-48 overflow-y-auto">
                          <div className="space-y-1">
                            {localFolderFiles.map((fileName, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm">
                                <FileVideo size={14} className="text-zinc-500" />
                                <span className="text-zinc-300 truncate">{fileName}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-lg bg-zinc-800/50 border border-white/10">
                          <p className="text-zinc-500 text-sm">No files in local folder</p>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Empty State */}
                  {node.children.length === 0 && connectedGalleries.length === 0 && !node.localFolderPath && (
                    <div className="text-center py-8">
                      <Folder size={32} className="text-zinc-600 mx-auto mb-2" />
                      <p className="text-zinc-500 text-sm">No connected files or subfolders</p>
                      <p className="text-zinc-600 text-xs mt-1">
                        Click + to add subfolders or drag galleries from sidebar
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Actions */}
                <div className="p-4 border-t border-white/10 space-y-2">
                  <button
                    onClick={handleNavigateToFolder}
                    className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <FileVideo size={16} />
                    View Contents
                  </button>
                  
                  {/* Refresh Connection Button - only show if folder has local storage */}
                  {node.localFolderPath && (
                    <>
                      <button
                        onClick={() => handleRefreshConnection(node.id)}
                        disabled={isRefreshing}
                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        {isRefreshing ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Scanning...
                          </>
                        ) : (
                          <>
                            <RefreshCw size={16} />
                            Refresh Connection
                          </>
                        )}
                      </button>
                      
                      {/* Refresh Results */}
                      {refreshResult && (
                        <div className="p-2 rounded-lg bg-zinc-800/50 border border-white/10 text-xs">
                          {refreshResult.newFiles.length > 0 && (
                            <p className="text-emerald-400 mb-1">
                              +{refreshResult.newFiles.length} new file(s) added
                            </p>
                          )}
                          {refreshResult.removedFiles.length > 0 && (
                            <p className="text-red-400 mb-1">
                              -{refreshResult.removedFiles.length} file(s) removed
                            </p>
                          )}
                          {refreshResult.newFiles.length === 0 && refreshResult.removedFiles.length === 0 && (
                            <p className="text-zinc-400">No changes detected</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  
                  <button
                    onClick={() => {
                      setParentForNewNode(node.id);
                      setShowCreateModal(true);
                    }}
                    className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    Add Subfolder
                  </button>
                  <button
                    onClick={handleExitFocus}
                    className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Back to Overview
                  </button>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Stats overlay */}
        <div className="absolute bottom-4 left-4 z-50 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-400 flex items-center gap-3">
          <span>{nodes.size} folders • {Array.from(nodes.values()).reduce((acc: number, n: MindMapNode) => acc + n.videos.length, 0)} videos</span>
          <button
            onClick={() => {
              // Reset zoom and pan to default
              setPan({ x: 0, y: 0 });
              setScale(1);
              // Clear any focused node
              setFocusedNode(null);
            }}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
            title="Reset View"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={async () => {
              if (confirm('Delete all directory folders? This will permanently remove all folders from the database.')) {
                // Delete all folders from the database
                const allFolders = await getFolders();
                for (const folder of allFolders) {
                  await deleteFolder(folder.id);
                }
                // Clear local state
                setNodes(new Map());
                setConnections([]);
                setPan({ x: 0, y: 0 });
                setScale(1);
                setFocusedNode(null);
                // Refresh available folders
                setAvailableFolders([]);
              }
            }}
            className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors text-zinc-400 hover:text-red-400"
            title="Clear All Folders"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
