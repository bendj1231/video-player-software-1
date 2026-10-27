import React, { useRef, useEffect, useState } from 'react';
import { Film } from 'lucide-react';

// Canvas that renders frames streamed from the embedded vlcbridge process.
// libVLC handles audio natively; this is just the decoded picture.
export function VlcCanvas({ relPath, width = 960, className, onFail }: {
  relPath: string;
  width?: number;
  className?: string;
  onFail?: (err: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const failed = useRef(false);

  useEffect(() => {
    const wm = (window as any).wmplayer;
    if (!wm?.vlcStart) {
      onFail?.('VLC bridge unavailable');
      return;
    }
    let cancelled = false;
    const offFrame = wm.onVlcFrame(({ w, h, data }: { w: number; h: number; data: Uint8Array }) => {
      const cv = canvasRef.current;
      if (!cv || cancelled) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, w * h * 4), w, h), 0, 0);
      setHasFrame(true);
    });
    const offEnd = wm.onVlcEnded(() => { if (!cancelled && !failed.current) setHasFrame(false); });
    wm.vlcStart(relPath, width).then((r: any) => {
      if (!r?.success && !cancelled) {
        failed.current = true;
        setError(r?.error || 'VLC engine failed');
        onFail?.(r?.error || 'VLC engine failed');
      }
    });
    return () => {
      cancelled = true;
      offFrame?.();
      offEnd?.();
      wm.vlcStop();
    };
  }, [relPath]);

  return (
    <div className={`relative flex items-center justify-center bg-black ${className || ''}`}>
      <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
      {!hasFrame && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
          <Film size={32} />
          <p className="text-xs">Decoding via VLC engine…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs">{error}</div>
      )}
    </div>
  );
}
