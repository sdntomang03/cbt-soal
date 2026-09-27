export const STORAGE_KEY = 'pembuat-database-cbt-v1'

export const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Pilihan tunggal' },
  { value: 'multiple_choice', label: 'Pilihan ganda' },
  { value: 'complex_choice', label: 'Pilihan ganda kompleks' },
  { value: 'tkp', label: 'TKP (berbobot)' },
  { value: 'true_false', label: 'Benar / salah' },
  { value: 'true_false_multi', label: 'Benar / salah (multi)' },
  { value: 'matching', label: 'Menjodohkan' },
  { value: 'essay', label: 'Esai / isian' },
]

export const OPTION_QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'complex_choice',
  'tkp',
  'true_false',
  'true_false_multi',
]

export const DIFFICULTY_LEVELS = [
  { value: 'Mudah', label: 'Mudah' },
  { value: 'Menengah', label: 'Menengah' },
  { value: 'Sulit', label: 'Sulit' },
]

export const EMPTY_DATA = {
  categories: [],
  packages: [],
  questions: [],
  materials: [],
}

export function makeId(prefix) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${random}`
}

export function createMatchRowId(questionId, index) {
  return `${questionId}-match-${String(index + 1).padStart(6, '0')}`
}

export function createCategory() {
  return { id: makeId('kategori'), name: '', description: '' }
}

export function createPackage(categoryId) {
  return { id: makeId('paket'), category_id: categoryId, title: '', description: '', difficulty: '' }
}

export function createQuestion(packageId) {
  return {
    id: makeId('soal'),
    package_id: packageId,
    type: 'single_choice',
    content: '',
    explanation: '',
    options: [
      { id: makeId('opsi'), option_text: '', is_correct: false, score_weight: null },
      { id: makeId('opsi'), option_text: '', is_correct: false, score_weight: null },
    ],
    matches: [],
    targets: [],
  }
}

export function createMaterial(categoryId = '') {
  return { id: makeId('materi'), category_id: categoryId, title: '', summary: '', content: '' }
}

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

export function validateData(data) {
  const errors = []
  const warnings = []
  const ids = new Set()
  const registerId = (id, label) => {
    if (!nonEmpty(id)) errors.push(`${label}: ID kosong.`)
    else if (ids.has(id)) errors.push(`ID "${id}" digunakan lebih dari sekali.`)
    else ids.add(id)
  }

  data.categories.forEach((category, index) => {
    registerId(category.id, `Kategori ${index + 1}`)
    if (!nonEmpty(category.name)) errors.push(`Kategori ${index + 1}: nama wajib diisi.`)
  })
  data.packages.forEach((pack, index) => {
    registerId(pack.id, `Paket ${index + 1}`)
    if (!data.categories.some((category) => category.id === pack.category_id)) errors.push(`Paket "${pack.title || index + 1}": kategori tidak ditemukan.`)
    if (!nonEmpty(pack.title)) errors.push(`Paket ${index + 1}: judul wajib diisi.`)
  })
  data.questions.forEach((question, index) => {
    const label = `Soal ${index + 1}`
    registerId(question.id, label)
    if (!data.packages.some((pack) => pack.id === question.package_id)) errors.push(`${label}: paket tidak ditemukan.`)
    if (!QUESTION_TYPES.some((type) => type.value === question.type)) errors.push(`${label}: tipe "${question.type}" tidak didukung CBT.`)
    if (!nonEmpty(question.content)) errors.push(`${label}: isi soal wajib diisi.`)

    const options = question.options || []
    options.forEach((option, optionIndex) => {
      registerId(option.id, `${label}, opsi ${optionIndex + 1}`)
      if (OPTION_QUESTION_TYPES.includes(question.type) && !nonEmpty(option.option_text)) {
        errors.push(`${label}: teks opsi ${optionIndex + 1} wajib diisi.`)
      }
    })

    if (question.type === 'single_choice' && options.filter((option) => option.is_correct).length !== 1) {
      errors.push(`${label}: pilih tepat satu kunci jawaban.`)
    }
    if (question.type === 'complex_choice' && options.filter((option) => option.is_correct).length === 0) {
      errors.push(`${label}: pilih minimal satu kunci jawaban.`)
    }
    if (question.type === 'multiple_choice' && options.filter((option) => option.is_correct).length === 0) {
      errors.push(`${label}: tandai minimal satu opsi yang benar.`)
    }
    if (['single_choice', 'multiple_choice', 'complex_choice', 'tkp'].includes(question.type) && options.length < 2) {
      errors.push(`${label}: tambahkan minimal dua opsi jawaban.`)
    }
    if (question.type === 'tkp') {
      if (options.some((option) => option.score_weight === null || option.score_weight === '' || !Number.isFinite(Number(option.score_weight)) || Number(option.score_weight) < 0)) {
        errors.push(`${label}: setiap opsi TKP harus memiliki bobot angka nol atau lebih.`)
      }
    }
    if (['true_false', 'true_false_multi'].includes(question.type) && options.length === 0) {
      errors.push(`${label}: tambahkan minimal satu pernyataan.`)
    }
    if (question.type === 'matching') {
      if (!question.matches?.length || !question.targets?.length) errors.push(`${label}: lengkapi pernyataan dan pilihan pasangan.`)
      question.targets?.forEach((target, targetIndex) => {
        registerId(target.id, `${label}, target ${targetIndex + 1}`)
        if (!nonEmpty(target.target_text)) errors.push(`${label}: teks target ${targetIndex + 1} wajib diisi.`)
      })
      question.matches?.forEach((match, matchIndex) => {
        registerId(match.id, `${label}, pasangan ${matchIndex + 1}`)
        if (!nonEmpty(match.premise_text)) errors.push(`${label}: teks pernyataan ${matchIndex + 1} wajib diisi.`)
        if (!question.targets?.some((target) => target.id === match.target_id)) errors.push(`${label}: pilih target yang benar untuk pernyataan ${matchIndex + 1}.`)
      })
    }
  })
  data.materials.forEach((material, index) => {
    registerId(material.id, `Materi ${index + 1}`)
    if (material.category_id && !data.categories.some((category) => category.id === material.category_id)) errors.push(`Materi "${material.title || index + 1}": kategori tidak ditemukan.`)
    if (!nonEmpty(material.title)) errors.push(`Materi ${index + 1}: judul wajib diisi.`)
    if (!nonEmpty(material.content)) errors.push(`Materi "${material.title || index + 1}": isi wajib diisi.`)
  })

  if (!data.categories.length) errors.push('Tambahkan minimal satu kategori.')
  if (!data.packages.length) errors.push('Tambahkan minimal satu paket latihan.')
  if (!data.questions.length) errors.push('Tambahkan minimal satu soal. Importer CBT mensyaratkan kategori, paket, dan soal.')
  if (!data.materials.length) warnings.push('Belum ada materi belajar. Database ini tetap dapat digunakan untuk Latihan.')
  if (data.questions.some((question) => question.type === 'essay')) warnings.push('Soal esai tidak dikoreksi otomatis oleh CBT.')
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}
