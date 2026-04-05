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
    try {
      console.log('Loading 7z archive...');
      const factory = await getSevenZipFactory();
      console.log('7z factory loaded');
      
      if (!SevenZipModule) {
        console.log('Initializing SevenZipModule...');
        SevenZipModule = await factory();
        console.log('SevenZipModule initialized');
      }
      
      this.sevenZip = SevenZipModule;
      
      // Write archive to virtual filesystem
      console.log('Writing archive to virtual FS...');
      try {
        this.sevenZip.FS.writeFile('/archive.7z', new Uint8Array(this.archiveData!));
        console.log('Archive written to FS successfully');
      } catch (fsError) {
        console.error('FS write error:', fsError);
        throw new Error('Failed to write archive to virtual filesystem');
      }
      
      // Try to list contents to check if encrypted
      console.log('Testing archive listing...');
      try {
        const result = this.sevenZip.callMain(['l', '/archive.7z']);
        console.log('Archive listing result:', result);
        
        if (result !== 0) {
          throw new Error(`7z list command failed with code ${result}`);
        }
        
        this.isEncrypted = false;
        this.hasPassword = false;
        console.log('7z archive loaded successfully');
      } catch (listError) {
        console.log('Archive may be encrypted or corrupted:', listError);
        this.isEncrypted = true;
        this.hasPassword = true;
        throw new Error('7z archive is password protected');
      }
    } catch (error) {
      console.error('load7z error:', error);
      if (error instanceof Error && error.message.includes('password')) {
        throw error;
      }
      throw new Error(`Failed to load 7z archive: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
    if (!this.sevenZip) {
      throw new Error('7z archive not loaded');
    }

    const files: ArchiveFile[] = [];
    const passwordArg = this.password ? `-p${this.password}` : '';
    
    try {
      // Use 7z to list files
      let output = '';
      const originalPrint = this.sevenZip.print;
      this.sevenZip.print = (text: string) => { output += text + '\n'; };
      
      const args = passwordArg ? ['l', passwordArg, '/archive.7z'] : ['l', '/archive.7z'];
      this.sevenZip.callMain(args);
      
      this.sevenZip.print = originalPrint;
      
      // Parse output to extract file names (simplified parsing)
      const lines = output.split('\n');
      for (const line of lines) {
        // Look for file entries in the listing
        const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/);
        if (match && !line.includes('D....') && !line.includes('Attrs')) {
          const fileName = match[3].trim();
          if (fileName && !fileName.startsWith('---')) {
            files.push({
              name: fileName,
              size: 0,
              isDirectory: false,
              isEncrypted: !!this.password
            });
          }
        }
      }
      
      return files;
    } catch (error) {
      console.error('Error listing 7z files:', error);
      throw new Error('Failed to list 7z archive contents');
    }
  }

  async extractFile(fileName: string): Promise<Blob> {
    if (this.archiveFormat === '7z' && this.sevenZip) {
      return this.extractFile7z(fileName);
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
    if (!this.sevenZip) {
      throw new Error('7z archive not loaded');
    }

    const passwordArg = this.password ? `-p${this.password}` : '';
    
    try {
      // Extract to a virtual file in the FS
      const outputPath = `/extracted/${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      
      // Create directory structure
      const dirPath = outputPath.substring(0, outputPath.lastIndexOf('/'));
      try {
        this.sevenZip.FS.mkdir(dirPath);
      } catch {
        // Directory might already exist
      }
      
      // Extract the file
      const args = passwordArg 
        ? ['e', passwordArg, '/archive.7z', fileName, `-o${dirPath}`, '-y']
        : ['e', '/archive.7z', fileName, `-o${dirPath}`, '-y'];
      
      const result = this.sevenZip.callMain(args);
      
      if (result !== 0) {
        throw new Error(`Failed to extract file: ${fileName}`);
      }
      
      // Read the extracted file
      const extractedData = this.sevenZip.FS.readFile(outputPath);
      return new Blob([extractedData]);
    } catch (error) {
      console.error('Error extracting 7z file:', error);
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
