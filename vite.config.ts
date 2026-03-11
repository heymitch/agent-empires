import { defineConfig } from 'vite'
import { resolve } from 'path'
import { DEFAULTS } from './shared/defaults'

const HOST = DEFAULTS.HOST
const clientPort = parseInt(process.env.AGENT_EMPIRES_CLIENT_PORT ?? String(DEFAULTS.CLIENT_PORT), 10)
const serverPort = parseInt(process.env.AGENT_EMPIRES_PORT ?? String(DEFAULTS.SERVER_PORT), 10)
const serverOrigin = `http://${HOST}:${serverPort}`
const serverWs = `ws://${HOST}:${serverPort}`

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  define: {
    __VIBECRAFT_DEFAULT_PORT__: serverPort,
  },
  server: {
    host: HOST,
    port: clientPort,
    strictPort: true,
    proxy: {
      '/ws': {
        target: serverWs,
        ws: true,
      },
      '/api': {
        target: serverOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
})
