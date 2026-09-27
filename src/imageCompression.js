const MAX_SOURCE_SIZE = 10 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1920
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Browser gagal mengompres gambar. Coba gunakan gambar lain.'))
        return
      }
      if (blob.type !== 'image/webp') {
        reject(new Error('Browser ini tidak mendukung konversi gambar ke WebP. Perbarui browser untuk mengunggah gambar.'))
        return
      }
      resolve(blob)
    }, 'image/webp', quality)
  })
}

export async function compressImageToWebp(source) {
  if (!(source instanceof Blob) || !SUPPORTED_IMAGE_TYPES.has(source.type)) {
    throw new Error('File yang dipilih bukan gambar yang didukung.')
  }
  if (source.size > MAX_SOURCE_SIZE) throw new Error('Ukuran gambar maksimal 10 MB per file.')

  let bitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch (error) {
    throw new Error(`Gambar tidak dapat dibaca: ${error.message}`)
  }

  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser gagal menyiapkan kompresi gambar.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    let compressed
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      compressed = await canvasBlob(canvas, quality)
      if (compressed.size < source.size || quality === 0.46) break
    }
    return compressed
  } finally {
    bitmap.close()
  }
}
