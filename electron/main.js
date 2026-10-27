const { app, BrowserWindow, session, ipcMain, dialog, protocol, net, shell } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow = null;

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';

function resolveIndexHtml() {
  const candidates = [
    path.join(__dirname, '../dist/index.html'),
    path.join(process.resourcesPath || '', 'app/dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return candidates[0];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#020202',
    titleBarStyle: 'hiddenInset',
    title: 'WMPlayer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged && process.env.WMPLAYER_PROD !== '1') {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(resolveIndexHtml());
  }

  // Never let the window navigate away from the app shell — a stray file-drop
  // or an absolute file:// asset path would otherwise replace the UI with raw file text
  const appUrl = app.isPackaged || process.env.WMPLAYER_PROD === '1'
    ? pathToFileURL(resolveIndexHtml()).toString()
    : DEV_URL;
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(appUrl)) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Managed media storage ──────────────────────────────────────────────
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'wmplayer-config.json');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.m2ts', '.mpg', '.mpeg', '.3gp']);
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif', '.avif', '.raw', '.dng', '.cr2', '.nef', '.arw']);

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2));
}

function getStorageDir() {
  const cfg = loadConfig();
  const dir = cfg.storageDir || path.join(app.getPath('videos'), 'WMPlayer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function scanStorageDir(root) {
  let videos = 0, photos = 0, other = 0, usedBytes = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        usedBytes += size;
        if (VIDEO_EXTS.has(ext)) videos++;
        else if (PHOTO_EXTS.has(ext)) photos++;
        else other++;
      }
    }
  };
  walk(root);
  return { videos, photos, other, usedBytes };
}

