import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import fs from 'fs';

// Plugin to copy libarchive.js worker files
function copyLibArchivePlugin() {
  return {
    name: 'copy-libarchive',
    writeBundle() {
      const sourceDir = path.resolve(__dirname, 'node_modules/libarchive.js/dist');
      const destDir = path.resolve(__dirname, 'dist/libarchive.js');
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const files = fs.readdirSync(sourceDir);
      for (const file of files) {
        fs.copyFileSync(
          path.join(sourceDir, file),
          path.join(destDir, file)
        );
      }
      console.log('Copied libarchive.js worker files to dist');
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), copyLibArchivePlugin()],
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
    },
  };
});
