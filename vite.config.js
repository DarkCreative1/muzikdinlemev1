import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
    },
  },
  server: {
    host: '::',
    port: 5173,
    open: true,
    proxy: {
      // Browser navigasyonu /api/dokuman'a geldiğinde React SPA'yı aç;
      // fetch ile yapılan gerçek API isteklerini Fastify'a gönder.
      // IPv6 loopback: köşeli parantez zorunlu -> http://[::1]:PORT
      '/api': {
        target: `http://[::1]:${process.env.PORT || '8001'}`,
        changeOrigin: true,
        bypass(req) {
          if (
            req.url === '/api/dokuman' &&
            String(req.headers.accept || '').includes('text/html')
          ) {
            return '/index.html'
          }
        },
      },
      '/downloads': { target: `http://[::1]:${process.env.PORT || '8001'}`, changeOrigin: true },
    },
  },
  preview: {
    host: '::',
    port: 4173,
  },
})
