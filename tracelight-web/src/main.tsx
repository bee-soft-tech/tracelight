import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDemoServer } from './demoServer';
import './index.css';

// Static live demo (GitHub Pages): stream simulated traffic instead of a real WebSocket backend.
// The `VITE_DEMO` literal is inlined at build time, so this whole branch (and the import) is
// dead-code-eliminated from a normal build. Installed synchronously before App mounts.
if (import.meta.env.VITE_DEMO === 'true') {
  installDemoServer();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
