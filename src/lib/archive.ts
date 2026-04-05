import JSZip from 'jszip';
import { Archive } from 'libarchive.js';

// iPad Pro 2015 memory limit detection
const isIPadPro2015 = () => {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isLargeScreen = window.innerWidth >= 1024 && window.innerWidth <= 1366;
  return isIPad && isLargeScreen;
};

// Force garbage collection hint for iPad
const forceMemoryCleanup = () => {
  if (isIPadPro2015()) {
    // Clear any pending animations/timers
    const highest = setTimeout(() => {
      for (let i = 0; i < (highest as unknown as number); i++) {
        clearTimeout(i);
      }
    }, 0);
    
    // Suggest GC (works in some iOS WebKit versions)
    if ('gc' in window) {
      (window as any).gc();
    }
  }
};

let libArchiveInitialized = false;

async function initLibArchive() {
  if (!libArchiveInitialized) {
    await Archive.init({
      workerUrl: '/libarchive.js/worker-bundle.js'
    });
    libArchiveInitialized = true;
  }
}

export interface ArchiveFile {
  name: string;
  size: number;
  isDirectory: boolean;
  isEncrypted: boolean;
}

export interface ArchiveInfo {
  files: ArchiveFile[];
  hasPassword: boolean;
  isEncrypted: boolean;
}

export interface ExtractionProgress {
  fileName: string;
  current: number;
  total: number;
}

export interface ExtractOptions {
  password?: string;
  onProgress?: (progress: ExtractionProgress) => void;
}

export function getArchiveFormat(fileName: string): 'zip' | '7z' | 'rar' | 'tar' | 'unknown' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || 
      lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')) return 'tar';
  return 'unknown';
}

export class VirtualArchiveExplorer {
  private archiveData: ArrayBuffer | null = null;
  private zip: JSZip | null = null;
  private libArchive: any = null;
  private archiveFormat: 'zip' | '7z' | 'rar' | 'tar' | 'unknown' = 'unknown';
  private password: string | null = null;
  private isEncrypted = false;
  private hasPassword = false;

  constructor() {}

  async loadArchive(file: File): Promise<void> {
    this.archiveData = await file.arrayBuffer();
    this.archiveFormat = getArchiveFormat(file.name);
    
    if (this.archiveFormat === 'zip') {
      await this.loadZip();
    } else if (this.archiveFormat === '7z' || this.archiveFormat === 'rar' || this.archiveFormat === 'tar') {
      await this.loadLibArchive(file);
    } else {
      throw new Error(`Unsupported archive format: ${file.name}`);
    }
  }

  private async loadZip(): Promise<void> {
    try {
      this.zip = await JSZip.loadAsync(this.archiveData!);
      this.isEncrypted = false;
      this.hasPassword = false;
    } catch (error) {
      this.isEncrypted = true;
      this.hasPassword = true;
      throw new Error('ZIP archive is password protected');
    }
  }

  private async loadLibArchive(file: File): Promise<void> {
    try {
      await initLibArchive();
      this.libArchive = await Archive.open(file);
      
      // Check if password is needed by trying to list files
      try {
        const files = await this.libArchive.getFilesArray();
        // If we successfully got files, no password needed
        this.isEncrypted = false;
        this.hasPassword = false;
        console.log('Archive loaded successfully, files found:', files.length);
      } catch (err: any) {
        console.log('getFilesArray failed:', err?.message || err);
        // Check if error is specifically about password
        const errorMsg = (err?.message || '').toLowerCase();
        if (errorMsg.includes('password') || errorMsg.includes('encrypted') || errorMsg.includes('passphrase')) {
          this.isEncrypted = true;
          this.hasPassword = true;
          throw new Error(`${this.archiveFormat} archive is password protected`);
        } else {
          // Some other error, re-throw it
          throw err;
        }
      }
    } catch (error: any) {
      console.error('loadLibArchive error:', error);
      if (error?.message?.includes('password')) {
        throw error;
      }
      throw new Error(`Failed to load ${this.archiveFormat} archive: ${error?.message || 'Unknown error'}`);
    }
  }

  async setPassword(password: string): Promise<void> {
    if (!this.archiveData) {
      throw new Error('No archive loaded');
    }

    this.password = password;

    if (this.archiveFormat === 'zip') {
      await this.setPasswordZip(password);
    } else if (this.libArchive) {
      await this.setPasswordLibArchive(password);
    }
  }

  private async setPasswordZip(password: string): Promise<void> {
    try {
      this.zip = await JSZip.loadAsync(this.archiveData!);
      this.hasPassword = false;
    } catch (error) {
      throw new Error('Invalid password for ZIP archive');
    }
  }

