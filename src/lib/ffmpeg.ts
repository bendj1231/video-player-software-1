import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let isLoading = false;

export async function getFFmpeg(): Promise<FFmpeg | null> {
  if (ffmpegInstance) return ffmpegInstance;
  if (isLoading) {
    // Wait for loading to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return ffmpegInstance;
  }

  isLoading = true;
  try {
    const ffmpeg = new FFmpeg();
    
    // Load FFmpeg with core files from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    ffmpegInstance = ffmpeg;
    console.log('FFmpeg loaded successfully');
    return ffmpeg;
  } catch (err) {
    console.error('Failed to load FFmpeg:', err);
    return null;
  } finally {
    isLoading = false;
  }
}

export interface TranscodeProgress {
  progress: number;
  time: number;
}

export async function transcodeVideo(
  inputFile: File | Blob,
  inputFormat: string,
  onProgress?: (progress: TranscodeProgress) => void
): Promise<Blob | null> {
  const ffmpeg = await getFFmpeg();
  if (!ffmpeg) {
    console.error('FFmpeg not available');
    return null;
  }

  const inputName = `input.${inputFormat}`;
  const outputName = 'output.mp4';

  try {
    // Write input file to FFmpeg FS
    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

    // Set up progress tracking
    if (onProgress) {
      ffmpeg.on('progress', ({ progress, time }) => {
        onProgress({ progress: Math.round(progress * 100), time });
      });
    }

    // Transcode to MP4 using H.264 codec (widely supported)
    // Using fast preset for speed, yuv420p for compatibility
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputName
    ]);

    // Read output file
    const data = await ffmpeg.readFile(outputName) as any;
    const outputBlob = new Blob([data], { type: 'video/mp4' });

    // Clean up files
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    console.log('Transcoding complete:', outputBlob.size, 'bytes');
    return outputBlob;
  } catch (err) {
    console.error('Transcoding failed:', err);
    // Clean up on error
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {}
    return null;
  }
}

// Check if transcoding is needed for this file type
export function needsTranscoding(mimeType: string): boolean {
  const unsupportedTypes = [
    'video/x-msvideo', // AVI
    'video/avi',
    'video/x-matroska', // MKV
    'video/mkv',
    'video/x-flv', // FLV
    'video/flv',
    'video/x-ms-wmv', // WMV
    'video/wmv',
  ];
  
  return unsupportedTypes.some(type => mimeType.includes(type));
}

// Get format from MIME type or filename
export function getVideoFormat(mimeType: string, filename?: string): string {
  if (mimeType.includes('avi') || filename?.toLowerCase().endsWith('.avi')) return 'avi';
  if (mimeType.includes('mkv') || filename?.toLowerCase().endsWith('.mkv')) return 'mkv';
  if (mimeType.includes('flv') || filename?.toLowerCase().endsWith('.flv')) return 'flv';
  if (mimeType.includes('wmv') || filename?.toLowerCase().endsWith('.wmv')) return 'wmv';
  return 'mp4';
}
