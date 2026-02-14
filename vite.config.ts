import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-recharts': ['recharts'],
          'vendor-router': ['react-router-dom'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/nhl': {
        target: 'https://api-web.nhle.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nhl/, ''),
        secure: false,
        followRedirects: true,
      },
      '/api/search': {
        target: 'https://search.d3.nhle.com/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search/, ''),
        secure: false,
      },
      '/api/stats': {
        target: 'https://api.nhle.com/stats/rest/en',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/stats/, ''),
        secure: false,
      },
    },
  },
})