  private async setPasswordLibArchive(password: string): Promise<void> {
    try {
      // Re-open the archive with password
      const file = new File([this.archiveData!], 'archive.bin', { type: 'application/octet-stream' });
      
      if (this.libArchive) {
        await this.libArchive.close();
      }
      
      this.libArchive = await Archive.open(file);
      
      // Try to extract a file to verify password works
      const files = await this.libArchive.getFilesObject();
      const firstFile = Object.values(files)[0] as any;
      
      if (firstFile) {
        try {
          await firstFile.extract(password);
          this.hasPassword = false;
        } catch {
          throw new Error('Invalid password');
        }
      }
    } catch (error) {
      throw new Error('Invalid password for archive');
    }
  }

  async listFiles(): Promise<ArchiveFile[]> {
    if (this.libArchive) {
      return this.listFilesLibArchive();
    }
    
    if (!this.zip) {
      throw new Error('No archive loaded or password required');
    }

    const files: ArchiveFile[] = [];

    for (const [name, zipEntry] of Object.entries(this.zip.files)) {
      if (name.endsWith('/')) continue;

      files.push({
        name,
        size: 0,
        isDirectory: false,
        isEncrypted: false
      });
    }

    return files;
  }

  private async listFilesLibArchive(): Promise<ArchiveFile[]> {
    if (!this.libArchive) {
      throw new Error('Archive not loaded');
    }

    const files: ArchiveFile[] = [];
    
    try {
      const filesArray = await this.libArchive.getFilesArray();
      
      for (const item of filesArray) {
        if (!item.file.isDirectory) {
          files.push({
            name: item.path + item.file.name,
            size: item.file.size || 0,
            isDirectory: false,
            isEncrypted: !!this.password
          });
        }
      }
      
      return files;
    } catch (error) {
      console.error('Error listing archive files:', error);
      throw new Error('Failed to list archive contents');
    }
  }

  async extractFile(fileName: string): Promise<Blob> {
    if (this.libArchive) {
      const result = await this.extractFileLibArchive(fileName);
      // Force memory cleanup after extraction on iPad
      if (isIPadPro2015()) {
        forceMemoryCleanup();
      }
      return result;
    }
    
    if (!this.zip) {
      throw new Error('No archive loaded or password required');
    }

    const zipEntry = this.zip.file(fileName);
    if (!zipEntry) {
      throw new Error('File not found in archive');
    }

    // Extract file as blob
    const data = await zipEntry.async('uint8array');
    const blob = new Blob([new Uint8Array(data)]);
    
    // Force memory cleanup after extraction on iPad
    if (isIPadPro2015()) {
      forceMemoryCleanup();
    }
    
    return blob;
  }

  private async extractFileLibArchive(fileName: string): Promise<Blob> {
    if (!this.libArchive) {
      throw new Error('Archive not loaded');
    }

    try {
      const filesObj = await this.libArchive.getFilesObject();
      
      // Find the file (handle nested paths)
      const fileParts = fileName.split('/');
      let current: any = filesObj;
      
      for (const part of fileParts) {
        if (part) {
          current = current[part];
        }
      }
      
      if (!current) {
        throw new Error(`File not found: ${fileName}`);
      }
      
      // Extract the file with password if set
      const extractedFile = await current.extract(this.password || undefined);
      return extractedFile;
    } catch (error) {
      console.error('Error extracting file:', error);
      throw new Error(`Failed to extract file: ${fileName}`);
    }
  }

  async extractVideoFile(fileName: string): Promise<Blob> {
    return this.extractFile(fileName);
  }

  getArchiveInfo(): ArchiveInfo {
    return {
      files: [],
      hasPassword: this.hasPassword,
      isEncrypted: this.isEncrypted
    };
  }
}

// Temporary file management
export class TempFileManager {
  private tempFiles: string[] = [];

  async createTempFile(extension: string = '.tmp'): Promise<string> {
    const tempPath = `/tmp/${crypto.randomUUID()}${extension}`;
    this.tempFiles.push(tempPath);
    return tempPath;
  }

  async cleanup(): Promise<void> {
    for (const tempFile of this.tempFiles) {
      try {
        // In a real implementation, you'd delete the file here
        console.log(`Cleaning up temp file: ${tempFile}`);
      } catch (error) {
        console.error(`Failed to cleanup temp file: ${tempFile}`, error);
      }
    }
    this.tempFiles = [];
  }

  async cleanupFile(filePath: string): Promise<void> {
    const index = this.tempFiles.indexOf(filePath);
    if (index > -1) {
      this.tempFiles.splice(index, 1);
      // In a real implementation, delete the file here
      console.log(`Cleaning up specific temp file: ${filePath}`);
    }
  }
}
