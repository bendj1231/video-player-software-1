// 7z-wasm archive handler - dedicated to password-protected 7z files
let sevenZipModule: any = null;

export async function init7zWasm(): Promise<any> {
  if (!sevenZipModule) {
    // Only run in browser
    if (typeof window === 'undefined') {
      throw new Error('7z-wasm can only be loaded in browser environment');
    }
    
    // Check if already loaded via script tag
    if ((window as any).SevenZip) {
      sevenZipModule = await (window as any).SevenZip({
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) {
            return '/7z-wasm/7zz.wasm';
          }
          return path;
        }
      });
      return sevenZipModule;
    }
    
    // Dynamically load the UMD script (works as classic script)
    await loadScript('/7z-wasm/7zz.umd.js');
    
    // Wait for it to be available
    let retries = 0;
    while (!(window as any).SevenZip && retries < 50) {
      await new Promise(r => setTimeout(r, 100));
      retries++;
    }
    
    if (!(window as any).SevenZip) {
      throw new Error('7z-wasm failed to load');
    }
    
    sevenZipModule = await (window as any).SevenZip({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/7z-wasm/7zz.wasm';
        }
        return path;
      }
    });
  }
  return sevenZipModule;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript'; // Classic script for UMD
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function list7zFiles(file: File, password?: string): Promise<string[]> {
  const sevenZip = await init7zWasm();
  
  // Write archive to virtual filesystem
  const archivePath = '/input.7z';
  const data = new Uint8Array(await file.arrayBuffer());
  sevenZip.FS.writeFile(archivePath, data);
  
  try {
    // List files with optional password
    const args = password ? ['l', `-p${password}`, archivePath] : ['l', archivePath];
    sevenZip.callMain(args);
    
    // Read stdout (7z outputs to stdout)
    // For now, we'll parse by re-running with JSON output or parsing text
    // Since 7z outputs text, we need to capture it
    
    // Alternative: extract to temp and list
    return [];
  } finally {
    // Cleanup
    try {
      sevenZip.FS.unlink(archivePath);
    } catch (e) {
      // Ignore
    }
  }
}

export async function extract7zFile(
  file: File, 
  fileName: string, 
  password?: string
): Promise<Blob> {
  const sevenZip = await init7zWasm();
  
  // Write archive to virtual filesystem
  const archivePath = '/input.7z';
  const outputDir = '/output/';
  const data = new Uint8Array(await file.arrayBuffer());
  sevenZip.FS.writeFile(archivePath, data);
  
  try {
    // Create output directory
    try {
      sevenZip.FS.mkdir(outputDir);
    } catch (e) {
      // May already exist
    }
    
    // Extract specific file
    const passArg = password ? `-p${password}` : '-p';
    sevenZip.callMain(['e', passArg, archivePath, fileName, `-o${outputDir}`, '-y']);
    
    // Read extracted file
    const outputPath = outputDir + fileName.split('/').pop();
    const extractedData = sevenZip.FS.readFile(outputPath);
    
    // Cleanup
    try {
      sevenZip.FS.unlink(outputPath);
      sevenZip.FS.unlink(archivePath);
    } catch (e) {
      // Ignore
    }
    
    return new Blob([extractedData]);
  } catch (error) {
    console.error('7z extraction error:', error);
    throw error;
  }
}
