async function apiRequest(path, options) {
  let response
  try {
    response = await fetch(`/api/${path}`, options)
  } catch (error) {
    throw new Error(`Server database tidak dapat dijangkau. Jalankan aplikasi dengan npm run dev atau npm start. Detail: ${error.message}`)
  }
  if (!response.ok) {
    let details = ''
    try {
      details = (await response.json()).error || ''
    } catch {
      details = response.statusText
    }
    throw new Error(details || `Server database mengembalikan HTTP ${response.status}.`)
  }
  return response
}

let workspaceSaveQueue = Promise.resolve()
let storageWarning = ''

async function removeLegacyDatabase() {
  if (!globalThis.indexedDB?.databases) return true
  const databaseName = 'pembuat-database-cbt-assets'
  const databases = await indexedDB.databases()
  if (!databases.some((database) => database.name === databaseName)) return true
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    request.onblocked = () => resolve(false)
  })
}

export function getStorageWarning() {
  return storageWarning
}

function normalizeWorkspace(data) {
  return {
    categories: Array.isArray(data?.categories) ? data.categories : [],
    packages: Array.isArray(data?.packages) ? data.packages : [],
    questions: Array.isArray(data?.questions) ? data.questions : [],
    materials: Array.isArray(data?.materials) ? data.materials : [],
  }
}

async function readLegacyBrowserData() {
  let data = null
  const legacyJson = localStorage.getItem('pembuat-database-cbt-v1')
  if (legacyJson) {
    try {
      data = normalizeWorkspace(JSON.parse(legacyJson))
    } catch (error) {
      throw new Error(`Data lama di browser tidak dapat dimigrasikan: ${error.message}`)
    }
  }

  const legacyDatabaseName = 'pembuat-database-cbt-assets'
  if (!globalThis.indexedDB?.databases) return { data, assets: [] }
  const databases = await indexedDB.databases()
  if (!databases.some((database) => database.name === legacyDatabaseName)) return { data, assets: [] }

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(legacyDatabaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(`Data browser lama tidak dapat dibaca: ${request.error?.message || 'kesalahan IndexedDB.'}`))
    request.onblocked = () => reject(new Error('Data browser lama sedang dipakai tab lain. Tutup tab aplikasi lama agar migrasi ke server database dapat dilanjutkan.'))
  })
  try {
    const storeNames = [...database.objectStoreNames]
    if (!storeNames.length) return { data, assets: [] }
    const transaction = database.transaction(storeNames, 'readonly')
    const readStore = (storeName, method, value) => new Promise((resolve, reject) => {
      if (!storeNames.includes(storeName)) {
        resolve(undefined)
        return
      }
      const request = method === 'getAll'
        ? transaction.objectStore(storeName).getAll()
        : transaction.objectStore(storeName).get(value)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error(`Data lama pada ${storeName} gagal dibaca.`))
    })
    const [workspace, assets] = await Promise.all([
      readStore('workspace', 'get', 'pembuat-database-cbt-v1'),
      readStore('images', 'getAll'),
    ])
    if (workspace?.data) data = normalizeWorkspace(workspace.data)
    return { data, assets: Array.isArray(assets) ? assets : [] }
  } finally {
    database.close()
  }
}

export async function loadImageAssets() {
  const response = await apiRequest('images')
  const { images } = await response.json()
  return Promise.all(images.map(async (metadata) => {
    const imageResponse = await apiRequest(`image?path=${encodeURIComponent(metadata.path)}`)
    const blob = await imageResponse.blob()
    return { ...metadata, blob, size: blob.size }
  }))
}

export async function saveImageAssets(assets) {
  for (const asset of assets) {
    await apiRequest(`image?path=${encodeURIComponent(asset.path)}&filename=${encodeURIComponent(asset.filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': asset.blob.type || 'image/webp' },
      body: asset.blob,
    })
  }
}

export async function loadWorkspace() {
  storageWarning = ''
  const response = await apiRequest('workspace')
  const { data } = await response.json()
  if (data) return normalizeWorkspace(data)

  const legacy = await readLegacyBrowserData()
  if (legacy.assets.length) await saveImageAssets(legacy.assets)
  if (legacy.data) await saveWorkspace(legacy.data)
  if (legacy.data || legacy.assets.length) {
    localStorage.removeItem('pembuat-database-cbt-v1')
    const removed = await removeLegacyDatabase()
    if (!removed) {
      storageWarning = 'Data telah dipindahkan ke SQLite server, tetapi database browser lama masih dipakai tab lain. Tutup tab aplikasi lama untuk menghapus salinannya.'
    }
    return normalizeWorkspace(legacy.data)
  }
  return normalizeWorkspace(data)
}

export async function saveWorkspace(data) {
  const save = workspaceSaveQueue.then(() => apiRequest('workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeWorkspace(data)),
    }),
  )
  workspaceSaveQueue = save.catch(() => {})
  await save
}
