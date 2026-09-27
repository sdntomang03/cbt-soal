import {
  listImages,
  readImage,
  readWorkspace,
  writeImage,
  writeWorkspace,
} from './sqliteStore.js'

const MAX_WORKSPACE_SIZE = 50 * 1024 * 1024
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const IMAGE_TYPES = new Map([
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
])

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function readBody(request, maxSize) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxSize) {
      const error = new Error(`Ukuran data melewati batas ${Math.floor(maxSize / 1024 / 1024)} MB.`)
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function handleApiRequest(request, response) {
  const url = new URL(request.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      await readWorkspace()
      sendJson(response, 200, { ok: true })
      return true
    }
    if (url.pathname === '/api/workspace' && request.method === 'GET') {
      sendJson(response, 200, { data: await readWorkspace() })
      return true
    }
    if (url.pathname === '/api/workspace' && request.method === 'PUT') {
      let data
      try {
        data = JSON.parse((await readBody(request, MAX_WORKSPACE_SIZE)).toString('utf8'))
      } catch (error) {
        if (error.status) throw error
        const invalid = new Error(`Data workspace bukan JSON yang valid: ${error.message}`)
        invalid.status = 400
        throw invalid
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || !['categories', 'packages', 'questions', 'materials'].every((key) => Array.isArray(data[key]))) {
        const invalid = new Error('Data workspace harus berisi categories, packages, questions, dan materials.')
        invalid.status = 400
        throw invalid
      }
      await writeWorkspace(data)
      sendJson(response, 200, { ok: true })
      return true
    }
    if (url.pathname === '/api/images' && request.method === 'GET') {
      sendJson(response, 200, { images: await listImages() })
      return true
    }
    if (url.pathname === '/api/image' && request.method === 'GET') {
      const path = url.searchParams.get('path') || ''
      const image = await readImage(path)
      if (!image) {
        sendJson(response, 404, { error: `Gambar "${path}" tidak ditemukan dalam database.` })
        return true
      }
      response.writeHead(200, {
        'Content-Type': image.type,
        'Content-Length': image.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(image.blob)
      return true
    }
    if (url.pathname === '/api/image' && request.method === 'PUT') {
      const path = url.searchParams.get('path') || ''
      const filename = url.searchParams.get('filename') || ''
      const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
      const contentType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      if (!/^images\/[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif)$/.test(path)
        || !/^[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif)$/i.test(filename)
        || !path.toLowerCase().endsWith(extension)
        || IMAGE_TYPES.get(extension) !== contentType) {
        const invalid = new Error('Path, nama, atau format gambar tidak valid.')
        invalid.status = 400
        throw invalid
      }
      const content = await readBody(request, MAX_IMAGE_SIZE)
      if (!content.length) {
        const invalid = new Error('File gambar kosong.')
        invalid.status = 400
        throw invalid
      }
      await writeImage({ path, filename, type: contentType, content })
      sendJson(response, 201, { ok: true, path, size: content.length })
      return true
    }
    sendJson(response, 404, { error: 'Endpoint API tidak ditemukan.' })
    return true
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status >= 500) console.error('API database lokal gagal:', error)
    if (!response.headersSent) sendJson(response, status, { error: error.message || 'Permintaan database gagal.' })
    else response.destroy(error)
    return true
  }
}
