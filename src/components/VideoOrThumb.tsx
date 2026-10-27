import React, { useState, useRef, useEffect } from 'react';
import { storageUrl, getThumbnail } from '../lib/electronStorage';
import { Film } from 'lucide-react';

// Renders a live video preview; on decode error (HEVC etc.) falls back to
// a macOS QuickLook-generated thumbnail. Falls back to an icon if that fails.
// Videos mount on first sight and stay mounted (paused off-screen) so the
// grid doesn't flicker; memory is freed when the view unmounts entirely.
// Playback is capped to the first 15 seconds and loops.
export function VideoOrThumb({ relPath, className }: { relPath: string; className?: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [everVisible, setEverVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThumb(null);
    setFailed(false);
    setEverVisible(false);
  }, [relPath]);

  // mount on first sight; afterwards just pause/resume — no unmount flicker
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const inView = entries[0].isIntersecting;
      if (inView) setEverVisible(true);
      const v = videoRef.current;
      if (v) { inView ? v.play().catch(() => {}) : v.pause(); }
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onError = () => {
    getThumbnail(relPath).then((t) => setThumb(t || 'none'));
  };



  const cls = className || '';
  const wrap = (child: React.ReactNode) => (
    <div ref={hostRef} className={`w-full h-full ${cls}`}>{child}</div>
  );

  if (thumb === 'none' || failed) {
    return wrap(
      <div className="flex items-center justify-center bg-zinc-800 w-full h-full">
        <Film size={28} className="text-zinc-600" />
      </div>
    );
  }
  if (thumb) {
    return wrap(<img src={thumb} alt="" draggable={false} className="w-full h-full object-cover" />);
  }
  return wrap(
    everVisible ? (
      <video
        ref={videoRef}
        src={storageUrl(relPath)}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        onError={onError}
        onLoadedData={() => videoRef.current?.play().catch(() => {})}
        className="w-full h-full object-cover"
      />
    ) : (
      <div className="w-full h-full bg-zinc-900" />
    )
  );
}
