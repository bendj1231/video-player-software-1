import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

// Check if SharedArrayBuffer is available AND usable (required for FFmpeg)
function isSharedArrayBufferAvailable(): boolean {
  try {
    // Check if SharedArrayBuffer exists
    if (typeof SharedArrayBuffer === 'undefined') {
      return false;
    }
    // Try to actually create one - this will fail if COOP/COEP headers aren't set
    new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
}

let ffmpegInstance: FFmpeg | null = null;
let isLoading = false;

export async function getFFmpeg(): Promise<FFmpeg | null> {
  // Check for SharedArrayBuffer support early
  if (!isSharedArrayBufferAvailable()) {
    console.log('SharedArrayBuffer not available - FFmpeg requires it for multithreading');
    console.log('Use a browser with SharedArrayBuffer support or download the video instead');
    return null;
  }
  
  if (ffmpegInstance) return ffmpegInstance;
  if (isLoading) {
    // Wait for loading to complete with timeout
    let waitCount = 0;
    while (isLoading && waitCount < 300) { // 30 second max wait
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }
    return ffmpegInstance;
  }

  isLoading = true;
  try {
    console.log('Loading FFmpeg...');
    
    const ffmpeg = new FFmpeg();
    
    // Use standard FFmpeg build
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    console.log('Fetching FFmpeg core files from CDN:', baseURL);
    
    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
    console.log('FFmpeg core.js loaded');
    
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
    console.log('FFmpeg core.wasm loaded');
    
    console.log('Initializing FFmpeg...');
    
    // Add timeout to detect hanging initialization
    const initTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('FFmpeg initialization timeout - browser may not support required features')), 30000);
    });
    
    try {
      await Promise.race([
        ffmpeg.load({ coreURL, wasmURL }),
        initTimeout
      ]);
      console.log('FFmpeg initialized successfully');
    } catch (initErr) {
      console.error('FFmpeg initialization failed:', initErr);
      throw initErr;
    }
    
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

export interface TranscodeResult {
  blob: Blob;
  duration: number;
}

// Generator-based transcode for AVI to MP4 (yields progress, returns result)
export async function* transcodeVideoGenerator(
  inputFile: File | Blob,
  inputFormat: string
): AsyncGenerator<TranscodeProgress, TranscodeResult | null, unknown> {
  console.log('Getting FFmpeg instance...');
  const ffmpeg = await getFFmpeg();
  if (!ffmpeg) {
    console.error('FFmpeg not available');
    return null;
  }
  console.log('FFmpeg ready, starting transcode...');

  const inputName = `input.${inputFormat}`;
  const outputName = 'output.mp4';
  let lastTime = 0;

  try {
    // Write input file to FFmpeg FS
    console.log('Writing input file to FFmpeg FS...');
    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));
    console.log('Input file written');

    // Set up progress tracking that yields
    ffmpeg.on('progress', ({ progress, time }) => {
      lastTime = time;
      console.log('Transcoding progress:', Math.round(progress * 100), '%');
    });

    // Run transcoding in background and yield progress
    const transcodePromise = ffmpeg.exec([
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

    // Poll progress while transcoding
    let lastProgress = 0;
    while (true) {
      const done = await Promise.race([
        transcodePromise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))
      ]);
      
      // FFmpeg progress is approximate - estimate based on time if available
      const progress = done ? 100 : Math.min(95, lastProgress + 1);
      lastProgress = progress;
      
      yield { progress, time: lastTime };
      
      if (done) break;
    }

    console.log('FFmpeg exec complete');

    // Read output file
    console.log('Reading output file...');
    const data = await ffmpeg.readFile(outputName) as any;
    const outputBlob = new Blob([data], { type: 'video/mp4' });

    // Clean up files
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    console.log('Transcoding complete:', outputBlob.size, 'bytes');
    yield { progress: 100, time: lastTime };
    return { blob: outputBlob, duration: lastTime };
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

// Legacy callback-based function (kept for compatibility)
export async function transcodeVideo(
  inputFile: File | Blob,
  inputFormat: string,
  onProgress?: (progress: TranscodeProgress) => void
): Promise<Blob | null> {
  console.log('Getting FFmpeg instance...');
  const ffmpeg = await getFFmpeg();
  if (!ffmpeg) {
    console.error('FFmpeg not available');
    return null;
  }
  console.log('FFmpeg ready, starting transcode...');

  const inputName = `input.${inputFormat}`;
  const outputName = 'output.mp4';

  try {
    // Write input file to FFmpeg FS
    console.log('Writing input file to FFmpeg FS...');
    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));
    console.log('Input file written');

    // Set up progress tracking
    if (onProgress) {
      ffmpeg.on('progress', ({ progress, time }) => {
        console.log('Transcoding progress:', Math.round(progress * 100), '%');
        onProgress({ progress: Math.round(progress * 100), time });
      });
    }

    // Transcode to MP4 using H.264 codec (widely supported)
    // Using fast preset for speed, yuv420p for compatibility
    console.log('Starting FFmpeg exec...');
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
    console.log('FFmpeg exec complete');

    // Read output file
    console.log('Reading output file...');
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
