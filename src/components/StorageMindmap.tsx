import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Search, Film, Heart } from 'lucide-react';
import { listStorageFiles, storageUrl, openStoragePath, formatBytes, mkdirStorage, moveStoragePath, renameStoragePath, importViaPicker, StorageFileEntry } from '../lib/electronStorage';
import { Folder as FolderIcon } from 'lucide-react';
import { VideoOrThumb } from './VideoOrThumb';
import { getThumbnail, logRecentView } from '../lib/electronStorage';

// small thumb for search results — always via cached QuickLook, never the raw file
function SearchThumb({ f }: { f: StorageFileEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    getThumbnail(f.relPath).then(t => { if (!dead) setSrc(t || 'none'); });
    return () => { dead = true; };
  }, [f.relPath]);
  if (src === 'none' || src === null && false) return <Film size={16} className="text-violet-300" />;
  if (src) return <img src={src} alt="" className="w-full h-full object-cover" />;
  return <Film size={16} className="text-zinc-700" />;
}
import { ImageViewerModal } from './ImageViewerModal';

// ── Universe view, ported from Rome's Einstein "Big Bang" ─────────────
// Library = singularity. Top-level folders = solar systems on orbit rings.
// Click a folder → warp into that system (subfolders orbit as planets,
// files as moons around their parent). Double-click → open in Explorer.

