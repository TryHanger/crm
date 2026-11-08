import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // listen on 0.0.0.0 / all interfaces so barberhouse.localhost works
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        headers: {
          'X-Forwarded-Proto': 'http',
        },
      },
    },
  },
});
