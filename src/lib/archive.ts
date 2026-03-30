import JSZip from 'jszip';
import { extractAllTo } from 'adm-zip';

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

export class VirtualArchiveExplorer {
  private archiveData: ArrayBuffer | null = null;
  private zip: JSZip | null = null;
  private password: string | null = null;
  private isEncrypted = false;
  private hasPassword = false;

  constructor() {}

  async loadArchive(file: File): Promise<void> {
    this.archiveData = await file.arrayBuffer();
    
    try {
      this.zip = await JSZip.loadAsync(this.archiveData);
      this.isEncrypted = false;
      this.hasPassword = false;
    } catch (error) {
      // Try with password
      this.isEncrypted = true;
      this.hasPassword = true;
      throw new Error('Archive is password protected');
    }
  }

  async setPassword(password: string): Promise<void> {
    if (!this.archiveData) {
      throw new Error('No archive loaded');
    }

    try {
      this.zip = await JSZip.loadAsync(this.archiveData);
      this.password = password;
      this.hasPassword = false;
    } catch (error) {
      throw new Error('Invalid password');
    }
  }

  async listFiles(): Promise<ArchiveFile[]> {
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

  async extractFile(fileName: string, tempPath: string): Promise<string> {
    if (!this.zip) {
      throw new Error('No archive loaded or password required');
    }

    const zipEntry = this.zip.file(fileName);
    if (!zipEntry) {
      throw new Error('File not found in archive');
    }

    // Extract to temp directory
    const outputPath = `${tempPath}/${fileName}`;
    await extractAllTo(this.archiveData, tempPath, this.password);

    return outputPath;
  }

  async extractVideoFile(fileName: string, tempPath: string): Promise<string> {
    const extractedPath = await this.extractFile(fileName, tempPath);
    
    // Rename .mcgi to .mp4 if needed
    if (fileName.toLowerCase().endsWith('.mcgi')) {
      const mp4Path = extractedPath.replace(/\.mcgi$/i, '.mp4');
      // In a real implementation, you'd rename the file here
      // For now, we'll just return the path with .mp4 extension
      return mp4Path;
    }

    return extractedPath;
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
