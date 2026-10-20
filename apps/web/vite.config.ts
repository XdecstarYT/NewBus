import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL ?? 'http://localhost:3000';

const proxy = {
  '/api': { target: API, changeOrigin: false },
  '/ws': { target: API.replace('http', 'ws'), ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` needs the same proxy, or every API call 404s
  preview: { port: 4173, proxy },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
