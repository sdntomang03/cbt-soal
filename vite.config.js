import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleApiRequest } from './server/api.js'

function localDatabaseApi() {
  const middleware = (request, response, next) => {
    if (!request.url?.startsWith('/api/')) {
      next()
      return
    }
    handleApiRequest(request, response).catch((error) => {
      console.error('API database lokal gagal:', error)
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: `Server database gagal: ${error.message}` }))
      }
    })
  }
  return {
    name: 'local-sqlite-database-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), localDatabaseApi()],
})
