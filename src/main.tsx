import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Error boundary for iPad stability
window.onerror = function(msg, url, line) {
  console.error('Global error:', msg, url, line);
  return true;
};

window.onunhandledrejection = function(event) {
  console.error('Unhandled rejection:', event.reason);
  event.preventDefault();
};

// iPad memory management
if (/iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  // Reduce memory pressure
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    navigator.storage.estimate().then(estimate => {
      if (estimate.usage && estimate.usage > 500 * 1024 * 1024) {
        console.warn('High memory usage on iPad:', estimate.usage);
      }
    });
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);

// Render without StrictMode for iPad stability
root.render(<App />);
