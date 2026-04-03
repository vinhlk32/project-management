import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  plugins: [react()],
  server: {
    port: 3000,
    // Proxy only active in local dev; disabled when VITE_API_URL is set at build time
    proxy: process.env.VITE_API_URL ? {} : {
      '/api': 'http://localhost:3001',
    },
  },
}));
