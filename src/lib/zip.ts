import JSZip from 'jszip';

 function getVideoMimeType(name: string) {
   const lowerName = name.toLowerCase();
   if (lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v') || lowerName.endsWith('.mcgi')) return 'video/mp4';
   if (lowerName.endsWith('.webm')) return 'video/webm';
   if (lowerName.endsWith('.mov')) return 'video/quicktime';
   if (lowerName.endsWith('.mkv')) return 'video/x-matroska';
   if (lowerName.endsWith('.avi')) return 'video/x-msvideo';
   return 'video/mp4';
 }

export async function extractVideoFromZip(zipBlob: Blob): Promise<{ url: string; cleanup: () => void } | null> {
  // Quick check: if blob type indicates it's a video, skip zip extraction
  if (zipBlob.type.startsWith('video/')) {
    return null;
  }
  
  try {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(zipBlob);
    
    const videoFile = Object.values(loadedZip.files).find(
      (file) => !file.dir && (file.name.endsWith('.mp4') || file.name.endsWith('.webm') || file.name.endsWith('.mkv') || file.name.endsWith('.mov') || file.name.endsWith('.mcgi'))
    );

    if (!videoFile) {
      return null;
    }

    const blob = await videoFile.async('blob');
    const typedBlob = new Blob([blob], { type: getVideoMimeType(videoFile.name) });
    const url = URL.createObjectURL(typedBlob);

    return {
      url,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    // Not a valid zip file or other error
    return null;
  }
}

export function getVideoUrl(blob: Blob): { url: string; cleanup: () => void } {
  const typedBlob = blob.type
    ? blob
    : new Blob([blob], { type: 'video/mp4' });
  const url = URL.createObjectURL(typedBlob);
  return {
    url,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export async function getVideoPreview(blob: Blob, fileName?: string): Promise<{ url: string; cleanup: () => void } | null> {
  // Handle empty blobs
  if (!blob || blob.size === 0) {
    console.warn('Empty blob provided to getVideoPreview');
    return null;
  }

  // Determine the actual MIME type, using fileName as fallback for detection
  let mimeType = blob.type;
  const name = fileName?.toLowerCase() || '';
  
  // If blob type is missing or generic, try to infer from filename
  if (!mimeType || mimeType === 'application/octet-stream' || mimeType === '') {
    if (name.endsWith('.mp4') || name.endsWith('.m4v') || name.endsWith('.mcgi')) mimeType = 'video/mp4';
    else if (name.endsWith('.webm')) mimeType = 'video/webm';
    else if (name.endsWith('.mov')) mimeType = 'video/quicktime';
    else if (name.endsWith('.mkv')) mimeType = 'video/x-matroska';
    else if (name.endsWith('.avi')) mimeType = 'video/x-msvideo';
    else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (name.endsWith('.png')) mimeType = 'image/png';
    else if (name.endsWith('.gif')) mimeType = 'image/gif';
    else if (name.endsWith('.webp')) mimeType = 'image/webp';
    else if (name.endsWith('.bmp')) mimeType = 'image/bmp';
    else if (blob.size > 100000) {
      // Assume video if large file with no type
      mimeType = 'video/mp4';
    }
  }

  // If it's a video or image file, create URL directly
  if (mimeType.startsWith('video/') || mimeType.startsWith('image/')) {
    // Recreate blob with correct MIME type if needed
    const finalBlob = mimeType === blob.type 
      ? blob 
      : new Blob([blob], { type: mimeType });
    const url = URL.createObjectURL(finalBlob);
    return {
      url,
      cleanup: () => URL.revokeObjectURL(url)
    };
  }
  
  // First try to extract from zip (only for non-video files)
  const result = await extractVideoFromZip(blob);
  if (result) return result;
  
  // Check if it's an image (no type but small size)
  const isImage = mimeType.startsWith('image/') ||
                  (mimeType === '' && blob.size < 50000000); // Assume images under 50MB if no type
  
  if (isImage) {
    const url = URL.createObjectURL(blob);
    return {
      url,
      cleanup: () => URL.revokeObjectURL(url)
    };
  }
  
  // If it's a video file or large file, create URL directly
  const isVideo = mimeType.startsWith('video/') || 
                  mimeType === 'application/octet-stream' ||
                  blob.size > 100000;
  
  if (isVideo) {
    return getVideoUrl(blob);
  }
  
  return null;
}
