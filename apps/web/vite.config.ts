import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL ?? 'http://localhost:3000';
// Netlify build: GAME_SERVER_URL is the game server (e.g. https://digital-workforce.onrender.com).
// Pages and /api go through Netlify; the live connection goes straight to the server.
const GAME = (process.env.GAME_SERVER_URL ?? '').trim().replace(/\/$/, '');
const WS_URL = GAME ? `${GAME.replace(/^http/, 'ws')}/ws` : '';

const proxy = {
  '/api': { target: API, changeOrigin: false },
  '/ws': { target: API.replace('http', 'ws'), ws: true },
};

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_WS_URL': JSON.stringify(WS_URL) },
  server: { port: 5173, proxy },
  // `vite preview` needs the same proxy, or every API call 404s
  preview: { port: 4173, proxy },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
