import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Con esta configuración, el plugin también generará el archivo manifest.json por ti.
      manifest: {
        name: 'Finanzas - Jader',
        short_name: 'Finanzas',
        description: 'Aplicación de seguimiento de finanzas personales.',
        theme_color: '#ffffff', // Color de la barra de título en la app
        background_color: '#1e293b', // Color de fondo para la pantalla de carga
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable' // Ícono adaptable para diferentes formas en Android
          }
        ]
      }
    })
  ],
})