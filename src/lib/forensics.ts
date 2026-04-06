import { getVideosByFolder, getFolderById } from './db';

export interface FileMetadata {
  filename: string;
  size: number;
  type: string;
  lastModified: number;
  exif?: {
    camera?: string;
    dateTaken?: string;
    gps?: { lat: number; lng: number };
    software?: string;
    device?: string;
    [key: string]: any;
  };
  videoInfo?: {
    duration?: number;
    width?: number;
    height?: number;
    codec?: string;
    frameRate?: number;
  };
  suspiciousIndicators?: string[];
  perceptualHash?: string;
}

export interface AnalysisResult {
  fileId: string;
  metadata: FileMetadata;
  riskScore: number;
  flags: string[];
  recommendations: string[];
}

// Extract EXIF data from images
export async function extractExifData(blob: Blob): Promise<Partial<FileMetadata['exif']>> {
  try {
    // Basic EXIF extraction using built-in APIs
    const arrayBuffer = await blob.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    
    // Check for JPEG marker
    if (dataView.getUint16(0) !== 0xFFD8) {
      return undefined;
    }
    
    // Simple EXIF parser - look for common markers
    let offset = 2;
    const length = dataView.byteLength;
    
    while (offset < length) {
      const marker = dataView.getUint16(offset);
      
      // APP1 marker (EXIF)
      if (marker === 0xFFE1) {
        const segmentLength = dataView.getUint16(offset + 2);
        const exifData = new Uint8Array(arrayBuffer, offset + 4, segmentLength - 2);
        
        // Parse EXIF string for common fields
        const exifStr = new TextDecoder().decode(exifData);
        
        return {
          camera: extractExifField(exifStr, 'Make'),
          device: extractExifField(exifStr, 'Model'),
          software: extractExifField(exifStr, 'Software'),
          dateTaken: extractExifField(exifStr, 'DateTimeOriginal') || extractExifField(exifStr, 'DateTime'),
          gps: extractGpsCoords(exifStr),
        };
      }
      
      // Stop at SOS marker
      if (marker === 0xFFDA) break;
      
      // Skip to next segment
      const segmentLength = dataView.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }
    
    return undefined;
  } catch (err) {
    console.error('EXIF extraction error:', err);
    return undefined;
  }
}

function extractExifField(exifStr: string, field: string): string | undefined {
  const regex = new RegExp(`${field}[^\\x00]*\\x00([^\\x00]+)`, 'i');
  const match = exifStr.match(regex);
  return match?.[1]?.trim();
}

function extractGpsCoords(exifStr: string): { lat: number; lng: number } | undefined {
  // Look for GPS coordinates in EXIF
  const latRef = exifStr.match(/GPSLatitudeRef[^\\x00]*\\x00([NS])/i)?.[1];
  const lngRef = exifStr.match(/GPSLongitudeRef[^\\x00]*\\x00([EW])/i)?.[1];
  
  if (latRef && lngRef) {
    // Extract coordinate values - this is simplified
    // In real implementation, parse the rational values
    return undefined; // Placeholder - needs proper GPS parsing
  }
  return undefined;
}

// Extract video metadata
export async function extractVideoMetadata(blob: Blob): Promise<Partial<FileMetadata['videoInfo']>> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    
    // Timeout fallback
    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    }, 5000);
    
    video.src = url;
    video.load();
  });
}

// Generate simple perceptual hash for image comparison
export async function generatePerceptualHash(blob: Blob): Promise<string | undefined> {
  try {
    const img = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return undefined;
    
    // Downscale to 8x8
    ctx.drawImage(img, 0, 0, 8, 8);
    
    // Get pixel data
    const imageData = ctx.getImageData(0, 0, 8, 8);
    const data = imageData.data;
    
    // Calculate average color
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Convert to grayscale
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      total += gray;
    }
    const avg = total / 64;
    
    // Create hash - each bit represents if pixel is above/below average
    let hash = '';
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      hash += gray > avg ? '1' : '0';
    }
    
    return hash;
  } catch (err) {
    return undefined;
  }
}

// Calculate similarity between two hashes (0-1)
export function calculateHashSimilarity(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 0;
  
  let matches = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] === hash2[i]) matches++;
  }
  
  return matches / hash1.length;
}

