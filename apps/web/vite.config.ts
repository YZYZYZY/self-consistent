import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: '微行动教练',
        short_name: '微行动',
        description: 'AI 情绪行动教练 PWA',
        theme_color: '#f59e0b',
        background_color: '#f7f5ef',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/pwa.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@tanstack') || id.includes('dexie') || id.includes('zustand')) return 'vendor-data'
          if (id.includes('framer-motion') || id.includes('lucide-react')) return 'vendor-ui'
          if (id.includes('@capacitor')) return 'vendor-capacitor'
          return 'vendor'
        },
      },
    },
  },
})
