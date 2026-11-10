import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api requests go to the Node API during development
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
