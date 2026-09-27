import DOMPurify from 'dompurify'
import { compressImageToWebp } from './imageCompression'
import { createQuestion, makeId, OPTION_QUESTION_TYPES, QUESTION_TYPES } from './model'

const MAX_WORKBOOK_SIZE = 25 * 1024 * 1024
const MAX_WORKSHEET_ROWS = 1000
const MAX_EXTRACTED_IMAGE_SIZE = 50 * 1024 * 1024
const OPTION_LETTERS = 'ABCDEFGH'
const TYPES = new Set(QUESTION_TYPES.map((item) => item.value))
const TYPE_LABELS = new Map(QUESTION_TYPES.map((item) => [item.label.toLowerCase(), item.value]))
const HEADERS = [
  'type',
  'question',
  'explanation',
  ...OPTION_LETTERS.split('').map((letter) => `option_${letter.toLowerCase()}`),
  'correct_answers',
  ...OPTION_LETTERS.split('').map((letter) => `weight_${letter.toLowerCase()}`),
  'matching_pairs',
]
const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return ''
  return String(cell.text ?? cell.value).trim()
}

function htmlText(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  const html = /<\/?[a-z][^>]*>/i.test(source)
    ? source
    : `<p>${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`
  return DOMPurify.sanitize(html)
}

function appendImages(text, imagePaths) {
  const content = htmlText(text)
  const images = imagePaths.map((path) => `<p><img src="${path}" alt="Gambar soal" /></p>`).join('')
  return `${content}${images}`
}

function splitValues(value) {
  return String(value || '')
    .split(/[,;，；\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
}

function normalizeType(value, rowNumber) {
  const source = String(value || 'single_choice').trim().toLowerCase()
  const type = TYPES.has(source) ? source : TYPE_LABELS.get(source)
  if (!type) throw new Error(`Baris ${rowNumber}: tipe soal "${source}" tidak dikenali.`)
  return type
}

function parseMatchingPairs(value, rowNumber, questionId) {
  let pairs
  try {
    pairs = JSON.parse(value)
  } catch {
    throw new Error(`Baris ${rowNumber}: kolom matching_pairs harus berisi JSON array yang valid.`)
  }
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new Error(`Baris ${rowNumber}: matching_pairs harus berisi minimal dua pasangan.`)
  }
  const targets = []
  const matches = pairs.map((pair, index) => {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
      throw new Error(`Baris ${rowNumber}: pasangan ${index + 1} tidak valid.`)
    }
    const target = { id: makeId('target'), target_text: htmlText(pair.target_text) }
    const premise = htmlText(pair.premise_text)
    if (!target.target_text || !premise) throw new Error(`Baris ${rowNumber}: pasangan ${index + 1} harus memiliki premise_text dan target_text.`)
    targets.push(target)
    return {
      id: `${questionId}-pasangan-${String(index + 1).padStart(4, '0')}`,
      premise_text: premise,
      target_id: target.id,
    }
  })
  return { matches, targets }
}

