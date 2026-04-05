import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import fs from 'fs';

// Plugin to copy libarchive.js worker files
function copyLibArchivePlugin() {
  return {
    name: 'copy-libarchive',
    configureServer(server: any) {
      // Serve libarchive.js files in dev mode
      server.middlewares.use('/libarchive.js', (req: any, res: any, next: any) => {
        const filePath = req.url?.replace('/libarchive.js', '');
        const fullPath = path.join(__dirname, 'node_modules/libarchive.js/dist', filePath || '');
        
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          const ext = path.extname(fullPath);
          const contentType = ext === '.wasm' ? 'application/wasm' : 
                           ext === '.js' ? 'application/javascript' : 'text/plain';
          res.setHeader('Content-Type', contentType);
          res.end(content);
        } else {
          next();
        }
      });
    },
    writeBundle() {
      const sourceDir = path.resolve(__dirname, 'node_modules/libarchive.js/dist');
      const destDir = path.resolve(__dirname, 'dist/libarchive.js');
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Recursively copy files (not directories as files)
      const copyRecursive = (src: string, dest: string) => {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const file of files) {
            copyRecursive(path.join(src, file), path.join(dest, file));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      };
      
      copyRecursive(sourceDir, destDir);
      console.log('Copied libarchive.js worker files to dist');
    }
  };
}

// Plugin to copy 7z-wasm files
function copy7zWasmPlugin() {
  return {
    name: 'copy-7z-wasm',
    configureServer(server: any) {
      // Serve 7z-wasm files in dev mode - use earlier middleware position
      server.middlewares.use('/7z-wasm/', (req: any, res: any, next: any) => {
        // req.url is relative to mount point, so it will be like '/7zz.wasm'
        const urlPath = (req.url || '').split('?')[0]; // Remove query params
        const cleanPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fullPath = path.join(__dirname, 'node_modules/7z-wasm', cleanPath);
        
        console.log('7z-wasm request:', req.url, '->', fullPath, 'exists:', fs.existsSync(fullPath));
        
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath);
          const ext = path.extname(fullPath);
          const contentType = ext === '.wasm' ? 'application/wasm' : 
                           ext === '.js' ? 'application/javascript' : 'text/plain';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.end(content);
        } else {
          next();
        }
      });
    },
    writeBundle() {
      const sourceDir = path.resolve(__dirname, 'node_modules/7z-wasm');
      const destDir = path.resolve(__dirname, 'dist/7z-wasm');
      
      console.log('Copying 7z-wasm files...');
      console.log('Source dir:', sourceDir);
      console.log('Dest dir:', destDir);
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        console.log('Created dest dir');
      }
      
      // Copy main JS file
      const files = ['7zz.es6.js', '7zz.wasm'];
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dest = path.join(destDir, file);
        console.log(`Checking ${file}: exists=${fs.existsSync(src)}, src=${src}`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`Copied ${file} to ${dest}`);
        } else {
          console.error(`Source file not found: ${src}`);
        }
      }
      
      // Verify files were copied
      const copiedFiles = fs.readdirSync(destDir);
      console.log('Files in dest dir:', copiedFiles);
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), copyLibArchivePlugin(), copy7zWasmPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      target: 'esnext',
      // 7z-wasm is loaded dynamically via script injection, not bundled
    },
  };
});
