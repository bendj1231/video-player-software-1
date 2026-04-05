import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Folder, FolderOpen, FileVideo, Plus, Trash2, X, Edit2, Check, Move, Link2 } from 'lucide-react';
import { clsx } from 'clsx';
import { getFolders, getSubfolders, addFolder, deleteFolder, getVideosByFolder, Folder as FolderType, VideoZip } from '../lib/db';
import { createFolderInDirectory, getStoredDirectoryHandle, storeDirectoryHandle, requestLocalFolderAccess } from '../lib/fileSystem';

interface MindMapNode extends FolderType {
  x: number;
  y: number;
  children: MindMapNode[];
  videos: VideoZip[];
  isExpanded: boolean;
}

interface NodeConnection {
  from: string;
  to: string;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const LEVEL_SPACING = 150;  // Vertical spacing between levels
const SIBLING_SPACING = 220; // Horizontal spacing between siblings

export function MindMapView() {
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

    // Build hierarchical structure with top-down layout (org chart style)
    const buildTree = (parentId: string | null, level: number, startX: number, startY: number): MindMapNode[] => {
      const folders = allFolders.filter(f => f.parentId === parentId);
      const nodes: MindMapNode[] = [];

      // Calculate total width needed for this level
      const totalWidth = folders.length * SIBLING_SPACING;
      const startOffset = startX - totalWidth / 2 + SIBLING_SPACING / 2;

      folders.forEach((folder, index) => {
        // Horizontal layout for siblings
        const x = folders.length === 1 ? startX : startOffset + index * SIBLING_SPACING;
        // Vertical layout - children go below parents
        const y = parentId === null ? 80 : startY + LEVEL_SPACING;

        // Recursively build children positioned below this node
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

    // Start with root at center top
    const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 600;
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

  // Handle panning
  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
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
    if (!newFolderName.trim()) return;

    const newFolder: FolderType = {
      id: crypto.randomUUID(),
      name: newFolderName.trim(),
      createdAt: Date.now(),
      parentId: parentForNewNode,
      sourceType: 'local'
    };

    // Create local folder if parent has local storage
    if (parentForNewNode) {
      const parentNode = nodes.get(parentForNewNode);
      if (parentNode) {
        const parentHandle = await getStoredDirectoryHandle(parentForNewNode);
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
    const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 600;
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
      newNodes.set(newFolder.id, newNode);

      // If subfolder, update parent's children array
      if (parentForNewNode) {
        const parentNode = newNodes.get(parentForNewNode);
        if (parentNode) {
          const updatedParent: MindMapNode = {
            ...parentNode,
            children: [...parentNode.children, newNode]
          };
          newNodes.set(parentForNewNode, updatedParent);
        }
      }

      return newNodes;
    });

    updateConnections(new Map([...nodes, [newFolder.id, newNode]]));
    setShowCreateModal(false);
    setNewFolderName('');
    setParentForNewNode(null);
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

  // Toggle node expansion
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

  // Get node color based on type/content
  const getNodeColor = (node: MindMapNode) => {
    if (node.videos.length > 0) {
      return 'from-violet-600/30 to-purple-800/30 border-violet-500/40';
    }
    if (node.localFolderPath) {
      return 'from-emerald-600/30 to-teal-800/30 border-emerald-500/40';
    }
    return 'from-zinc-700/40 to-zinc-800/40 border-zinc-600/30';
  };

  // Get visible nodes (respect expansion)
  const getVisibleNodes = (): MindMapNode[] => {
    const visible: MindMapNode[] = [];
    const rootNodes = Array.from(nodes.values()).filter((n: MindMapNode) => !n.parentId);

    const addVisible = (node: MindMapNode) => {
      visible.push(node);
      if (node.isExpanded && node.children) {
        node.children.forEach(addVisible);
      }
    };

    rootNodes.forEach(addVisible);
    return visible;
  };

  const visibleNodes = getVisibleNodes();
  const visibleConnections = connections.filter(c => {
    const fromNode = nodes.get(c.from);
    return fromNode?.isExpanded;
  });

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
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
              <li>• Click + to add child folder</li>
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
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleContainerMouseDown}
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
                "absolute rounded-2xl border backdrop-blur-md cursor-move select-none",
                "bg-gradient-to-br shadow-lg",
                getNodeColor(node),
                selectedNode === node.id && "ring-2 ring-white/50 shadow-xl shadow-white/10"
              )}
              style={{
                left: node.x,
                top: node.y,
                width: NODE_WIDTH,
                minHeight: NODE_HEIGHT
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            >
              <div className="p-3">
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
                      onClick={(e) => { e.stopPropagation(); setParentForNewNode(node.id); setShowCreateModal(true); }}
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
              className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-96"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-white font-semibold text-lg mb-4">
                {parentForNewNode ? 'Create Subfolder' : 'Create Root Folder'}
              </h3>
              <p className="text-zinc-400 text-sm mb-4">
                {parentForNewNode
                  ? 'This will create a local folder on disk as well.'
                  : 'Select a parent directory to create this folder.'}
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
                  disabled={!newFolderName.trim()}
                  className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats overlay */}
      <div className="absolute bottom-4 left-4 z-50 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-400">
        {nodes.size} folders • {Array.from(nodes.values()).reduce((acc: number, n: MindMapNode) => acc + n.videos.length, 0)} videos
      </div>
    </div>
  );
}
