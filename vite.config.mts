import { defineConfig } from 'vite';

// base './' so the built app loads from disk inside Electron (file://).
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
});
