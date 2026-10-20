import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local play: the API runs on :8888 (npm run dev starts both). On Netlify, /api is a function.
const API = process.env.API_URL ?? 'http://localhost:8888';
const proxy = { '/api': { target: API, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
