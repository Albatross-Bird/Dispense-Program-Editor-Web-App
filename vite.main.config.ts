import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // Only 'electron' needs to be external — it's provided by the runtime.
      // 'electron-reload' is dev-only, guarded by MAIN_WINDOW_VITE_DEV_SERVER_URL
      // (dead code in production builds), so it stays external safely.
      // All other runtime deps are bundled here because electron-forge/vite does
      // NOT package node_modules into the asar — only .vite/ output is included.
      external: ['electron', 'electron-reload'],
    },
  },
});
