import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApiRequest } from './api.js'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const buildDirectory = resolve(projectRoot, 'dist')
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
])

async function serveStatic(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    response.end()
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    response.writeHead(400)
    response.end('Invalid URL')
    return
  }
  const root = resolve(buildDirectory)
  let target = resolve(root, `.${pathname}`)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }
  try {
    const details = await stat(target)
    if (details.isDirectory()) target = resolve(target, 'index.html')
  } catch {
    target = resolve(root, 'index.html')
  }
  try {
    const details = await stat(target)
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(extname(target).toLowerCase()) || 'application/octet-stream',
      'Content-Length': details.size,
      'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Build tidak ditemukan. Jalankan npm run build terlebih dahulu.')
  }
}

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
const server = createServer(async (request, response) => {
  const handled = await handleApiRequest(request, response)
  if (!handled) await serveStatic(request, response)
})

server.listen(port, host, () => {
  console.log(`Pembuat Database CBT berjalan di http://${host}:${port}`)
})

server.on('error', (error) => {
  console.error(`Server gagal dijalankan: ${error.message}`)
  process.exitCode = 1
})
