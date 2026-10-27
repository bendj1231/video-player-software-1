import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

export function ImageViewerModal({ url, name, onClose, onNext, onPrevious, hasNext = false, hasPrevious = false }: {
  url: string | null;
  name?: string;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // reset zoom when the image changes
  useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, [url]);

  useEffect(() => {
    if (!url) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && hasNext) onNext?.();
      if (e.key === 'ArrowLeft' && hasPrevious) onPrevious?.();
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(8, z * 1.25));
      if (e.key === '-') setZoom(z => Math.max(1, z / 1.25));
      if (e.key === '0') { setZoom(1); setOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [url, hasNext, hasPrevious, onNext, onPrevious, onClose]);

  if (!url) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center overflow-hidden"
        onClick={onClose}
        onWheel={(e) => {
          // wheel zoom centered on the view
          e.preventDefault();
          setZoom(z => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
        onPointerDown={(e) => {
          if (zoom > 1) {
            drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            setOffset({ x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) });
          }
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10"
        >
          <X size={22} className="text-white" />
        </button>

        {/* zoom controls */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur-md rounded-full px-2 py-1 z-10">
          <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(1, z / 1.25)); }} className="p-1.5 text-white/70 hover:text-white"><ZoomOut size={17} /></button>
          <button onClick={(e) => { e.stopPropagation(); setZoom(1); setOffset({ x: 0, y: 0 }); }} className="text-[11px] text-white/70 hover:text-white w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</button>
          <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(8, z * 1.25)); }} className="p-1.5 text-white/70 hover:text-white"><ZoomIn size={17} /></button>
        </div>

        {hasPrevious && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrevious?.(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10"
          >
            <ChevronLeft size={26} className="text-white" />
          </button>
        )}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext?.(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10"
          >
            <ChevronRight size={26} className="text-white" />
          </button>
        )}

        <motion.img
          key={url}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          src={url}
          alt={name || ''}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? 'grab' : 'default',
            transition: drag.current ? 'none' : 'transform 0.15s ease-out',
          }}
          className="max-w-[92vw] max-h-[86vh] object-contain rounded-lg shadow-2xl select-none"
          onClick={(e) => e.stopPropagation()}
        />

        {name && (
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-sm text-zinc-300 bg-black/50 px-4 py-1.5 rounded-full max-w-[80vw] truncate">
            {name}
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