// Pick a non-colliding destination path inside `dir` for `base`
function uniqueDest(dir, base) {
  let dest = path.join(dir, base);
  let n = 1;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem} ${++n}${ext}`);
  }
  return dest;
}

app.whenReady().then(() => {
  // Inject COOP/COEP headers so SharedArrayBuffer (FFmpeg wasm) works over file://
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  ipcMain.handle('pick-file', async (_e, opts) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      ...opts,
    });
    return result.filePaths;
  });

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('save-dialog', async (_e, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
    return result.filePath || null;
  });

  ipcMain.handle('storage-get-dir', () => getStorageDir());

  ipcMain.handle('storage-set-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose WMPlayer storage folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getStorageDir(),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = result.filePaths[0];
    fs.mkdirSync(dir, { recursive: true });
    const cfg = loadConfig();
    cfg.storageDir = dir;
    saveConfig(cfg);
    return dir;
  });

  ipcMain.handle('storage-stats', () => {
    const dir = getStorageDir();
    const stats = scanStorageDir(dir);
    let disk = { freeBytes: 0, totalBytes: 0 };
    try {
      const s = fs.statfsSync(dir);
      disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    } catch {}
    return { dir, ...stats, ...disk };
  });

  ipcMain.handle('storage-list', () => {
    const dir = getStorageDir();
    const files = [];
    const walk = (d, rel) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(d, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          files.push({ name: entry.name, relPath, kind: 'folder', size: 0, modifiedAt: 0 });
          walk(full, relPath);
        }
        else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const kind = VIDEO_EXTS.has(ext) ? 'video' : PHOTO_EXTS.has(ext) ? 'photo' : 'other';
          let stat = { size: 0, mtimeMs: 0 };
          try { stat = fs.statSync(full); } catch {}
          files.push({ name: entry.name, relPath, kind, size: stat.size, modifiedAt: stat.mtimeMs });
        }
      }
    };
    walk(dir, '');
    return files;
  });

  ipcMain.handle('storage-open-path', async (_e, relPath) => {
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    return shell.openPath(full);
  });

  ipcMain.handle('storage-delete', async (_e, relPath) => {
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir)) return { success: false, error: 'Invalid path' };
    fs.rmSync(full, { recursive: true, force: true });
    return { success: true };
  });

  // Import: MOVE files/folders into storage (rename; falls back to copy+delete
  // only when the source is on a different volume)
  const doImport = (paths, destSubdir) => {
    const dir = getStorageDir();
    // Optional destination subfolder inside storage (drop onto a specific folder)
    let baseDir = dir;
    if (destSubdir) {
      const resolved = path.join(dir, path.normalize(destSubdir).replace(/^(\.\.[/\\])+/, ''));
      if (resolved.startsWith(dir) && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        baseDir = resolved;
      }
    }
    let files = 0, bytes = 0;
    const errors = [];

    const countRecursive = (src) => {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(src)) {
          if (!entry.startsWith('.')) countRecursive(path.join(src, entry));
        }
      } else {
        files++;
        bytes += stat.size;
      }
    };

    for (const p of paths || []) {
      try {
        if (!fs.existsSync(p)) { errors.push(`Not found: ${p}`); continue; }
        const dest = uniqueDest(baseDir, path.basename(p));
        countRecursive(p); // count before move
        try {
          fs.renameSync(p, dest); // instant move on same volume
        } catch (err) {
          if (err.code === 'EXDEV') {
            fs.cpSync(p, dest, { recursive: true });
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            throw err;
          }
        }
      } catch (err) {
        errors.push(`${path.basename(p)}: ${err.message}`);
      }
    }
    return { files, bytes, errors };
  };

  ipcMain.handle('storage-import', async (_e, paths, destSubdir) => doImport(paths, destSubdir));

  // Native folder picker → import selected folders/files into storage
  ipcMain.handle('storage-import-pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose folders or files to import',
      properties: ['openDirectory', 'openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return doImport(result.filePaths);
  });

  ipcMain.handle('storage-mkdir', (_e, name, parentRel) => {
    const dir = getStorageDir();
    let baseDir = dir;
    if (parentRel) {
      const resolved = path.join(dir, path.normalize(parentRel).replace(/^(\.\.[/\\])+/, ''));
      if (resolved.startsWith(dir) && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        baseDir = resolved;
      }
    }
    const safe = path.basename(name).replace(/[/\\]/g, '') || 'New Folder';
    const dest = uniqueDest(baseDir, safe);
    fs.mkdirSync(dest, { recursive: true });
    return path.relative(dir, dest);
  });

  // Rename a storage item (folder or file)
  ipcMain.handle('storage-rename', (_e, srcRel, newName) => {
    const dir = getStorageDir();
    const src = path.join(dir, path.normalize(srcRel || '').replace(/^(\.\.[/\\])+/, ''));
    const safe = path.basename(newName || '').replace(/[/\\]/g, '');
    if (!src.startsWith(dir) || src === dir) return { success: false, error: 'Invalid path' };
    if (!safe) return { success: false, error: 'Invalid name' };
    if (!fs.existsSync(src)) return { success: false, error: 'Source not found' };
    try {
      const dest = path.join(path.dirname(src), safe);
      if (dest === src) return { success: true, relPath: path.relative(dir, src) };
      if (fs.existsSync(dest)) return { success: false, error: 'A file or folder with that name already exists' };
      fs.renameSync(src, dest);
      return { success: true, relPath: path.relative(dir, dest) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Move a storage item (folder or file) into another folder inside storage
  ipcMain.handle('storage-move', (_e, srcRel, destDirRel) => {
    const dir = getStorageDir();
    const clean = (p) => path.join(dir, path.normalize(p || '').replace(/^(\.\.[/\\])+/, ''));
    const src = clean(srcRel);
    const destDir = destDirRel ? clean(destDirRel) : dir;
    if (!src.startsWith(dir) || !destDir.startsWith(dir)) return { success: false, error: 'Invalid path' };
    if (src === dir) return { success: false, error: 'Cannot move the root folder' };
    if (!fs.existsSync(src)) return { success: false, error: 'Source not found' };
    if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) return { success: false, error: 'Destination not found' };
    if (destDir === src || destDir.startsWith(src + path.sep)) return { success: false, error: 'Cannot move a folder into itself' };
    if (path.dirname(src) === destDir) return { success: true, relPath: path.relative(dir, src) };
    try {
      const dest = uniqueDest(destDir, path.basename(src));
      fs.renameSync(src, dest);
      return { success: true, relPath: path.relative(dir, dest) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Move storage items to the macOS Trash (recoverable delete)
  ipcMain.handle('storage-trash', async (_e, relPaths) => {
    const dir = getStorageDir();
    const results = [];
    for (const relPath of Array.isArray(relPaths) ? relPaths : [relPaths]) {
      const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
      if (!full.startsWith(dir) || full === dir || !fs.existsSync(full)) {
        results.push({ relPath, success: false, error: 'Not found' });
        continue;
      }
      try { await shell.trashItem(full); results.push({ relPath, success: true }); }
      catch (err) { results.push({ relPath, success: false, error: err.message }); }
    }
    return { success: results.every(r => r.success), results };
  });

  // Open a storage file in VLC (for codecs Chromium can't decode)
  ipcMain.handle('storage-open-vlc', async (_e, relPath) => {
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir) || !fs.existsSync(full)) return { success: false, error: 'Not found' };
    try {
      if (fs.existsSync('/Applications/VLC.app')) {
        execFile('/usr/bin/open', ['-a', 'VLC', full]);
        return { success: true };
      }
      const err = await shell.openPath(full); // fall back to default player
      return { success: !err, error: err || 'VLC not installed — opened with default player' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Embedded VLC engine (vlcbridge) ─────────────────────────────────
  // Streams scaled RGBA frames from libVLC to the renderer for codecs
  // Chromium can't decode (HEVC/MKV/AVI). Audio stays in libVLC/CoreAudio.
  const { spawn } = require('child_process');
  let vlcProc = null;
  let vlcBuf = Buffer.alloc(0);

  const vlcBridgePath = () => {
    const src = path.join(__dirname, 'vlcbridge');
    const dst = path.join(app.getPath('userData'), 'vlcbridge');
    if (fs.existsSync(src)) {
      try {
        if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
          fs.copyFileSync(src, dst);
          fs.chmodSync(dst, 0o755);
        }
        return dst;
      } catch {}
    }
    return null;
  };

  const vlcStop = () => {
    if (vlcProc) {
      try { vlcProc.stdin.write('stop\n'); } catch {}
      try { vlcProc.kill('SIGKILL'); } catch {}
      vlcProc = null;
      vlcBuf = Buffer.alloc(0);
    }
  };

  ipcMain.handle('vlc-start', (_e, relPath, width) => {
    vlcStop();
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir) || !fs.existsSync(full)) return { success: false, error: 'Not found' };
    const bridge = vlcBridgePath();
    if (!bridge) return { success: false, error: 'vlcbridge binary missing' };
    if (!fs.existsSync('/Applications/VLC.app')) return { success: false, error: 'VLC not installed' };
    try {
      vlcProc = spawn(bridge, [full, String(width || 960)], { stdio: ['pipe', 'pipe', 'ignore'] });
      vlcProc.stdout.on('data', (chunk) => {
        vlcBuf = Buffer.concat([vlcBuf, chunk]);
        while (vlcBuf.length >= 12) {
          if (vlcBuf.readUInt32BE(0) !== 0x46524d30) { // 'FRM0'
            const idx = vlcBuf.indexOf(0x46524d30, 1, 'hex') !== -1 ? vlcBuf.indexOf(Buffer.from('FRM0')) : -1;
            if (idx === -1) { vlcBuf = vlcBuf.subarray(vlcBuf.length - 11); return; }
            vlcBuf = vlcBuf.subarray(idx);
          }
          const w = vlcBuf.readUInt32LE(4), h = vlcBuf.readUInt32LE(8);
          const need = 12 + w * h * 4;
          if (w === 0 || h === 0 || w > 8192 || h > 8192) { vlcBuf = Buffer.alloc(0); return; }
          if (vlcBuf.length < need) return;
          const payload = vlcBuf.subarray(12, need);
          mainWindow?.webContents.send('vlc-frame', { w, h, data: payload });
          vlcBuf = vlcBuf.subarray(need);
        }
      });
      vlcProc.on('exit', () => {
        vlcProc = null;
        mainWindow?.webContents.send('vlc-ended');
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('vlc-ctl', (_e, cmd) => {
    if (vlcProc) { try { vlcProc.stdin.write(String(cmd) + '\n'); return { success: true }; } catch (err) { return { success: false, error: err.message }; } }
    return { success: false, error: 'not running' };
  });
  ipcMain.handle('vlc-stop', () => { vlcStop(); return { success: true }; });
  app.on('before-quit', vlcStop);

  // Thumbnail generation via macOS QuickLook — handles HEVC/AVI/MKV natively.
  // Cached under userData/thumbs; served as media://thumb/<hash>
  const thumbsDir = path.join(app.getPath('userData'), 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });

  ipcMain.handle('storage-thumbnail', (_e, relPath) => {
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir) || !fs.existsSync(full)) return null;
    const key = crypto.createHash('md5').update(relPath + ':' + fs.statSync(full).mtimeMs).digest('hex');
    const dest = path.join(thumbsDir, key + '.png');
    if (fs.existsSync(dest)) return `media://thumb/${key}.png`;
    return new Promise((resolve) => {
      execFile('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', thumbsDir, full], { timeout: 30000 }, () => {
        // qlmanage names output <basename>.png — may include extension
        const produced = path.join(thumbsDir, path.basename(full) + '.png');
        try {
          if (fs.existsSync(produced)) fs.renameSync(produced, dest);
        } catch {}
        resolve(fs.existsSync(dest) ? `media://thumb/${key}.png` : null);
      });
    });
  });

  // Native transcode via macOS avconvert (handles HEVC fast, no ffmpeg needed).
  // Cached under userData/transcoded; served as media://transcoded/<hash>
  const transcodeDir = path.join(app.getPath('userData'), 'transcoded');
  fs.mkdirSync(transcodeDir, { recursive: true });
  const transcodeRunning = new Map();

  ipcMain.handle('storage-transcode', (_e, relPath) => {
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir) || !fs.existsSync(full)) return { error: 'not found' };
    const key = crypto.createHash('md5').update(relPath + ':' + fs.statSync(full).mtimeMs).digest('hex');
    const dest = path.join(transcodeDir, key + '.mp4');
    const url = `media://transcoded/${key}.mp4`;
    if (fs.existsSync(dest)) return { url, done: true };
    if (transcodeRunning.has(key)) return { url, pending: true };

    const VLC = '/Applications/VLC.app/Contents/MacOS/VLC';
    const finish = (ok) => {
      transcodeRunning.delete(key);
      try { mainWindow?.webContents.send('transcode-done', { key, ok: ok && fs.existsSync(dest) }); } catch {}
    };
    const moveTmp = () => {
      try { if (fs.existsSync(dest + '.tmp.mp4')) { fs.renameSync(dest + '.tmp.mp4', dest); return true; } } catch {}
      return false;
    };
    const cleanupTmp = () => { try { fs.rmSync(dest + '.tmp.mp4', { force: true }); } catch {} };

    const runVlcTranscode = () => {
      // Full transcode to H.264+AAC in mp4 — decodes anything VLC can read
      execFile(VLC, [
        '-I', 'dummy', '--no-video-title-show', full,
        `--sout=#transcode{vcodec=h264,vb=6000,acodec=aac,ab=160,channels=2}:standard{access=file,mux=mp4,dst=${dest}.tmp.mp4}`,
        'vlc://quit',
      ], { timeout: 0 }, (err) => {
        cleanupTmp; // no-op marker
        if (!err && moveTmp()) finish(true);
        else { cleanupTmp(); finish(false); }
      });
    };

    const runVlcRemux = () => {
      // Container copy (fast) — only works if codec is already h264/aac-friendly
      execFile(VLC, [
        '-I', 'dummy', '--no-video-title-show', full,
        `--sout=#standard{access=file,mux=mp4,dst=${dest}.tmp.mp4}`,
        'vlc://quit',
      ], { timeout: 0 }, (err) => {
        if (!err && moveTmp()) finish(true);
        else { cleanupTmp(); runVlcTranscode(); }
      });
    };

    // 1) avconvert (fast native path) → 2) VLC remux → 3) VLC transcode
    const child = execFile('/usr/bin/avconvert', [
      '-p', 'PresetAppleM4V1080pHD', '-s', full, '-o', dest + '.tmp.mp4',
    ], { timeout: 0 }, (err) => {
      if (!err && moveTmp()) { finish(true); return; }
      cleanupTmp();
      if (fs.existsSync(VLC)) runVlcRemux();
      else finish(false);
    });
    transcodeRunning.set(key, child);
    return { url, pending: true };
  });

  ipcMain.handle('storage-save-file', async (_e, relPath, data) => {
    const dir = getStorageDir();
    const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const dest = path.join(dir, safe);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(data));
    return dest;
  });

  // media://local/<relPath> streams files from the storage dir (supports range requests)
  protocol.handle('media', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const thumbs = path.join(app.getPath('userData'), 'thumbs');
    if (rel.startsWith('transcoded/')) {
      const td = path.join(app.getPath('userData'), 'transcoded');
      const tf = path.join(td, path.basename(rel));
      if (fs.existsSync(tf)) return net.fetch(pathToFileURL(tf).toString(), { headers: req.headers });
      return new Response('Not ready', { status: 404 });
    }
    if (rel.startsWith('thumb/')) {
      const tf = path.join(thumbs, path.basename(rel));
      if (fs.existsSync(tf)) return net.fetch(pathToFileURL(tf).toString());
      return new Response('Not found', { status: 404 });
    }
    const dir = getStorageDir();
    const full = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(dir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(full).toString(), { headers: req.headers });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
