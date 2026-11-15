import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// No GitHub Pages o app fica em /<nome-do-repositório>/; o workflow define VITE_BASE.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'RetroSync',
        short_name: 'RetroSync',
        description: 'Emulador pessoal de GB, GBC, GBA e SNES com saves no Google Drive',
        lang: 'pt-BR',
        display: 'standalone',
        orientation: 'any',
        background_color: '#14161c',
        theme_color: '#14161c',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Os cores (~11 MB) ficam no cache do app para jogar offline.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
})
