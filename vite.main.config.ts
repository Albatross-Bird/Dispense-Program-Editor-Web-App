import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'electron-reload', 'electron-squirrel-startup', 'electron-store'],
    },
  },
});
