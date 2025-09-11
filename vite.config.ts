import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // opcional: así podrás abrirlo desde el celular en la misma red
  server: {
    host: true,
    port: 5173
  }
})
