import React, { useState } from 'react';
import { X, Download, Link2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { downloadFromMegaAndImport, MegaDownloadProgress, parseMegaLink } from '../lib/mega';

interface MegaImportModalProps {
  folderId: string | null; // null = create new folder
  onClose: () => void;
  onSuccess: (folderId: string, count: number) => void;
}

export function MegaImportModal({ folderId, onClose, onSuccess }: MegaImportModalProps) {
  const [megaUrl, setMegaUrl] = useState('');
  const [progress, setProgress] = useState<MegaDownloadProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  });
  const [isValidLink, setIsValidLink] = useState(false);

  const handleUrlChange = (url: string) => {
    setMegaUrl(url);
    const parsed = parseMegaLink(url);
    setIsValidLink(!!parsed && !parsed.isFolder);
  };

  const handleDownload = async () => {
    if (!isValidLink) return;

    setProgress({
      status: 'downloading',
      progress: 0,
      message: 'Starting download...'
    });

    const result = await downloadFromMegaAndImport(
      megaUrl,
      folderId,
      setProgress
    );

    if (result.success && result.folderId) {
      onSuccess(result.folderId, result.count || 0);
    }
  };

  const isProcessing = progress.status === 'downloading' || 
                         progress.status === 'extracting' || 
                         progress.status === 'importing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg mx-4 p-6 rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-white">Import from MEGA</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/70" />
          </button>
        </div>

        {/* Description */}
        <p className="text-zinc-400 mb-6">
          Paste a MEGA file link to download and import videos directly to your gallery. 
          Supports public file links (e.g., https://mega.nz/file/...).
        </p>

        {/* URL Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-white/80 mb-2">
            MEGA Link
          </label>
          <div className="relative">
            <Link2 size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={megaUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://mega.nz/file/..."
              disabled={isProcessing}
              className="w-full pl-10 pr-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
            />
          </div>
          {megaUrl && !isValidLink && (
            <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
              <AlertCircle size={14} />
              Invalid MEGA link format
            </p>
          )}
          {megaUrl && isValidLink && (
            <p className="mt-2 text-sm text-emerald-400 flex items-center gap-1">
              <CheckCircle size={14} />
              Valid MEGA file link
            </p>
          )}
        </div>

        {/* Progress Display */}
        {progress.status !== 'idle' && progress.status !== 'error' && (
          <div className="mb-6 p-4 bg-zinc-900/50 rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              {progress.status === 'complete' ? (
                <CheckCircle size={20} className="text-emerald-400" />
              ) : (
                <Loader2 size={20} className="text-emerald-400 animate-spin" />
              )}
              <span className="text-white font-medium">{progress.message}</span>
            </div>
            
            {/* Progress Bar */}
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-zinc-500 text-right">
              {progress.progress}%
            </p>
          </div>
        )}

        {/* Error Display */}
        {progress.status === 'error' && progress.error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle size={18} />
              <span className="font-medium">Download Failed</span>
            </div>
            <p className="mt-1 text-sm text-red-300">{progress.error}</p>
          </div>
        )}

        {/* Success Display */}
        {progress.status === 'complete' && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle size={18} />
              <span className="font-medium">Import Complete!</span>
            </div>
            <p className="mt-1 text-sm text-emerald-300">
              {progress.message}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors"
          >
            {progress.status === 'complete' ? 'Close' : 'Cancel'}
          </button>
          
          {progress.status !== 'complete' && (
            <button
              onClick={handleDownload}
              disabled={!isValidLink || isProcessing}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:opacity-50 text-white font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Download size={18} />
                  Download & Import
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
