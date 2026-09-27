import DOMPurify from 'dompurify'
import { makeId, OPTION_QUESTION_TYPES } from './model'

const API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-flash'
const REQUEST_TIMEOUT_MS = 60_000

function html(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Respons AI tidak memiliki ${label} yang valid.`)
  }
  const sanitized = DOMPurify.sanitize(value.trim())
  if (!sanitized.trim()) throw new Error(`Konten ${label} dari AI kosong setelah sanitasi keamanan.`)
  return sanitized
}

function parseJsonContent(content, context = {}) {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
        .filter((part) => part && typeof part === 'object' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      : ''
  if (!text.trim()) {
    const finishReason = context.finishReason ? ` finish_reason: ${context.finishReason}.` : ''
    const tokenUsage = Number.isFinite(context.completionTokens) ? ` Token output: ${context.completionTokens}.` : ''
    const reasoningOnly = context.hasReasoning ? ' Model menghasilkan reasoning tanpa jawaban akhir.' : ''
    const refusal = context.refusal ? ` Alasan: ${context.refusal}.` : ''
    throw new Error(`DeepSeek mengembalikan jawaban kosong.${finishReason}${tokenUsage}${reasoningOnly}${refusal} Permintaan sebelumnya masih bisa dicoba ulang.`)
  }
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed)
  } catch {
    throw new Error('Jawaban DeepSeek tidak berupa JSON yang valid. Coba lagi.')
  }
}

function normalizeResponse(response, question, optionCount) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Struktur jawaban DeepSeek tidak valid.')
  }
  const content = html(response.content, 'isi soal')
  const explanation = html(response.explanation, 'pembahasan')

  if (OPTION_QUESTION_TYPES.includes(question.type) && !['true_false', 'true_false_multi'].includes(question.type)) {
    if (!Array.isArray(response.options) || response.options.length !== optionCount) {
      throw new Error(`DeepSeek harus menghasilkan tepat ${optionCount} pilihan jawaban.`)
    }
    const options = response.options.map((option, index) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        throw new Error(`Format opsi jawaban ${index + 1} dari DeepSeek tidak valid.`)
      }
      const scoreWeight = question.type === 'tkp' ? Number(option.score_weight) : null
      if (question.type === 'tkp' && (!Number.isFinite(scoreWeight) || scoreWeight < 0)) {
        throw new Error(`Bobot opsi TKP ${index + 1} dari DeepSeek tidak valid.`)
      }
      return {
        id: makeId('opsi'),
        option_text: html(option.text, `teks opsi ${index + 1}`),
        is_correct: question.type === 'tkp' ? false : option.is_correct === true,
        score_weight: question.type === 'tkp' ? scoreWeight : null,
      }
    })
    if (question.type === 'single_choice' && options.filter((option) => option.is_correct).length !== 1) {
      throw new Error('DeepSeek harus menandai tepat satu kunci untuk soal pilihan tunggal.')
    }
    if (['multiple_choice', 'complex_choice'].includes(question.type) && !options.some((option) => option.is_correct)) {
      throw new Error('DeepSeek harus menandai minimal satu kunci jawaban.')
    }
    return { content, explanation, options, matches: [], targets: [] }
  }

  if (['true_false', 'true_false_multi'].includes(question.type)) {
    if (!Array.isArray(response.options) || response.options.length !== optionCount) {
      throw new Error(`DeepSeek harus menghasilkan tepat ${optionCount} pernyataan benar/salah.`)
    }
    const options = response.options.map((option, index) => {
      if (!option || typeof option !== 'object' || typeof option.is_correct !== 'boolean') {
        throw new Error(`Pernyataan ${index + 1} harus memiliki kunci benar/salah.`)
      }
      return {
        id: makeId('opsi'),
        option_text: html(option.text, `teks pernyataan ${index + 1}`),
        is_correct: option.is_correct,
        score_weight: null,
      }
    })
    return { content, explanation, options, matches: [], targets: [] }
  }

  if (question.type === 'matching') {
    if (!Array.isArray(response.matches) || response.matches.length !== optionCount) {
      throw new Error(`DeepSeek harus menghasilkan tepat ${optionCount} pasangan menjodohkan.`)
    }
    const targets = []
    const matches = response.matches.map((pair, index) => {
      if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
        throw new Error(`Pasangan menjodohkan ${index + 1} dari DeepSeek tidak valid.`)
      }
      const target = { id: makeId('target'), target_text: html(pair.target_text, `teks target ${index + 1}`) }
      targets.push(target)
      return {
        id: makeId('pasangan'),
        premise_text: html(pair.premise_text, `teks pernyataan ${index + 1}`),
        target_id: target.id,
      }
    })
    return { content, explanation, options: [], matches, targets }
  }
  if (question.type === 'essay') return { content, explanation, options: [], matches: [], targets: [] }
  throw new Error(`Jenis soal "${question.type}" tidak didukung oleh generator AI.`)
}

function makePrompts({ question, categoryName, packageTitle, difficulty, instructions, optionCount, questionCount }) {
  const typeInstructions = question.type === 'tkp'
    ? `Setiap soal harus memiliki tepat ${optionCount} opsi. Isi setiap opsi dengan score_weight berupa angka 1 sampai 5 (boleh bilangan desimal); is_correct selalu false.`
    : question.type === 'single_choice'
      ? `Setiap soal harus memiliki tepat ${optionCount} opsi dan tandai tepat satu dengan is_correct true.`
      : ['multiple_choice', 'complex_choice'].includes(question.type)
        ? `Setiap soal harus memiliki tepat ${optionCount} opsi dan tandai satu atau lebih kunci dengan is_correct true.`
        : ['true_false', 'true_false_multi'].includes(question.type)
          ? `Setiap soal harus memiliki ${optionCount} pernyataan dengan text dan is_correct boolean.`
          : question.type === 'matching'
            ? `Setiap soal harus memiliki tepat ${optionCount} pasangan berbeda berupa premise_text dan target_text.`
            : 'Buat soal esai atau isian singkat. Jangan buat opsi jawaban.'
  const itemShape = question.type === 'matching'
    ? '{"content":"<p>Instruksi soal</p>","matches":[{"premise_text":"...","target_text":"..."}],"explanation":"<p>Pembahasan</p>"}'
    : question.type === 'essay'
      ? '{"content":"<p>Pertanyaan esai</p>","options":[],"explanation":"<p>Poin jawaban dan alasan</p>"}'
      : '{"content":"<p>Pertanyaan</p>","options":[{"text":"<p>Opsi</p>","is_correct":true,"score_weight":5}],"explanation":"<p>Pembahasan</p>"}'
  const system = [
    'Anda menyusun soal latihan CBT berbahasa Indonesia yang akurat, jelas, dan orisinal.',
    'Balas hanya dengan satu objek JSON valid. Gunakan HTML semantik sederhana seperti <h2>, <h3>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <br>; tanpa markdown.',
    `Struktur: {"questions":[${itemShape}]}`,
    `Aturan tipe ${question.type}: ${typeInstructions}`,
    'Buat variasi konteks yang berbeda dan tidak ambigu. Pembahasan soal objektif harus menjelaskan kunci.',
  ].join('\n')
  const user = [
    `Kategori: ${categoryName || 'Umum'}`,
    `Paket: ${packageTitle || 'Latihan'}`,
    `Tingkat kesulitan: ${difficulty || 'Menengah'}`,
    `Tipe soal: ${question.type}`,
    `Permintaan atau materi acuan: ${instructions.trim()}`,
    question.content.trim() ? `Isi soal saat ini: ${question.content}` : '',
    `Jumlah soal dalam array: tepat ${questionCount}`,
    question.type !== 'essay' ? `Jumlah opsi/pernyataan/pasangan per soal: ${optionCount}` : '',
  ].filter(Boolean).join('\n')
  return { system, user }
}

async function requestCompletion({ apiKey, messages, maxTokens, temperature, signal, fetchImpl }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abortRequest = () => controller.abort()
  signal?.addEventListener('abort', abortRequest, { once: true })
  try {
    let response
    try {
      response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          Authorization: ['Bearer', apiKey.trim()].join(' '),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Permintaan DeepSeek dibatalkan atau melewati batas waktu 60 detik.')
      throw new Error(`Tidak dapat menghubungi DeepSeek. Periksa koneksi internet. Detail: ${error.message}`)
    }

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = typeof payload?.error?.message === 'string' ? ` ${payload.error.message}` : ''
      if (response.status === 401 || response.status === 403) throw new Error(`API key DeepSeek tidak valid atau tidak memiliki akses.${detail}`)
      if (response.status === 402) throw new Error(`Saldo atau kuota API DeepSeek tidak mencukupi.${detail}`)
      if (response.status === 429) throw new Error(`Batas permintaan DeepSeek tercapai. Tunggu sebentar lalu coba lagi.${detail}`)
      throw new Error(`Permintaan DeepSeek gagal (HTTP ${response.status}).${detail}`)
    }
    const choice = payload?.choices?.[0]
    const message = choice?.message
    return parseJsonContent(message?.content, {
      finishReason: choice?.finish_reason,
      completionTokens: payload?.usage?.completion_tokens,
      hasReasoning: typeof message?.reasoning_content === 'string' && Boolean(message.reasoning_content.trim()),
      refusal: typeof message?.refusal === 'string' ? message.refusal : '',
    })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortRequest)
  }
}

export async function generateQuestionsWithDeepSeek({
  apiKey, question, categoryName, packageTitle, difficulty = '', instructions,
  optionCount, questionCount = 1, signal, fetchImpl = fetch,
}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Masukkan API key DeepSeek terlebih dahulu.')
  if (typeof instructions !== 'string' || !instructions.trim()) throw new Error('Tuliskan topik atau instruksi untuk soal yang akan dibuat.')
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 10) throw new Error('Jumlah soal harus berupa bilangan bulat antara 1 dan 10.')
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 8) throw new Error('Jumlah opsi atau pasangan harus berupa bilangan bulat antara 2 dan 8.')

  const { system, user } = makePrompts({ question, categoryName, packageTitle, difficulty, instructions, optionCount, questionCount })
  const responseData = await requestCompletion({
    apiKey,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.7,
    maxTokens: Math.min(12_000, questionCount * (question.type === 'essay' ? 1200 : 1800)),
    signal,
    fetchImpl,
  })
  if (!responseData || typeof responseData !== 'object' || !Array.isArray(responseData.questions)) {
    throw new Error('Respons DeepSeek tidak memiliki array "questions". Coba buat ulang.')
  }
  if (responseData.questions.length !== questionCount) {
    throw new Error(`DeepSeek menghasilkan ${responseData.questions.length} dari ${questionCount} soal yang diminta. Kurangi jumlah atau coba lagi.`)
  }
  return responseData.questions.map((generatedQuestion, index) => {
    try {
      return { ...question, id: makeId('soal'), ...normalizeResponse(generatedQuestion, question, optionCount) }
    } catch (error) {
      throw new Error(`Soal hasil ${index + 1}: ${error.message}`)
    }
  })
}

export async function generateLearningMaterialWithDeepSeek({ apiKey, categoryName, instructions, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Kunci API DeepSeek tidak tersedia.')
  if (typeof instructions !== 'string' || !instructions.trim()) throw new Error('Tuliskan topik materi yang ingin dibuat.')
  const result = await requestCompletion({
    apiKey,
    messages: [
      {
        role: 'system',
        content: [
          'Anda menyusun materi belajar CBT berbahasa Indonesia yang akurat, profesional, dan mudah dipahami.',
          'Balas hanya dengan satu objek JSON valid: {"title":"...","summary":"...","content":"..."} .',
          'Gunakan HTML semantik profesional seperti <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, dan <table>. Hindari markdown, skrip, style inline, serta atribut event.',
          'Susun pengantar, penjelasan, contoh kontekstual, dan rangkuman. Jangan mengarang fakta atau kutipan.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Kategori: ${categoryName || 'Umum'}\nTopik dan arahan: ${instructions.trim()}\nBuat judul singkat, ringkasan 1-2 kalimat, dan materi lengkap.`,
      },
    ],
    temperature: 0.6,
    maxTokens: 5000,
    fetchImpl,
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Respons materi DeepSeek tidak valid.')
  const title = typeof result.title === 'string' ? DOMPurify.sanitize(result.title, { ALLOWED_TAGS: [] }).trim() : ''
  const summary = typeof result.summary === 'string' ? DOMPurify.sanitize(result.summary, { ALLOWED_TAGS: [] }).trim() : ''
  const content = html(result.content, 'isi materi')
  if (!title || !summary) throw new Error('Respons DeepSeek harus menyertakan judul dan ringkasan materi.')
  return { title, summary, content }
}