function questionFromRow(worksheet, rowNumber, headers, imagesByCell, packageId) {
  const get = (header) => {
    const column = headers.get(header)
    return column ? cellText(worksheet.getRow(rowNumber).getCell(column)) : ''
  }
  const getImages = (header) => {
    const column = headers.get(header)
    return column ? imagesByCell.get(`${rowNumber}:${column}`) || [] : []
  }
  const type = normalizeType(get('type'), rowNumber)
  const questionId = makeId('soal')
  const content = appendImages(get('question'), getImages('question'))
  if (!content) throw new Error(`Baris ${rowNumber}: kolom question wajib diisi.`)
  const explanation = appendImages(get('explanation'), getImages('explanation'))
  const correctAnswers = new Set(splitValues(get('correct_answers')))
  const question = {
    ...createQuestion(packageId),
    id: questionId,
    type,
    content,
    explanation,
    options: [],
    matches: [],
    targets: [],
  }

  if (OPTION_QUESTION_TYPES.includes(type)) {
    const optionLetters = []
    OPTION_LETTERS.split('').forEach((letter, index) => {
      const header = `option_${letter.toLowerCase()}`
      const optionText = appendImages(get(header), getImages(header))
      if (!optionText) return
      const weightText = get(`weight_${letter.toLowerCase()}`)
      const scoreWeight = weightText === '' ? null : Number(weightText)
      if (weightText !== '' && (!Number.isFinite(scoreWeight) || scoreWeight < 0)) {
        throw new Error(`Baris ${rowNumber}: weight_${letter.toLowerCase()} harus berupa angka nol atau lebih.`)
      }
      question.options.push({
        id: makeId('opsi'),
        option_text: optionText,
        is_correct: type === 'tkp' ? false : correctAnswers.has(letter),
        score_weight: scoreWeight,
        position: index + 1,
      })
      optionLetters.push(letter)
    })
    if (!question.options.length) throw new Error(`Baris ${rowNumber}: isi minimal satu kolom option_a hingga option_h.`)
    if (['single_choice', 'multiple_choice', 'complex_choice', 'tkp'].includes(type) && question.options.length < 2) {
      throw new Error(`Baris ${rowNumber}: ${type} harus memiliki minimal dua opsi.`)
    }
    if ([...correctAnswers].some((letter) => !optionLetters.includes(letter))) {
      throw new Error(`Baris ${rowNumber}: correct_answers hanya boleh memuat huruf opsi yang terisi (A–H).`)
    }
    if (type === 'tkp' && question.options.some((option) => option.score_weight === null)) {
      throw new Error(`Baris ${rowNumber}: semua opsi TKP memerlukan nilai weight_a hingga weight_h.`)
    }
    if (type === 'single_choice' && [...correctAnswers].filter((letter) => OPTION_LETTERS.includes(letter)).length !== 1) {
      throw new Error(`Baris ${rowNumber}: single_choice harus memiliki tepat satu huruf kunci pada correct_answers.`)
    }
    if (['multiple_choice', 'complex_choice'].includes(type) && !question.options.some((option) => option.is_correct)) {
      throw new Error(`Baris ${rowNumber}: pilih minimal satu huruf kunci pada correct_answers.`)
    }
    if (['true_false', 'true_false_multi'].includes(type)) {
      if ([...correctAnswers].some((value) => !optionLetters.includes(value))) {
        throw new Error(`Baris ${rowNumber}: correct_answers harus berupa huruf opsi A–H yang bernilai benar.`)
      }
      question.options = question.options.map((option, index) => ({ ...option, is_correct: correctAnswers.has(optionLetters[index]) }))
    }
  } else if (OPTION_LETTERS.split('').some((letter) => getImages(`option_${letter.toLowerCase()}`).length)) {
    throw new Error(`Baris ${rowNumber}: gambar pada opsi hanya dapat digunakan untuk tipe soal pilihan atau benar/salah.`)
  } else if (type === 'matching') {
    const pairData = get('matching_pairs')
    if (!pairData) throw new Error(`Baris ${rowNumber}: isi matching_pairs dengan JSON pasangan.`)
    const result = parseMatchingPairs(pairData, rowNumber, questionId)
    question.matches = result.matches
    question.targets = result.targets
  }

  return question
}

