import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react(), VitePWA({ registerType: 'autoUpdate', includeAssets: ['manifest.webmanifest'], manifest: false, workbox: { navigateFallback: '/index.html' } })],
})