// Analyze file for forensic indicators
export async function analyzeFileForForensics(
  blob: Blob, 
  filename: string,
  fileId: string
): Promise<AnalysisResult> {
  const flags: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;
  
  const metadata: FileMetadata = {
    filename,
    size: blob.size,
    type: blob.type,
    lastModified: Date.now(),
  };
  
  // Image analysis
  if (blob.type.startsWith('image/')) {
    metadata.exif = await extractExifData(blob);
    metadata.perceptualHash = await generatePerceptualHash(blob);
    
    // Check for suspicious patterns
    if (metadata.exif) {
      // No camera info might indicate screenshot or downloaded
      if (!metadata.exif.camera && !metadata.exif.device) {
        flags.push('Missing camera/device metadata');
        riskScore += 10;
      }
      
      // GPS data present
      if (metadata.exif.gps) {
        flags.push('GPS coordinates present');
        recommendations.push('Review GPS location for context');
      }
      
      // Check date
      if (metadata.exif.dateTaken) {
        const date = new Date(metadata.exif.dateTaken);
        const now = new Date();
        if (date > now) {
          flags.push('Future timestamp detected');
          riskScore += 20;
        }
      }
    }
    
    // Check filename patterns
    const suspiciousPatterns = [
      /\\d{4,8}/, // Long numbers (dates/timestamps)
      /img_\\d+/i,
      /screenshot/i,
      /cam/i,
      /vid_\\d+/i,
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(filename)) {
        flags.push(`Filename matches pattern: ${pattern}`);
        break;
      }
    }
  }
  
  // Video analysis
  if (blob.type.startsWith('video/') || filename.match(/\\.(mp4|mov|avi|mkv)$/i)) {
    metadata.videoInfo = await extractVideoMetadata(blob);
    
    if (metadata.videoInfo) {
      // Very short videos might be clips
      if (metadata.videoInfo.duration && metadata.videoInfo.duration < 3) {
        flags.push('Very short video duration');
        recommendations.push('Review short clip content');
      }
      
      // Low resolution might indicate re-encoded/downloaded
      if (metadata.videoInfo.width && metadata.videoInfo.width < 640) {
        flags.push('Low resolution video');
      }
    }
  }
  
  // File size checks
  if (blob.size < 1024) {
    flags.push('Very small file size');
    riskScore += 5;
  }
  
  // Generate recommendations based on flags
  if (flags.length > 0) {
    recommendations.push('Manual review recommended');
    recommendations.push('Check file source and context');
  }
  
  return {
    fileId,
    metadata,
    riskScore: Math.min(riskScore, 100),
    flags,
    recommendations,
  };
}

// Batch analyze all files in a folder
export async function analyzeFolderContents(folderId: string): Promise<AnalysisResult[]> {
  const files = await getVideosByFolder(folderId);
  const results: AnalysisResult[] = [];
  
  for (const file of files) {
    if (file.file.size > 0) { // Skip placeholder files
      const analysis = await analyzeFileForForensics(file.file, file.name, file.id);
      results.push(analysis);
    }
  }
  
  return results;
}

// Find similar images across all folders
export async function findSimilarImages(
  folderIds: string[], 
  similarityThreshold: number = 0.85
): Promise<{ file1: string; file2: string; similarity: number }[]> {
  const allHashes: { fileId: string; hash: string; folderId: string }[] = [];
  
  // Collect hashes from all folders
  for (const folderId of folderIds) {
    const files = await getVideosByFolder(folderId);
    
    for (const file of files) {
      if (file.file.type.startsWith('image/') && file.file.size > 0) {
        const hash = await generatePerceptualHash(file.file);
        if (hash) {
          allHashes.push({ fileId: file.id, hash, folderId });
        }
      }
    }
  }
  
  // Find similar pairs
  const similar: { file1: string; file2: string; similarity: number }[] = [];
  
  for (let i = 0; i < allHashes.length; i++) {
    for (let j = i + 1; j < allHashes.length; j++) {
      const similarity = calculateHashSimilarity(allHashes[i].hash, allHashes[j].hash);
      if (similarity >= similarityThreshold) {
        similar.push({
          file1: allHashes[i].fileId,
          file2: allHashes[j].fileId,
          similarity,
        });
      }
    }
  }
  
  return similar.sort((a, b) => b.similarity - a.similarity);
}
