import { useState, useEffect } from 'react';

// Collection of random placeholder images from various sources
const RANDOM_IMAGES = [
  'https://picsum.photos/400/300?random=1',
  'https://picsum.photos/400/300?random=2',
  'https://picsum.photos/400/300?random=3',
  'https://picsum.photos/400/300?random=4',
  'https://picsum.photos/400/300?random=5',
  'https://picsum.photos/400/300?random=6',
  'https://picsum.photos/400/300?random=7',
  'https://picsum.photos/400/300?random=8',
  'https://picsum.photos/400/300?random=9',
  'https://picsum.photos/400/300?random=10',
  'https://picsum.photos/400/300?random=11',
  'https://picsum.photos/400/300?random=12',
  'https://picsum.photos/400/300?random=13',
  'https://picsum.photos/400/300?random=14',
  'https://picsum.photos/400/300?random=15',
  'https://picsum.photos/400/300?random=16',
  'https://picsum.photos/400/300?random=17',
  'https://picsum.photos/400/300?random=18',
  'https://picsum.photos/400/300?random=19',
  'https://picsum.photos/400/300?random=20',
];

interface PrivacyCoverProps {
  className?: string;
  aspectRatio?: string;
}

export function PrivacyCover({ className = '', aspectRatio = '16/9' }: PrivacyCoverProps) {
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    // Select a random image
    const randomIndex = Math.floor(Math.random() * RANDOM_IMAGES.length);
    setImageUrl(RANDOM_IMAGES[randomIndex]);
  }, []);

  if (!imageUrl) return null;

  return (
    <div 
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio }}
    >
      <img
        src={imageUrl}
        alt="Privacy cover"
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white/80 text-xs font-medium bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
          Privacy Protected
        </span>
      </div>
    </div>
  );
}