async function workbookImages(workbook, worksheet, headers) {
  const imagesByCell = new Map()
  const assets = []
  let totalImageBytes = 0
  for (const image of worksheet.getImages()) {
    const row = Math.floor(image.range.tl.nativeRow) + 1
    const column = Math.floor(image.range.tl.nativeCol) + 1
    const header = [...headers.entries()].find(([, columnNumber]) => columnNumber === column)?.[0]
    if (row < 2) throw new Error('Gambar Excel harus ditempatkan pada baris data, bukan pada header.')
    if (!['question', 'explanation', ...OPTION_LETTERS.split('').map((letter) => `option_${letter.toLowerCase()}`)].includes(header)) {
      throw new Error(`Gambar pada baris ${row} harus ditempatkan di kolom question, explanation, atau option_a hingga option_h.`)
    }
    const media = workbook.getImage(image.imageId)
    const extension = String(media.extension || '').toLowerCase().replace(/^\./, '')
    const mimeType = MIME_TYPES[extension]
    if (!mimeType || !media.buffer) {
      throw new Error(`Gambar pada baris ${row} memiliki format yang tidak didukung. Gunakan PNG, JPG, GIF, atau WebP.`)
    }
    const bytes = media.buffer instanceof Uint8Array ? media.buffer : new Uint8Array(media.buffer)
    totalImageBytes += bytes.byteLength
    if (totalImageBytes > MAX_EXTRACTED_IMAGE_SIZE) {
      throw new Error('Total gambar setelah diekstrak melebihi batas 50 MB.')
    }
    const blob = await compressImageToWebp(new Blob([bytes], { type: mimeType }))
    const path = `images/${makeId('gambar')}.webp`
    const asset = { path, filename: path.slice('images/'.length), blob, size: blob.size }
    assets.push(asset)
    const key = `${row}:${column}`
    imagesByCell.set(key, [...(imagesByCell.get(key) || []), path])
  }
  return { imagesByCell, assets }
}

