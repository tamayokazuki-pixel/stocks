import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: { charting: ['recharts'] } } },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
