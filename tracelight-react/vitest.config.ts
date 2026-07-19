import { defineConfig } from 'vitest/config';

// The tested modules (gl/playback, gl/spacing, gl/geometry) are pure — no DOM/WebGL needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