export async function createQuestionTemplate() {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Pembuat Database CBT'
  workbook.subject = 'Template impor soal CBT'
  const sheet = workbook.addWorksheet('Soal')
  sheet.columns = HEADERS.map((header) => ({
    header,
    key: header,
    width: header === 'question' || header === 'explanation' || header === 'matching_pairs' ? 42 : 18,
  }))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(HEADERS.length).letter}1` }
  sheet.getRow(1).height = 24
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6857D9' } }
  })

  const guide = workbook.addWorksheet('Petunjuk')
  guide.columns = [{ width: 25 }, { width: 110 }]
  guide.addRows([
    ['Kolom', 'Petunjuk'],
    ['type', 'Gunakan nilai CBT: single_choice, multiple_choice, complex_choice, tkp, true_false, true_false_multi, matching, essay. Kosong = single_choice.'],
    ['question', 'Isi soal. Boleh berupa teks atau HTML sederhana. Gambar boleh ditempel di sel soal pada baris yang sama.'],
    ['explanation', 'Pembahasan opsional. Gambar juga dapat ditempel di sel ini.'],
    ['option_a hingga option_h', 'Teks opsi/pernyataan. Kolom kosong diabaikan. Gambar dapat ditempel pada sel opsi yang sama.'],
    ['correct_answers', 'Huruf kunci dipisahkan koma, contoh: B atau A,C. Untuk benar/salah, huruf yang dicantumkan berarti pernyataan benar. TKP memakai bobot, bukan kunci.'],
    ['weight_a hingga weight_h', 'Bobot opsi dengan angka nol atau lebih. Wajib untuk semua opsi soal TKP.'],
    ['matching_pairs', 'Untuk tipe matching, isi JSON array seperti: [{"premise_text":"Ibu kota Indonesia","target_text":"Jakarta"},{"premise_text":"Ibu kota Jepang","target_text":"Tokyo"}]. Gambar tersedia pada sel soal/pembahasan, bukan isi JSON pasangan.'],
    ['Gambar', 'Tambahkan gambar melalui Insert > Pictures di Excel, lalu letakkan pada sel question, explanation, atau option_a hingga option_h di baris soal yang sesuai. Gambar akan dikompres dan dikonversi ke WebP saat impor, lalu diekspor ke ZIP di folder images/.'],
    ['Paket aktif', 'Semua soal dalam file akan dimasukkan ke paket yang dipilih di aplikasi Pembuat Database CBT. Baris pertama pada sheet Soal wajib menjadi header.'],
  ])
  guide.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6857D9' } }
  guide.eachRow((row, rowNumber) => { if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true } })
  return workbook.xlsx.writeBuffer()
}

async function imageAsBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

async function webpAsPng(blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser gagal menyiapkan gambar untuk Excel.')
    context.drawImage(bitmap, 0, 0)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png)
        else reject(new Error('Gambar WebP tidak dapat dikonversi untuk Excel.'))
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

export async function createQuestionExportWorkbook(data, assets = []) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Pembuat Database CBT'
  workbook.subject = 'Ekspor bank soal CBT'
  const sheet = workbook.addWorksheet('Soal', { views: [{ state: 'frozen', ySplit: 1 }] })
  const exportHeaders = ['category', 'package', 'difficulty', ...HEADERS]
  sheet.columns = exportHeaders.map((header) => ({
    header,
    key: header,
    width: header === 'question' || header === 'explanation' || header === 'matching_pairs' ? 42 : 18,
  }))
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(exportHeaders.length).letter}1` }
  const header = sheet.getRow(1)
  header.height = 24
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6857D9' } }
  })
  for (const question of data.questions) {
    const pack = data.packages.find((item) => item.id === question.package_id)
    const category = data.categories.find((item) => item.id === pack?.category_id)
    const row = {
      category: category?.name || '',
      package: pack?.title || '',
      difficulty: pack?.difficulty || '',
      type: question.type,
      question: question.content,
      explanation: question.explanation,
      correct_answers: question.type === 'tkp'
        ? ''
        : question.options
          .map((option, index) => option.is_correct ? OPTION_LETTERS[index] : '')
          .filter(Boolean)
          .join(','),
      matching_pairs: question.type === 'matching'
        ? JSON.stringify(question.matches.map((match) => ({
            premise_text: match.premise_text,
            target_text: question.targets.find((target) => target.id === match.target_id)?.target_text || '',
          })))
        : '',
    }
    question.options?.forEach((option, index) => {
      const letter = OPTION_LETTERS[index]
      row[`option_${letter.toLowerCase()}`] = option.option_text
      row[`weight_${letter.toLowerCase()}`] = option.score_weight ?? ''
    })
    const excelRow = sheet.addRow(row)
    const imageColumns = [
      ['question', question.content],
      ['explanation', question.explanation],
      ...(question.options || []).flatMap((option, index) => [
        [`option_${OPTION_LETTERS[index].toLowerCase()}`, option.option_text],
      ]),
    ]
    for (const [columnKey, html] of imageColumns) {
      const columnNumber = sheet.getColumn(columnKey).number
      for (const path of imagePathsInHtml(html)) {
        const asset = assets.find((item) => item.path === path)
        if (!asset) continue
        let extension = asset.filename.split('.').pop()?.toLowerCase()
        let blob = asset.blob
        if (extension === 'webp') {
          blob = await webpAsPng(blob)
          extension = 'png'
        }
        if (!['png', 'jpg', 'jpeg', 'gif'].includes(extension)) continue
        const imageId = workbook.addImage({ base64: await imageAsBase64(blob), extension })
        sheet.addImage(imageId, {
          tl: { col: columnNumber - 1, row: excelRow.number - 1 },
          ext: { width: 240, height: 140 },
        })
      }
    }
  }
  const guide = workbook.addWorksheet('Petunjuk')
  guide.columns = [{ width: 24 }, { width: 105 }]
  guide.addRows([
    ['Kolom', 'Keterangan'],
    ['HTML', 'Isi soal, pembahasan, opsi, dan pasangan diekspor dalam HTML agar format teks tetap terbawa.'],
    ['Gambar', 'Path gambar baru dalam HTML merujuk ke images/....webp. Gambar WebP dikonversi ke PNG saat disematkan di workbook dan tetap WebP di ZIP.'],
    ['Paket', 'Workbook memuat seluruh soal dari seluruh paket dan kategori. Kolom type menunjukkan jenis soal CBT.'],
  ])
  guide.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6857D9' } }
  guide.eachRow((row, rowNumber) => { if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true } })
  return workbook.xlsx.writeBuffer()
}