interface SysNode {
  id: string;
  label: string;
  kind: 'core' | 'system' | 'planet' | 'moon' | 'file';
  x: number;      // % of canvas
  y: number;      // % of canvas
  r: number;      // dot radius px
  color: string;
  sub?: string;
  relPath?: string;
  orbitR?: number; // ring radius % (for ring rendering)
  parent?: string;
  media?: StorageFileEntry[]; // preview media inside a folder system
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const blurCls = (peek?: boolean) =>
  `blur-[35px] scale-125 saturate-0 brightness-75 ${peek ? 'group-hover:blur-none group-hover:scale-100 group-hover:saturate-100 group-hover:brightness-100 transition-all duration-300' : ''}`;

export function StorageMindmap({ onOpenFolder, onPlay, blurEnabled, peekEnabled, refreshTrigger }: {
  blurEnabled?: boolean;
  peekEnabled?: boolean;
  onOpenFolder: (relPath: string) => void;
  onPlay: (url: string, name: string, queue?: { url: string; name: string }[]) => void;
  refreshTrigger?: number;
}) {
  const [files, setFiles] = useState<StorageFileEntry[]>([]);
  const [systemPath, setSystemPath] = useState<string | null>(null); // null = universe view
  const [hover, setHover] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; relPath: string; label: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDrag = useRef<{ down: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [warping, setWarping] = useState(false);
  const [dropDir, setDropDir] = useState<string | null>(null); // folder being drag-targeted
  // 'auto' = media previews always expanded · 'hover' = pop out on hover
  const [previewMode, setPreviewMode] = useState<'auto' | 'hover'>(() =>
    (localStorage.getItem('mindmap.previewMode') as 'auto' | 'hover') || 'hover');
  const [gridOpen, setGridOpen] = useState(false); // full-screen contents grid for the current folder
  const [viewImage, setViewImage] = useState<number | null>(null); // index into fileKids photos
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [likes, setLikes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mindmap.likes') || '[]')); } catch { return new Set(); }
  });
  const [likesOnly, setLikesOnly] = useState(false);
  const toggleLike = (rel: string) => {
    setLikes(prev => {
      const n = new Set(prev);
      n.has(rel) ? n.delete(rel) : n.add(rel);
      localStorage.setItem('mindmap.likes', JSON.stringify([...n]));
      return n;
    });
  };
  const [recentDirs, setRecentDirs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mindmap.recentDirs') || '[]'); } catch { return []; }
  });
  const pushRecent = (dir: string) => {
    setRecentDirs(prev => {
      const next = [dir, ...prev.filter(d => d !== dir)].slice(0, 5);
      localStorage.setItem('mindmap.recentDirs', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => { setGridOpen(false); setSelectMode(false); setSelected(new Set()); setMoveMenu(null); }, [systemPath]);
  useEffect(() => { if (!gridOpen) { setSelectMode(false); setSelected(new Set()); setMoveMenu(null); } }, [gridOpen]);
  const nodeDrag = useRef<{ relPath: string; label: string; sx: number; sy: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const [newFolderAt, setNewFolderAt] = useState<{ x: number; y: number } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [canvasCtx, setCanvasCtx] = useState<{ x: number; y: number } | null>(null); // right-click on empty space
  const [renameTarget, setRenameTarget] = useState<{ relPath: string; label: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const clickTimer = useRef<number>(0);      // single vs double click disambiguation
  const lastDragEnd = useRef<number>(0);     // suppress click right after a node drag

  useEffect(() => { listStorageFiles().then(setFiles); }, [refreshTrigger]);

  // Clear the drop highlight when the drag ends anywhere (App handles the import)
  useEffect(() => {
    const clear = () => setDropDir(null);
    window.addEventListener('drop', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragend', clear);
    };
  }, []);

  // stable starfield
  const stars = useMemo(() =>
    Array.from({ length: 160 }, (_, i) => ({
      x: (hash('sx' + i) % 1000) / 10,
      y: (hash('sy' + i) % 1000) / 10,
      r: ((hash('sr' + i) % 3) + 1) / 2,
      o: 0.25 + ((hash('so' + i) % 60) / 100),
    })), []);

  const directChildren = (dir: string | null, kind: 'folder' | 'file') => {
    return files.filter(f => {
      const isFolder = f.kind === 'folder';
      if (kind === 'folder' ? !isFolder : isFolder) return false;
      const parent = f.relPath.includes('/') ? f.relPath.split('/').slice(0, -1).join('/') : null;
      return parent === dir;
    });
  };

  const { nodes, rings, fileKids } = useMemo(() => {
    const nodes: SysNode[] = [];
    const rings: { cx: number; cy: number; r: number; id: string }[] = [];
    let fileKids: StorageFileEntry[] = [];
    const CX = 50, CY = 50;

    const countInside = (dir: string) =>
      files.filter(f => f.kind !== 'folder' && f.relPath.startsWith(dir + '/')).length;

    // preview media inside a folder (interleave videos/photos)
    const mediaIn = (dir: string) => {
      const inside = files.filter(x => (x.kind === 'video' || x.kind === 'photo') && x.relPath.startsWith(dir + '/'));
      const vids = inside.filter(x => x.kind === 'video');
      const pics = inside.filter(x => x.kind === 'photo');
      const mixed: typeof inside = [];
      let vi = 0, pi = 0;
      while (vi < vids.length || pi < pics.length) {
        for (let k = 0; k < 2 && vi < vids.length; k++) mixed.push(vids[vi++]);
        for (let k = 0; k < 2 && pi < pics.length; k++) mixed.push(pics[pi++]);
      }
      return mixed;
    };

    if (systemPath === null) {
      // ── UNIVERSE: no center sun — folders drift until one is promoted ──
      const systems = (directChildren(null, 'folder') as StorageFileEntry[])
        .map(f => ({ f, mass: countInside(f.relPath) }))
        .sort((a, b) => b.mass - a.mass); // heaviest first → sinks to center

      // Gravity well: heaviest body sits at center; the rest cluster around it
      // on a golden-angle spiral that tightens near the core.
      systems.forEach(({ f, mass }, i) => {
        const h = hash(f.relPath);
        let x: number, y: number, r: number;
        if (i === 0) {
          x = CX; y = CY; r = 22;
        } else {
          const a = i * 2.39996 + (h % 360) * 0.002; // golden angle
          const rad = 12 + Math.min(26, i * 5) + (h % 40) / 10;
          x = CX + rad * Math.cos(a);
          y = CY + rad * Math.sin(a) * 0.9;
          r = 12 + Math.min(8, Math.round(mass / 15));
        }
        nodes.push({
          id: `sys:${f.relPath}`, label: f.name, kind: 'system',
          x, y, r, color: '#fbbf24', sub: `${mass} items`,
          relPath: f.relPath, media: mediaIn(f.relPath),
        });
      });

      // loose root files drift as outer dust
      const loose = directChildren(null, 'file') as StorageFileEntry[];
      loose.forEach((f) => {
        const h = hash(f.relPath + 'd');
        nodes.push({
          id: `dust:${f.relPath}`, label: f.name, kind: 'file',
          x: 10 + (h % 80), y: 14 + ((h >> 8) % 72),
          r: 4, color: f.kind === 'video' ? '#60a5fa' : '#34d399',
          relPath: f.relPath,
        });
      });
    } else {
      // ── SYSTEM VIEW: folder nucleus, subfolders as planets, files as moons ──
      const name = systemPath.split('/').pop() || systemPath;
      const inside = countInside(systemPath);
      nodes.push({ id: 'core', label: name, kind: 'core', x: CX, y: CY, r: 26, color: '#f59e0b', sub: `${inside} items`, relPath: systemPath, media: mediaIn(systemPath) });

      const subs = directChildren(systemPath, 'folder') as StorageFileEntry[];
      subs.forEach((f, i) => {
        const a = (2 * Math.PI * i) / Math.max(1, subs.length) - Math.PI / 2;
        const R = 26;
        nodes.push({
          id: `planet:${f.relPath}`, label: f.name, kind: 'planet',
          x: CX + R * Math.cos(a), y: CY + R * Math.sin(a),
          r: 13, color: '#a78bfa', sub: `${countInside(f.relPath)}`,
          relPath: f.relPath, parent: 'core', media: mediaIn(f.relPath),
        });
      });
      

      // all-in-one contents grid: every file inside this folder, recursively
      fileKids = files.filter(f => f.kind !== 'folder' && f.relPath.startsWith(systemPath + '/'));
    }
    return { nodes, rings, fileKids };
  }, [files, systemPath]);

  const warp = (relPath: string) => {
    setWarping(true);
    setTimeout(() => { setSystemPath(relPath); setWarping(false); }, 220);
  };

  // Fly into a folder: zoom the camera onto it, then enter its system
  const flying = useRef(false);
  const flyTo = (n: SysNode) => {
    if (flying.current || !n.relPath) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) { warp(n.relPath); return; }
    flying.current = true;
    const Z = 3.2;
    const px = (n.x / 100) * rect.width;
    const py = (n.y / 100) * rect.height;
    // transform = translate(pan) scale(Z) about center → pan puts node at center
    setPan({ x: (rect.width / 2 - px) * Z, y: (rect.height / 2 - py) * Z });
    setZoom(Z);
    setTimeout(() => {
      setSystemPath(n.relPath!);
      setPan({ x: 0, y: 0 });
      setZoom(1);
      flying.current = false;
    }, 520);
  };

  const parentOf = (p: string) => p.includes('/') ? p.split('/').slice(0, -1).join('/') : null;

  const breadcrumb = systemPath ? systemPath.split('/') : [];

  return (
    <div
      className="w-full min-h-screen relative overflow-hidden select-none"
      onClick={() => { setCtxMenu(null); setCanvasCtx(null); }}
      style={{ background: '#000' }}
    >
      {/* starfield */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {stars.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o * 0.35} />
        ))}
      </svg>

      {/* header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 p-5">
        {systemPath !== null && (
          <button
            onClick={() => setSystemPath(parentOf(systemPath))}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-zinc-200 transition-colors"
          >
            <ArrowLeft size={14} /> {parentOf(systemPath) ? parentOf(systemPath)!.split('/').pop() : 'Universe'}
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            {systemPath === null ? 'UNIVERSE' : breadcrumb.join(' / ')}
          </h1>
          <p className="text-[10px] uppercase tracking-[3px] text-white/40 mt-0.5">
            {systemPath === null ? 'media galaxy · click or scroll in on a folder to fly into it · right-click space for new folder' : 'system view · click the sun for its contents · scroll out to leave · right-click space for new folder'}
          </p>
        </div>
        {/* search across the whole storage universe */}
        <div className="relative ml-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
            <Search size={13} className="text-zinc-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setSearch(''); } }}
              placeholder="Search universe…"
              className="bg-transparent outline-none text-sm text-white placeholder-zinc-500 w-36"
            />
          </div>
          {searchOpen && search.trim() && (() => {
            const q = search.trim().toLowerCase();
            const hits = files.filter(f => f.name.toLowerCase().includes(q)).slice(0, 14);
            const go = (f: StorageFileEntry) => {
              setSearchOpen(false); setSearch('');
              const target = f.kind === 'folder' ? f.relPath : f.relPath.split('/').slice(0, -1).join('/');
              if (!target) { setSystemPath(null); return; }
              setSystemPath(target);
              if (f.kind !== 'folder') setGridOpen(true); // land on the contents grid for files
            };
            return (
              <div className="absolute right-0 top-full mt-2 w-72 max-h-[60vh] overflow-y-auto rounded-xl border border-white/15 bg-zinc-900/95 backdrop-blur-md shadow-2xl z-[80]">
                {hits.length === 0 && <p className="px-3 py-3 text-xs text-zinc-600">No matches</p>}
                {hits.map(f => (
                  <button
                    key={f.relPath}
                    onClick={() => go(f)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="w-14 h-10 rounded overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                      {f.kind === 'folder' ? (
                        <FolderIcon size={16} className="text-amber-300" />
                      ) : (
                        <SearchThumb f={f} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-white truncate">{f.name}</p>
                      <p className="text-[9px] text-zinc-500 truncate">{f.kind === 'folder' ? 'folder' : f.relPath}</p>
                    </div>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const next = previewMode === 'auto' ? 'hover' : 'auto';
            setPreviewMode(next);
            localStorage.setItem('mindmap.previewMode', next);
          }}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-[10px] uppercase tracking-widest text-zinc-300 transition-colors"
          title="Media previews: auto (always expanded) or hover"
        >
          Previews: {previewMode === 'auto' ? 'Auto' : 'Hover'}
        </button>
      </div>

      {/* universe canvas */}
      <style>{`
        @keyframes gravFloat {
          0%, 100% { transform: translate(0px, 0px); }
          33% { transform: translate(var(--fx, 4px), var(--fy, -5px)); }
          66% { transform: translate(calc(var(--fx, 4px) * -0.6), calc(var(--fy, -5px) * -1)); }
        }
      `}</style>
      <div
        ref={canvasRef}
        {...(systemPath ? { 'data-dropdir': systemPath } : {})}
        className="absolute inset-0 transition-opacity duration-200"
        style={{
          opacity: warping || gridOpen ? 0 : 1,
          pointerEvents: gridOpen ? 'none' : 'auto',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '50% 50%',
          transition: 'opacity .2s, transform .55s cubic-bezier(.22,.75,.25,1)',
        }}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          const next = Math.min(4, Math.max(0.35, zoom * factor));
          setZoom(next);
          // dive in: keep zooming toward a folder → fly into its universe
          if (e.deltaY < 0 && next >= 2.4 && !flying.current) {
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dropdir]');
            const rel = el?.getAttribute('data-dropdir');
            if (rel && rel === systemPath && fileKids.length > 0) {
              // zooming into the sun → open its contents grid
              setGridOpen(true);
              setZoom(1);
              setPan({ x: 0, y: 0 });
            } else if (rel && rel !== systemPath) {
              const target = nodes.find(nd => nd.relPath === rel);
              if (target) flyTo(target);
            }
          }
          // zoom all the way out → fly back up to the parent universe
          if (e.deltaY > 0 && next <= 0.36 && systemPath !== null && !flying.current) {
            flying.current = true;
            const parent = parentOf(systemPath);
            setTimeout(() => {
              setSystemPath(parent);
              setPan({ x: 0, y: 0 });
              setZoom(1);
              flying.current = false;
            }, 300);
          }
        }}
        onPointerDown={(e) => {
          // pan only when grabbing empty space (not nodes/cards/menus)
          if ((e.target as HTMLElement).closest('[data-node]')) return;
          panDrag.current = { down: true, sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
        }}
        onPointerMove={(e) => {
          // dragging a folder node → ghost follows cursor, highlight drop target
          const nd = nodeDrag.current;
          if (nd) {
            const dx = e.clientX - nd.sx, dy = e.clientY - nd.sy;
            if (!nd.moved && Math.hypot(dx, dy) < 6) return;
            nd.moved = true;
            setGhost({ label: nd.label, x: e.clientX, y: e.clientY });
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dropdir]');
            const t = el?.getAttribute('data-dropdir') || null;
            setDropDir(t && t !== nd.relPath ? t : null);
            return;
          }
          const d = panDrag.current;
          if (!d?.down) return;
          setPan({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy });
        }}
        onPointerUp={(e) => {
          const nd = nodeDrag.current;
          if (nd) {
            nodeDrag.current = null;
            setGhost(null);
            setDropDir(null);
            if (nd.moved) {
              lastDragEnd.current = Date.now();
              const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dropdir]');
              const target = el?.getAttribute('data-dropdir') || null;
              if (target && target !== nd.relPath) {
                moveStoragePath(nd.relPath, target).then((r) => {
                  if (!r?.success) alert(r?.error || 'Move failed');
                  listStorageFiles().then(setFiles);
                });
              }
            }
            return;
          }
          if (panDrag.current) panDrag.current.down = false;
        }}
        onContextMenu={(e) => {
          // right-click on empty canvas → folder creation menu
          if ((e.target as HTMLElement).closest('[data-node]')) return; // nodes have their own menu
          e.preventDefault();
          setCanvasCtx({ x: e.clientX, y: e.clientY });
        }}
      >

        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer text-center z-10"
            data-node="1"
            {...(n.kind === 'core'
              ? { 'data-dropdir': systemPath }
              : (n.kind === 'system' || n.kind === 'planet')
                ? { 'data-dropdir': n.relPath }
                : {})}
            style={{
              left: `${n.x}%`, top: `${n.y}%`,
              transition: 'left .7s cubic-bezier(.16,.84,.3,1), top .7s cubic-bezier(.16,.84,.3,1)',
              outline: dropDir && (n.kind === 'core' ? dropDir === systemPath : dropDir === n.relPath)
                ? '2px dashed #34d399' : 'none',
              outlineOffset: 10,
              borderRadius: 16,
            }}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onPointerDown={(e) => {
              if (e.button === 0 && (n.kind === 'system' || n.kind === 'planet')) {
                nodeDrag.current = { relPath: n.relPath!, label: n.label, sx: e.clientX, sy: e.clientY, moved: false };
              }
            }}
            onDragOver={() => {
              if (n.kind === 'system' || n.kind === 'planet' || n.kind === 'core') {
                setDropDir(n.kind === 'core' ? systemPath : n.relPath!);
              }
            }}
            onDragLeave={() => setDropDir(null)}
            onClick={() => {
              if (n.kind === 'moon' || n.kind === 'file') {
                const f = files.find(x => x.relPath === n.relPath);
                if (f?.kind === 'video') onPlay(`media://local/${n.relPath!.split('/').map(encodeURIComponent).join('/')}`, n.label);
                else if (f) openStoragePath(n.relPath!);
              } else if (n.kind === 'core') {
                // click the sun → open its contents grid
                if (fileKids.length > 0) setGridOpen(true);
              } else if (n.kind === 'system' || n.kind === 'planet') {
                // ignore the click that lands right after a drag
                if (Date.now() - lastDragEnd.current < 300) return;
                // single click zooms into the system; delay so double-click can cancel
                window.clearTimeout(clickTimer.current);
                clickTimer.current = window.setTimeout(() => flyTo(n), 260);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (n.kind === 'system' || n.kind === 'planet') {
                setCtxMenu({ x: e.clientX, y: e.clientY, relPath: n.relPath!, label: n.label });
              }
            }}
            onDoubleClick={() => {
              if (n.kind === 'system' || n.kind === 'planet') {
                window.clearTimeout(clickTimer.current);
                onOpenFolder(n.relPath!);
              }
            }}
          >
            <div style={{
              animation: `gravFloat ${7 + (hash(n.id) % 6)}s ease-in-out ${(hash(n.id) % 40) / 10}s infinite`,
              ['--fx' as any]: `${2 + (hash(n.id) % 5)}px`,
              ['--fy' as any]: `${3 + (hash(n.id) % 6)}px`,
            }}>
            {(n.kind === 'system' || n.kind === 'core' || n.kind === 'planet') ? (
              <FolderStar
                node={n}
                hovered={hover === n.id}
                onPlay={onPlay}
                blurEnabled={blurEnabled}
                alwaysShow={previewMode === 'auto'}
                size={n.kind === 'core' ? 150 : n.kind === 'planet' ? 72 : 120}
                accent={n.kind === 'planet' ? '#a78bfa' : '#fbbf24'}
                compact={n.kind === 'planet'}
              />
            ) : (
            <>
            <div
              className="rounded-full mx-auto"
              style={{
                width: n.r * 2,
                height: n.r * 2,
                background: n.kind === 'core'
                  ? `radial-gradient(circle, #fff 0%, #ffe9c4 30%, ${n.color} 65%, transparent 100%)`
                  : n.color,
                boxShadow: `0 0 ${n.r}px ${n.color}, 0 0 ${n.r * 3}px ${n.color}66, 0 0 ${n.r * 6}px ${n.color}33`,
                transform: hover === n.id ? 'scale(1.3)' : 'scale(1)',
                transition: 'transform .15s, box-shadow .15s',
              }}
            />
            <p
              className="mt-1.5 font-semibold whitespace-nowrap"
              style={{
                fontSize: n.kind === 'core' ? 13 : n.kind === 'system' ? 11 : 9,
                color: n.kind === 'core' ? '#fff' : n.kind === 'system' ? '#fde68a' : n.kind === 'planet' ? '#ddd6fe' : 'rgba(255,255,255,0.6)',
                textShadow: '0 1px 6px #000',
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: n.kind === 'core' ? 3 : 0.5,
              }}
            >
              {n.label}
            </p>
            {n.sub && (
              <p className="text-[8px] text-white/35 whitespace-nowrap" style={{ textShadow: '0 1px 6px #000' }}>{n.sub}</p>
            )}
            </>
            )}
            </div>
          </div>
        ))}
      </div>

      {/* contents view — full-screen gallery grid of the folder's files */}
      {gridOpen && fileKids.length > 0 && (
        <div
          data-dropdir={systemPath}
          className="absolute inset-x-0 top-0 bottom-0 z-40 px-10 pb-8 pt-24 overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
          onWheel={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {/* floating back CTA — always above the grid */}
          <div className="sticky top-0 z-50 flex items-center gap-3 mb-5 -mx-2 px-2 py-2 bg-black/70 backdrop-blur-md rounded-xl w-fit">
            <button
              onClick={() => setGridOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-zinc-200 transition-colors"
            >
              <ArrowLeft size={14} /> {systemPath!.split('/').pop()}
            </button>
            <p className="text-[10px] uppercase tracking-[3px] text-white/40">
              {fileKids.length} items
            </p>
            <button
              onClick={() => setLikesOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${likesOnly ? 'bg-rose-500/30 text-rose-200' : 'bg-white/10 hover:bg-white/15 text-zinc-200'}`}
              title="Show only liked"
            >
              <Heart size={13} fill={likesOnly ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => { setSelectMode(m => !m); setSelected(new Set()); setMoveMenu(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${selectMode ? 'bg-amber-500/25 text-amber-200' : 'bg-white/10 hover:bg-white/15 text-zinc-200'}`}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
            {selectMode && selected.size > 0 && (
              <>
                <button
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMoveMenu(m => m ? null : { x: r.left, y: r.bottom + 6 });
                  }}
                  className="px-3 py-1.5 bg-violet-500/25 hover:bg-violet-500/35 text-violet-200 rounded-lg text-sm transition-colors"
                >
                  Move {selected.size} →
                </button>
                <button
                  onClick={() => { setNewFolderName(''); setNewFolderAt({ x: window.innerWidth / 2, y: 200 }); }}
                  className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 rounded-lg text-sm transition-colors"
                >
                  + Folder
                </button>
              </>
            )}
          </div>
          {/* move-to dropdown: subfolders of this folder */}
          {moveMenu && (
            <div
              className="fixed z-[70] min-w-[220px] rounded-xl border border-white/15 bg-zinc-900/95 backdrop-blur-md shadow-2xl overflow-hidden"
              style={{ left: moveMenu.x, top: moveMenu.y }}
            >
              <p className="px-3 py-2 text-[9px] uppercase tracking-[2px] text-zinc-500">Move into…</p>
              {recentDirs.map(rel => {
                const exists = files.some(f => f.relPath === rel && f.kind === 'folder');
                if (!exists) return null;
                return (
                  <button
                    key={`recent:${rel}`}
                    className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 transition-colors flex items-center gap-2"
                    onClick={async () => {
                      for (const r of selected) await moveStoragePath(r, rel);
                      pushRecent(rel);
                      setMoveMenu(null); setSelected(new Set()); setSelectMode(false);
                      listStorageFiles().then(setFiles);
                    }}
                  >
                    <FolderIcon size={14} className="text-amber-300" />
                    {rel.split('/').pop()}
                    <span className="text-[9px] text-zinc-600 truncate ml-auto max-w-[100px]">{rel}</span>
                  </button>
                );
              })}
              {recentDirs.length > 0 && <div className="border-t border-white/10 my-1" />}
              <p className="px-3 py-1.5 text-[9px] uppercase tracking-[2px] text-zinc-600">Universe</p>
              <div className="max-h-[40vh] overflow-y-auto">
                {files.filter(d => d.kind === 'folder').map(d => (
                  <button
                    key={d.relPath}
                    className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 transition-colors flex items-center gap-2"
                    onClick={async () => {
                      for (const rel of selected) await moveStoragePath(rel, d.relPath);
                      pushRecent(d.relPath);
                      setMoveMenu(null); setSelected(new Set()); setSelectMode(false);
                      listStorageFiles().then(setFiles);
                    }}
                  >
                    <FolderIcon size={14} className="text-violet-300" /> {d.name}
                    {d.relPath.includes('/') && (
                      <span className="text-[9px] text-zinc-600 truncate ml-auto max-w-[110px]">{d.relPath}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* masonry — Pinterest-style flowing columns, natural aspect ratios */}
          <div style={{ columns: '220px', columnGap: 4 }}>
            {fileKids.filter(f => !likesOnly || likes.has(f.relPath)).map((f) => (
              <button
                key={f.relPath}
                className={`group relative block w-full text-left mb-1 break-inside-avoid ${selectMode && selected.has(f.relPath) ? 'ring-2 ring-amber-400' : ''}`}
                title={f.name}
                onClick={() => {
                  if (selectMode) {
                    setSelected(s => { const n = new Set(s); n.has(f.relPath) ? n.delete(f.relPath) : n.add(f.relPath); return n; });
                    return;
                  }
                  if (f.kind === 'video') {
                    const vids = fileKids.filter(x => x.kind === 'video').map(x => ({ url: `media://local/${x.relPath.split('/').map(encodeURIComponent).join('/')}`, name: x.name }));
                    onPlay(`media://local/${f.relPath.split('/').map(encodeURIComponent).join('/')}`, f.name, vids);
                  } else {
                    // open the in-app image viewer (index within photos only)
                    const photos = fileKids.filter(x => x.kind === 'photo');
                    setViewImage(photos.indexOf(f));
                    logRecentView({ relPath: f.relPath, name: f.name, kind: 'photo' });
                  }
                }}
              >
                <div className="overflow-hidden bg-zinc-900 group-hover:ring-1 group-hover:ring-amber-400/60 transition-shadow">
                  {f.kind === 'video' ? (
                    <VideoOrThumb relPath={f.relPath} className={`w-full object-cover ${blurEnabled ? blurCls(peekEnabled) : ''}`} />
                  ) : (
                    <img src={storageUrl(f.relPath)} alt="" draggable={false} loading="lazy" className={`w-full object-cover ${blurEnabled ? blurCls(peekEnabled) : ''}`} />
                  )}
                </div>
                {!selectMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLike(f.relPath); }}
                    className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-all ${likes.has(f.relPath) ? 'bg-rose-500/80 text-white opacity-100' : 'bg-black/50 text-white/70 opacity-0 group-hover:opacity-100 hover:bg-black/70'}`}
                    title={likes.has(f.relPath) ? 'Unlike' : 'Like'}
                  >
                    <Heart size={13} fill={likes.has(f.relPath) ? 'currentColor' : 'none'} />
                  </button>
                )}
                {selectMode && (
                  <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${selected.has(f.relPath) ? 'bg-amber-400 border-amber-400 text-black' : 'border-white/60 bg-black/40'}`}>
                    {selected.has(f.relPath) ? '✓' : ''}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(() => {
                    const inner = f.relPath.slice(systemPath!.length + 1);
                    const dir = inner.includes('/') ? inner.split('/').slice(0, -1).join('/') : '';
                    return dir ? <p className="text-[8px] uppercase tracking-widest text-amber-300/80 truncate">{dir}</p> : null;
                  })()}
                  <p className="text-[10px] text-white truncate">{f.name}</p>
                  <p className="text-[9px] text-white/50">{formatBytes(f.size)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* drag ghost — follows cursor while dragging a folder node */}
      {ghost && (
        <div
          className="fixed z-[60] pointer-events-none flex items-center gap-2 px-3 py-2 bg-zinc-800/95 border border-amber-400/50 rounded-xl shadow-2xl"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          <FolderIcon size={14} className="text-amber-300" />
          <span className="text-xs text-white font-medium whitespace-nowrap">{ghost.label}</span>
          {dropDir && (
            <span className="text-[10px] text-emerald-300 whitespace-nowrap">→ {dropDir.split('/').pop()}</span>
          )}
        </div>
      )}

      {/* click empty space → create a new folder in the current system */}
      {newFolderAt && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setNewFolderAt(null)}
        >
          <div
            className="bg-zinc-900 border border-white/15 rounded-2xl p-5 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-semibold mb-1">New Folder</p>
            <p className="text-[11px] text-zinc-500 mb-3">
              in {systemPath ? systemPath.split('/').pop() : 'Universe'}
            </p>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  const newDir = await mkdirStorage(newFolderName.trim(), systemPath || undefined);
                  if (newDir) {
                    pushRecent(newDir);
                    if (selected.size) {
                      for (const rel of selected) await moveStoragePath(rel, newDir);
                      setSelected(new Set()); setSelectMode(false);
                    }
                  }
                  setNewFolderAt(null);
                  listStorageFiles().then(setFiles);
                } else if (e.key === 'Escape') {
                  setNewFolderAt(null);
                }
              }}
              placeholder="Folder name"
              className="w-full px-3 py-2 bg-zinc-800 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400/50 mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setNewFolderAt(null)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newFolderName.trim()) return;
                  const newDir = await mkdirStorage(newFolderName.trim(), systemPath || undefined);
                  if (newDir) {
                    pushRecent(newDir);
                    if (selected.size) {
                      for (const rel of selected) await moveStoragePath(rel, newDir);
                      setSelected(new Set()); setSelectMode(false);
                    }
                  }
                  setNewFolderAt(null);
                  listStorageFiles().then(setFiles);
                }}
                className="px-4 py-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click on empty canvas — create folder / import */}
      {canvasCtx && (
        <div
          className="fixed z-50 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl overflow-hidden"
          style={{ left: canvasCtx.x, top: canvasCtx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {systemPath ? `in ${systemPath.split('/').pop()}` : 'Universe'}
          </p>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-amber-300 hover:bg-white/10 transition-colors"
            onClick={() => {
              setCanvasCtx(null);
              setNewFolderName('');
              setNewFolderAt({ x: canvasCtx.x, y: canvasCtx.y });
            }}
          >
            <FolderIcon size={15} />
            New Folder
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10 transition-colors"
            onClick={async () => {
              setCanvasCtx(null);
              const r = await importViaPicker();
              if (r) listStorageFiles().then(setFiles);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
            Import Folders / Files…
          </button>
        </div>
      )}

      {/* rename dialog */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-zinc-900 border border-white/15 rounded-2xl p-5 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-semibold mb-1">Rename Folder</p>
            <p className="text-[11px] text-zinc-500 mb-3 truncate">{renameTarget.label}</p>
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && renameName.trim()) {
                  const r = await renameStoragePath(renameTarget.relPath, renameName.trim());
                  if (!r?.success) alert(r?.error || 'Rename failed');
                  setRenameTarget(null);
                  listStorageFiles().then(setFiles);
                } else if (e.key === 'Escape') {
                  setRenameTarget(null);
                }
              }}
              placeholder="Folder name"
              className="w-full px-3 py-2 bg-zinc-800 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-400/50 mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!renameName.trim()) return;
                  const r = await renameStoragePath(renameTarget.relPath, renameName.trim());
                  if (!r?.success) alert(r?.error || 'Rename failed');
                  setRenameTarget(null);
                  listStorageFiles().then(setFiles);
                }}
                className="px-4 py-1.5 text-sm bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* in-app image viewer */}
      {viewImage !== null && (() => {
        const photos = fileKids.filter(x => x.kind === 'photo');
        const f = photos[viewImage];
        if (!f) { setViewImage(null); return null; }
        return (
          <ImageViewerModal
            url={storageUrl(f.relPath)}
            name={f.name}
            onClose={() => setViewImage(null)}
            onNext={() => setViewImage(i => Math.min(photos.length - 1, (i ?? 0) + 1))}
            onPrevious={() => setViewImage(i => Math.max(0, (i ?? 0) - 1))}
            hasNext={viewImage < photos.length - 1}
            hasPrevious={viewImage > 0}
          />
        );
      })()}

      {/* Right-click context menu — promote a folder into a sun */}
      {ctxMenu && (
        <div
          className="fixed z-50 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl overflow-hidden"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500 truncate">{ctxMenu.label}</p>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-amber-300 hover:bg-white/10 transition-colors"
            onClick={() => { const p = ctxMenu.relPath; setCtxMenu(null); warp(p); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" strokeWidth="1.6"><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><line x1="4.2" y1="4.2" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.8" y2="19.8"/><line x1="4.2" y1="19.8" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.8" y2="4.2"/></g></svg>
            Promote to Sun
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10 transition-colors"
            onClick={() => { onOpenFolder(ctxMenu.relPath); setCtxMenu(null); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
            Open in Explorer
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10 transition-colors"
            onClick={() => {
              setRenameTarget({ relPath: ctxMenu.relPath, label: ctxMenu.label });
              setRenameName(ctxMenu.label);
              setCtxMenu(null);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
            Rename
          </button>
        </div>
      )}
    </div>
  );
}


// ── FolderStar: folder body + infinite media carousel on hover ────────
// Vertical cards autoplay, auto-scroll right→left, materialize at the
// right edge and dematerialize at the left. Draggable/scrollable; click opens.
function FolderStar({ node, hovered, onPlay, blurEnabled, alwaysShow, size = 120, accent = '#fbbf24', compact }: {
  node: SysNode;
  hovered: boolean;
  onPlay: (url: string, name: string, queue?: { url: string; name: string }[]) => void;
  blurEnabled?: boolean;
  alwaysShow?: boolean;
  size?: number;
  accent?: string;
  compact?: boolean;
}) {
  const open = hovered || !!alwaysShow;
  const media = node.media || [];
  const CARD_W = compact ? 52 : 68, CARD_H = compact ? 74 : 96, GAP = 10;
  const STRIP_W = compact ? 260 : 360;
  const total = media.length * (CARD_W + GAP);

  const [scroll, setScroll] = useState(0);
  const dragRef = useRef<{ down: boolean; startX: number; startScroll: number; moved: boolean }>({
    down: false, startX: 0, startScroll: 0, moved: false,
  });
  const rafRef = useRef<number>(0);
  const scrollRef = useRef(0);
  scrollRef.current = scroll;

  // reset to the carousel start every time the folder is hovered
  useEffect(() => {
    if (open) setScroll(0);
  }, [open]);

  // continuous right→left scroll while hovered and not dragging
  useEffect(() => {
    if (!open || total === 0) return;
    let last = performance.now();
    const step = (t: number) => {
      const dt = t - last; last = t;
      if (!dragRef.current.down) {
        setScroll(s => (s + dt * 0.045) % Math.max(1, total));
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, total]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { down: true, startX: e.clientX, startScroll: scrollRef.current, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.down) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    setScroll(d.startScroll - dx);
  };
  const onPointerUp = () => { dragRef.current.down = false; };
  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    setScroll(s => s + (e.deltaX || e.deltaY));
  };

  const openFile = (f: StorageFileEntry) => {
    if (dragRef.current.moved) return;
    if (f.kind === 'video') {
      onPlay(`media://local/${f.relPath.split('/').map(encodeURIComponent).join('/')}`, f.name);
    } else {
      openStoragePath(f.relPath);
    }
  };

  // materialize/dematerialize: opacity+scale ramps at strip edges
  const edgeFade = (x: number) => {
    const half = STRIP_W / 2;
    const dist = half - Math.abs(x);            // 0 at edge
    const t = Math.min(1, dist / 70);
    return t;
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* carousel strip — pops out above the folder on hover */}
      <div
        className="absolute left-1/2"
        style={{
          bottom: '62%',
          width: STRIP_W,
          height: CARD_H + 14,
          transform: `translateX(-50%) scaleY(${open ? 1 : 0.2})`,
          transformOrigin: 'bottom center',
          opacity: open ? 1 : 0,
          transition: 'transform .35s cubic-bezier(.16,.84,.3,1), opacity .25s',
          pointerEvents: open ? 'auto' : 'none',
          overflow: 'hidden',
          cursor: 'grab',
          touchAction: 'none',
          maskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
          zIndex: 40,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {total > 0 && open && media.map((f, i) => {
          const raw = (i * (CARD_W + GAP) - scroll) % total;
          const wrapped = ((raw % total) + total) % total;
          const x = wrapped - STRIP_W / 2;
          const t = edgeFade(x);
          if (x + CARD_W < -STRIP_W / 2 - 8 || x > STRIP_W / 2 + 8) return null;
          return (
            <div
              key={f.relPath}
              className="absolute top-0 rounded-lg overflow-hidden border border-white/25 bg-zinc-900 shadow-2xl"
              style={{
                left: STRIP_W / 2 + x,
                width: CARD_W,
                height: CARD_H,
                opacity: t,
                transform: `scale(${0.6 + t * 0.4}) translateY(${(1 - t) * 10}px)`,
                transition: dragRef.current.down ? 'none' : 'transform .18s ease-out',
                pointerEvents: 'auto',
              }}
              onClick={() => openFile(f)}
              title={f.name}
            >
              {f.kind === 'video' ? (
                <VideoOrThumb relPath={f.relPath} className={`w-full h-full object-cover pointer-events-none ${blurEnabled ? blurCls() : ''}`} />
              ) : (
                <img src={storageUrl(f.relPath)} alt="" draggable={false} loading="lazy" className={`w-full h-full object-cover pointer-events-none ${blurEnabled ? blurCls() : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* the folder body */}
      <div
        className="absolute inset-0 flex items-center justify-center rounded-2xl"
        style={{
          background: 'linear-gradient(145deg, #2a2410 0%, #161206 100%)',
          border: `1px solid ${accent}66`,
          boxShadow: hovered
            ? `0 0 34px ${accent}80, 0 0 90px ${accent}38, inset 0 0 20px ${accent}1a`
            : `0 0 26px ${accent}59, 0 0 70px ${accent}26, inset 0 0 20px ${accent}14`,
          transform: hovered ? 'scale(1.12)' : 'scale(1)',
          transition: 'transform .2s, box-shadow .25s',
          zIndex: 20,
        }}
      >
        <FolderIcon size={Math.round(size * 0.37)} style={{ color: accent }} strokeWidth={1.4} />
      </div>

      {/* folder name + item count below the icon */}
      <p
        className="absolute left-1/2 whitespace-nowrap font-semibold"
        style={{
          top: 'calc(100% + 8px)',
          transform: 'translateX(-50%)',
          fontSize: compact ? 9 : 11,
          color: compact ? '#ddd6fe' : '#fde68a',
          textShadow: '0 1px 6px #000',
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          zIndex: 20,
        }}
      >
        {node.label}
      </p>
      {node.sub && (
        <p
          className="absolute left-1/2 whitespace-nowrap"
          style={{
            top: 'calc(100% + 22px)',
            transform: 'translateX(-50%)',
            fontSize: 8,
            color: 'rgba(255,255,255,0.35)',
            textShadow: '0 1px 6px #000',
            zIndex: 20,
          }}
        >
          {node.sub}
        </p>
      )}
    </div>
  );
}

// Video thumb that force-plays on mount — autoplay attr alone gets
// paused by Chromium inside masked/transformed containers.
function CarouselVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tryPlay = () => v.play().catch(() => {});
    v.addEventListener('loadeddata', tryPlay);
    v.addEventListener('canplay', tryPlay);
    tryPlay();
    return () => {
      v.removeEventListener('loadeddata', tryPlay);
      v.removeEventListener('canplay', tryPlay);
    };
  }, [url]);
  return (
    <video
      ref={ref}
      src={url}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      className="w-full h-full object-cover pointer-events-none"
    />
  );
}
