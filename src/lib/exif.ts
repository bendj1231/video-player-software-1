// Simple EXIF reader for extracting DateTimeOriginal from JPEG/JFIF images
// Based on JPEG structure: SOI marker -> APP1 (EXIF) marker -> TIFF header -> IFD

export interface ExifData {
  DateTimeOriginal?: string;
  DateTime?: string;
  DateTimeDigitized?: string;
}

function readUInt16(buffer: DataView, offset: number, littleEndian: boolean): number {
  return buffer.getUint16(offset, littleEndian);
}

function readUInt32(buffer: DataView, offset: number, littleEndian: boolean): number {
  return buffer.getUint32(offset, littleEndian);
}

function readString(buffer: DataView, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const byte = buffer.getUint8(offset + i);
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

export async function extractExifData(file: File): Promise<ExifData> {
  const result: ExifData = {};
  
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    
    // Check for JPEG SOI marker (FFD8)
    if (view.getUint16(0) !== 0xFFD8) {
      return result; // Not a JPEG
    }
    
    let offset = 2; // Skip SOI
    
    // Look for APP1 marker (FFE1) which contains EXIF
    while (offset < buffer.byteLength - 1) {
      const marker = view.getUint16(offset);
      
      // Check for APP1 (FFE1)
      if (marker === 0xFFE1) {
        const segmentLength = view.getUint16(offset + 2);
        const exifOffset = offset + 4;
        
        // Check "Exif\0\0" header
        const exifHeader = readString(view, exifOffset, 6);
        if (exifHeader === 'Exif') {
          const tiffOffset = exifOffset + 6;
          
          // Read TIFF header
          const byteOrder = view.getUint16(tiffOffset);
          const littleEndian = byteOrder === 0x4949; // "II" = Intel (little endian)
          
          if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) {
            return result; // Invalid TIFF
          }
          
          // Verify TIFF magic number (42)
          const magic = readUInt16(view, tiffOffset + 2, littleEndian);
          if (magic !== 42) {
            return result;
          }
          
          // Get offset to first IFD
          const ifdOffset = readUInt32(view, tiffOffset + 4, littleEndian);
          let currentIfdOffset = tiffOffset + ifdOffset;
          
          // Read IFD entries
          const numEntries = readUInt16(view, currentIfdOffset, littleEndian);
          currentIfdOffset += 2;
          
          for (let i = 0; i < numEntries; i++) {
            const tag = readUInt16(view, currentIfdOffset, littleEndian);
            const type = readUInt16(view, currentIfdOffset + 2, littleEndian);
            const count = readUInt32(view, currentIfdOffset + 4, littleEndian);
            const valueOffset = readUInt32(view, currentIfdOffset + 8, littleEndian);
            
            // Tag 0x9003 = DateTimeOriginal
            // Tag 0x9004 = DateTimeDigitized
            // Tag 0x0132 = DateTime (modified)
            if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
              // ASCII string type (2)
              if (type === 2) {
                let dateStr: string;
                if (count <= 4) {
                  // Value is stored directly in the offset field
                  const bytes = [
                    (valueOffset >> 0) & 0xFF,
                    (valueOffset >> 8) & 0xFF,
                    (valueOffset >> 16) & 0xFF,
                    (valueOffset >> 24) & 0xFF
                  ];
                  dateStr = bytes.map(b => String.fromCharCode(b)).join('').replace(/\0/g, '');
                } else {
                  // Value is stored at offset
                  dateStr = readString(view, tiffOffset + valueOffset, count);
                }
                
                if (tag === 0x9003) result.DateTimeOriginal = dateStr;
                else if (tag === 0x9004) result.DateTimeDigitized = dateStr;
                else if (tag === 0x0132) result.DateTime = dateStr;
              }
            }
            
            currentIfdOffset += 12;
          }
          
          return result;
        }
        
        offset += 2 + segmentLength;
      } else if (marker >= 0xFFD0 && marker <= 0xFFD9) {
        // Standalone markers (no length field)
        offset += 2;
      } else if (marker === 0xFFD8 || marker === 0xFFFF) {
        // Invalid marker, skip one byte
        offset++;
      } else {
        // Regular segment with length
        const length = view.getUint16(offset + 2);
        offset += 2 + length;
      }
    }
  } catch (err) {
    console.error('Error reading EXIF:', err);
  }
  
  return result;
}

// Get the best available date from EXIF data
export function getBestDate(exifData: ExifData): Date | null {
  const dateStr = exifData.DateTimeOriginal || exifData.DateTimeDigitized || exifData.DateTime;
  if (!dateStr) return null;
  
  // EXIF date format: "YYYY:MM:DD HH:MM:SS"
  try {
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split(':').map(Number);
    const [hour, minute, second] = timePart ? timePart.split(':').map(Number) : [0, 0, 0];
    
    return new Date(year, month - 1, day, hour, minute, second);
  } catch {
    return null;
  }
}

// Group photos by date based on time proximity
// Default: photos within 4 hours of each other are considered a "group"
export function groupPhotosByDate(
  photos: { id: string; file: File; date?: Date }[],
  timeGapMinutes: number = 240 // 4 hours default
): Map<string, typeof photos> {
  const groups = new Map<string, typeof photos>();
  
  if (photos.length === 0) return groups;
  
  // Sort by date (newest first)
  const sorted = [...photos].sort((a, b) => {
    const dateA = a.date?.getTime() || 0;
    const dateB = b.date?.getTime() || 0;
    return dateB - dateA;
  });
  
  let currentGroup: typeof photos = [];
  let currentGroupDate: Date | null = null;
  let groupIndex = 0;
  
  for (const photo of sorted) {
    const photoDate = photo.date;
    
    if (!photoDate) {
      // Photos without dates go to "Unknown Date" group
      const unknownKey = 'Unknown Date';
      if (!groups.has(unknownKey)) {
        groups.set(unknownKey, []);
      }
      groups.get(unknownKey)!.push(photo);
      continue;
    }
    
    if (!currentGroupDate) {
      // First photo in group
      currentGroupDate = photoDate;
      currentGroup = [photo];
    } else {
      const timeDiff = Math.abs(photoDate.getTime() - currentGroupDate.getTime());
      const minutesDiff = timeDiff / (1000 * 60);
      
      if (minutesDiff <= timeGapMinutes) {
        // Within time gap, add to current group
        currentGroup.push(photo);
      } else {
        // Too far apart, start new group
        const groupKey = formatGroupKey(currentGroupDate, currentGroup.length);
        groups.set(groupKey, currentGroup);
        
        groupIndex++;
        currentGroupDate = photoDate;
        currentGroup = [photo];
      }
    }
  }
  
  // Don't forget the last group
  if (currentGroup.length > 0 && currentGroupDate) {
    const groupKey = formatGroupKey(currentGroupDate, currentGroup.length);
    groups.set(groupKey, currentGroup);
  }
  
  return groups;
}

function formatGroupKey(date: Date, count: number): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return `Today · ${count} photos`;
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isYesterday) {
    return `Yesterday · ${count} photos`;
  }
  
  const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysAgo < 7) {
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    return `${weekday} · ${count} photos`;
  }
  
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
  
  return `${dateStr} · ${count} photos`;
}
