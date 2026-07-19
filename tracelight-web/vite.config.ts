import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Consume the component straight from source so JSX in the workspace package is
// transformed by @vitejs/plugin-react (it would be skipped if resolved from node_modules).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: 'tracelight-react/styles.css',
        replacement: resolve(__dirname, '../tracelight-react/src/styles.css'),
      },
      {
        find: 'tracelight-react',
        replacement: resolve(__dirname, '../tracelight-react/src/index.ts'),
      },
    ],
  },
  server: {
    port: 5173,
  },
});