export async function parseQuestionWorkbook(file, packageId) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Pilih file Excel .xlsx terlebih dahulu.')
  if (!packageId) throw new Error('Pilih paket latihan sebelum mengimpor soal.')
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Format file tidak didukung. Gunakan file Excel .xlsx.')
  if (file.size > MAX_WORKBOOK_SIZE) throw new Error('Ukuran file maksimal 25 MB.')

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(await file.arrayBuffer())
  } catch (error) {
    throw new Error(`File Excel tidak dapat dibaca. Pastikan file .xlsx valid dan tidak rusak. Detail: ${error.message}`)
  }

  const worksheet = workbook.getWorksheet('Soal') || workbook.worksheets[0]
  if (!worksheet) throw new Error('Workbook tidak memiliki sheet soal.')
  if (worksheet.rowCount > MAX_WORKSHEET_ROWS + 1) {
    throw new Error(`Sheet soal melebihi batas ${MAX_WORKSHEET_ROWS} baris data.`)
  }
  const headers = new Map()
  worksheet.getRow(1).eachCell((cell, column) => {
    const header = normalizeHeader(cellText(cell))
    if (header) headers.set(header, column)
  })
  const questionColumn = headers.get('question') || headers.get('content')
  if (!questionColumn) throw new Error('Header kolom question tidak ditemukan. Unduh template .xlsx untuk melihat format yang didukung.')
  headers.set('question', questionColumn)
  if (!headers.has('type')) headers.set('type', 0)
  if (!headers.has('explanation')) headers.set('explanation', 0)
  if (!headers.has('correct_answers')) headers.set('correct_answers', 0)
  if (!headers.has('matching_pairs')) headers.set('matching_pairs', 0)

  const { imagesByCell, assets } = await workbookImages(workbook, worksheet, headers)
  const questions = []
  const errors = []
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const hasValues = row.hasValues
    const hasImages = [...imagesByCell.keys()].some((key) => key.startsWith(`${rowNumber}:`))
    if (!hasValues && !hasImages) continue
    try {
      questions.push(questionFromRow(worksheet, rowNumber, headers, imagesByCell, packageId))
    } catch (error) {
      errors.push(error.message)
    }
  }

  if (errors.length) {
    const listed = errors.slice(0, 10).join('\n')
    throw new Error(`Impor dibatalkan karena ${errors.length} baris bermasalah:\n${listed}${errors.length > 10 ? '\nDan baris lainnya.' : ''}`)
  }
  if (!questions.length) throw new Error('Tidak ada soal yang dapat diimpor dari sheet ini.')
  return { questions, assets }
}

function imagePathsInHtml(html) {
  if (typeof DOMParser === 'undefined') return []
  const parsed = new DOMParser().parseFromString(html || '', 'text/html')
  return [...parsed.querySelectorAll('img[src]')]
    .map((image) => image.getAttribute('src')?.trim() || '')
    .filter((source) => source && !/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('//'))
    .map((source) => source.replace(/^\/+/, '').replace(/^public\//i, ''))
}

function referencedImagePaths(questions, materials = []) {
  const referenced = new Set()
  questions.forEach((question) => {
    const htmlFields = [question.content, question.explanation]
    question.options?.forEach((option) => htmlFields.push(option.option_text))
    question.matches?.forEach((match) => htmlFields.push(match.premise_text))
    question.targets?.forEach((target) => htmlFields.push(target.target_text))
    htmlFields.forEach((html) => imagePathsInHtml(html).forEach((path) => referenced.add(path)))
  })
  materials.forEach((material) => imagePathsInHtml(material.content).forEach((path) => referenced.add(path)))
  return referenced
}

export function countReferencedQuestionImages(questions, assets, materials = []) {
  const referenced = referencedImagePaths(questions, materials)
  return assets.filter((asset) => referenced.has(asset.path)).length
}

export async function createQuestionImageArchive(questions, assets, materials = []) {
  const referenced = referencedImagePaths(questions, materials)
  const files = assets.filter((asset) => referenced.has(asset.path))
  if (!files.length) throw new Error('Belum ada gambar tertanam pada soal untuk dimasukkan ke ZIP.')

  const { default: JSZip } = await import('jszip')
  const archive = new JSZip()
  files.forEach((asset) => archive.file(asset.path, asset.blob))
  archive.file('PETUNJUK.txt', 'Ekstrak folder images/ ke folder public/ aplikasi CBT. Jangan mengubah struktur folder agar referensi gambar dalam database tetap cocok.')
  const content = await archive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob: content, count: files.length }
}
