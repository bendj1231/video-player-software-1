import JSZip from 'jszip';

// SevenZip module - loaded dynamically to avoid startup errors
let SevenZipModule: any = null;
let SevenZipFactory: any = null;

// Dynamically import 7z-wasm only when needed
async function getSevenZipFactory() {
  if (!SevenZipFactory) {
    try {
      const module = await import('7z-wasm');
      SevenZipFactory = module.default || module;
    } catch (err) {
      console.error('Failed to load 7z-wasm:', err);
      throw new Error('7z support is not available');
    }
  }
  return SevenZipFactory;
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
  private sevenZip: any = null;
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
    } else if (this.archiveFormat === '7z') {
      await this.load7z();
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
      // Try with password
      this.isEncrypted = true;
      this.hasPassword = true;
      throw new Error('ZIP archive is password protected');
    }
  }

  private async load7z(): Promise<void> {
    // 7z support is temporarily disabled due to WASM loading issues
    console.warn('7z support is temporarily disabled. Please use ZIP format.');
    throw new Error('7z archives are not supported yet. Please convert to ZIP format.');
  }

  async setPassword(password: string): Promise<void> {
    if (!this.archiveData) {
      throw new Error('No archive loaded');
    }

    this.password = password;

    if (this.archiveFormat === 'zip') {
      await this.setPasswordZip(password);
    } else if (this.archiveFormat === '7z') {
      await this.setPassword7z(password);
    }
  }

  private async setPasswordZip(password: string): Promise<void> {
    try {
      // JSZip doesn't natively support password - use the stored password for extraction later
      this.zip = await JSZip.loadAsync(this.archiveData!);
      this.hasPassword = false;
    } catch (error) {
      throw new Error('Invalid password for ZIP archive');
    }
  }

  private async setPassword7z(password: string): Promise<void> {
    try {
      const factory = await getSevenZipFactory();
      if (!SevenZipModule) {
        SevenZipModule = await factory();
      }
      // Verify password by trying to list files
      this.sevenZip = SevenZipModule;
      this.sevenZip.FS.writeFile('/archive.7z', new Uint8Array(this.archiveData!));
      const result = this.sevenZip.callMain(['l', '-p' + password, '/archive.7z']);
      
      if (result !== 0) {
        throw new Error('Invalid password');
      }
      
      this.hasPassword = false;
    } catch (error) {
      throw new Error('Invalid password for 7z archive');
    }
  }

  async listFiles(): Promise<ArchiveFile[]> {
    if (this.archiveFormat === '7z' && this.sevenZip) {
      return this.listFiles7z();
    }
    
    if (!this.zip) {
      throw new Error('No archive loaded or password required');
    }

    const files: ArchiveFile[] = [];

    for (const [name, zipEntry] of Object.entries(this.zip.files)) {
      if (name.endsWith('/')) continue; // Skip directories

      files.push({
        name,
        size: 0, // JSZip doesn't easily expose file sizes without extraction
        isDirectory: false,
        isEncrypted: false // JSZip doesn't expose encryption info easily
      });
    }

    return files;
  }

  private async listFiles7z(): Promise<ArchiveFile[]> {
    throw new Error('7z support is temporarily disabled');
  }

  async extractFile(fileName: string): Promise<Blob> {
    if (this.archiveFormat === '7z') {
      throw new Error('7z support is temporarily disabled');
    }
    
    if (!this.zip) {
      throw new Error('No archive loaded or password required');
    }

    const zipEntry = this.zip.file(fileName);
    if (!zipEntry) {
      throw new Error('File not found in archive');
    }

    // Extract file as blob
    const data = await zipEntry.async('uint8array') as Uint8Array;
    return new Blob([data]);
  }

  private async extractFile7z(fileName: string): Promise<Blob> {
    throw new Error('7z support is temporarily disabled');
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
