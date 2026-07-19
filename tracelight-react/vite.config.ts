import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Library build (for publishing). Local dev (tracelight-web) consumes ./src directly
// via a Vite alias, so this is only needed when packaging the component.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'tracelight-react',
    },
    rollupOptions: {
      // Peer deps + pixi.js stay external (consumers install them via deps/peerDeps); elkjs is
      // bundled because it's imported as a Vite `?worker`, which non-Vite consumers can't resolve.
      external: ['react', 'react-dom', 'react/jsx-runtime', 'pixi.js'],
    },
  },
});
