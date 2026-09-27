import { useEffect, useId, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import 'quill/dist/quill.snow.css'
import { buildDatabase } from './database'
import { generateLearningMaterialWithDeepSeek, generateQuestionsWithDeepSeek } from './deepseek'
import { getStorageWarning, loadImageAssets, loadWorkspace, saveImageAssets, saveWorkspace } from './imageAssets'
import { compressImageToWebp } from './imageCompression'
import { renderLatexInHtml } from './latex'
import { countReferencedQuestionImages, createQuestionExportWorkbook, createQuestionImageArchive, createQuestionTemplate, parseQuestionWorkbook } from './questionWorkbook'
import { registerResizableImage, serializeQuillHtml } from './quillImage'
import {
  createCategory,
  DIFFICULTY_LEVELS,
  EMPTY_DATA,
  createMatchRowId,
  createMaterial,
  createPackage,
  createQuestion,
  makeId,
  OPTION_QUESTION_TYPES,
  QUESTION_TYPES,
  validateData,
} from './model'

const NAV_ITEMS = [
  ['overview', 'Ringkasan', '⌂'],
  ['categories', 'Kategori', '▤'],
  ['packages', 'Paket latihan', '▣'],
  ['questions', 'Bank soal', '✎'],
  ['materials', 'Materi belajar', '▧'],
  ['preview', 'Pratinjau & ekspor', '⇩'],
]

const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES.map((type) => [type.value, type.label]))
const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY?.trim() || ''
let katexModulePromise
let katexStylesPromise

function normalizeImagePath(source) {
  if (typeof source !== 'string' || !source.trim()) return ''
  try {
    const url = new URL(source, document.baseURI)
    if (url.pathname === '/api/image') return url.searchParams.get('path') || ''
    return url.pathname.replace(/^\/+/, '').replace(/^public\//i, '')
  } catch {
    return source.replace(/^\/+/, '').replace(/^public\//i, '')
  }
}

function loadKatexStyles() {
  if (!katexStylesPromise) {
    katexStylesPromise = import('katex/dist/katex.min.css').catch((error) => {
      katexStylesPromise = null
      throw error
    })
  }
  return katexStylesPromise
}

function loadKatex() {
  if (!katexModulePromise) {
    katexModulePromise = import('katex').then(({ default: katex }) => {
      window.katex = katex
      return katex
    }).catch((error) => {
      katexModulePromise = null
      throw error
    })
  }
  return katexModulePromise
}

function safePreview(html, imageUrls = {}, katex = window.katex) {
  const sanitized = DOMPurify.sanitize(html || '')
  const preview = document.createElement('div')
  preview.innerHTML = katex ? DOMPurify.sanitize(renderLatexInHtml(sanitized, katex)) : sanitized
  preview.querySelectorAll('img[src]').forEach((image) => {
    const path = normalizeImagePath(image.getAttribute('src'))
    const imageUrl = imageUrls[path]
    if (imageUrl) image.setAttribute('src', imageUrl)
  })
  return { __html: preview.innerHTML }
}

function RichField({ label, value, onChange, placeholder, rows = 5, imageUrls, onUploadImage, minHeight }) {
  const host = useRef(null)
  const editor = useRef(null)
  const latest = useRef({ value, onChange })
  const editorId = useId()
  const [loadError, setLoadError] = useState('')
  const [selectedImage, setSelectedImage] = useState(null)
  const [katex, setKatex] = useState(() => window.katex || null)
  latest.current = { value, onChange, onUploadImage }

  useEffect(() => {
    let cancelled = false
    let quill
    Promise.all([import('quill'), loadKatex(), loadKatexStyles()]).then(([{ default: Quill }, loadedKatex]) => {
      if (cancelled || !host.current) return
      setKatex(loadedKatex)
      registerResizableImage(Quill)
      quill = new Quill(host.current, {
        theme: 'snow',
        placeholder: placeholder || 'Tulis konten di sini...',
        modules: {
          toolbar: [
            [{ header: [2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            [{ align: [] }],
            ['blockquote', 'link'],
            ['formula'],
            ...(onUploadImage ? [['image']] : []),
            ['clean'],
          ],
        },
      })
      editor.current = quill
      const initial = DOMPurify.sanitize(latest.current.value || '')
      quill.clipboard.dangerouslyPasteHTML(initial)
      quill.on('text-change', () => {
        const html = DOMPurify.sanitize(serializeQuillHtml(quill.root.innerHTML))
        lastEmitted.current = html
        latest.current.onChange(html)
      })
      quill.root.addEventListener('click', (event) => {
        const target = event.target
        if (target instanceof HTMLImageElement) {
          const imageIndex = quill.getIndex(Quill.find(target))
          const width = target.getAttribute('width') || String(Math.round(target.getBoundingClientRect().width))
          setSelectedImage({ index: imageIndex, width: Math.max(80, Math.min(1200, Number.parseInt(width, 10) || 360)) })
          quill.setSelection(imageIndex, 1, 'silent')
        } else {
          setSelectedImage(null)
        }
      })
      const toolbar = quill.getModule('toolbar')
      if (onUploadImage && toolbar) {
        toolbar.addHandler('image', () => {
          const picker = document.createElement('input')
          picker.type = 'file'
          picker.accept = 'image/png,image/jpeg,image/gif,image/webp'
          const savedRange = quill.getSelection(true)
          picker.onchange = async () => {
            const file = picker.files?.[0]
            if (file) {
              let path
              try {
                path = await latest.current.onUploadImage?.(file)
              } catch (uploadError) {
                setLoadError(uploadError.message || 'Gambar tidak dapat ditambahkan.')
                return
              }
              if (!path) return
              setLoadError('')
              const range = savedRange || { index: quill.getLength(), length: 0 }
              quill.insertEmbed(range.index, 'image', path, 'user')
              quill.formatText(range.index, 1, 'width', '480', 'user')
              quill.setSelection(range.index + 1, 0, 'silent')
              setSelectedImage({ index: range.index, width: 480 })
            }
          }
          picker.click()
        })
      }
    }).catch((editorError) => {
      setLoadError(`Editor Quill gagal dimuat: ${editorError.message}`)
    })
    return () => {
      cancelled = true
      editor.current = null
    }
  }, [editorId])

  useEffect(() => {
    const quill = editor.current
    if (!quill) return
    const sanitized = DOMPurify.sanitize(value || '')
    if (sanitized === lastEmitted.current) {
      lastEmitted.current = null
      return
    }
    if (sanitized !== serializeQuillHtml(quill.root.innerHTML)) {
      const selection = quill.getSelection()
      quill.clipboard.dangerouslyPasteHTML(sanitized)
      if (selection) quill.setSelection(Math.min(selection.index, quill.getLength() - 1), selection.length)
    }
  }, [value])

  const previewUrls = imageUrls || {}
  const contentArea = Math.max(minHeight || 0, rows * 18)

  const lastEmitted = useRef(null)
  const resizeSelectedImage = (width) => {
    if (!selectedImage || !editor.current) return
    const nextWidth = Number(width)
    editor.current.formatText(selectedImage.index, 1, 'width', String(nextWidth), 'user')
    setSelectedImage({ ...selectedImage, width: nextWidth })
  }

  return <div className="field rich-field">
    <div className="field-heading"><label>{label}</label><span>QUILL · HTML PROFESIONAL</span></div>
    {loadError && <div className="ai-inline-error" role="alert">{loadError}</div>}
    <div id={editorId} className="quill-host" ref={host} style={{ '--quill-min-height': `${contentArea}px` }} />
    {onUploadImage && selectedImage && <div className="image-size-control">
      <label htmlFor={`${editorId}-image-width`}>Ukuran gambar: {selectedImage.width}px</label>
      <input id={`${editorId}-image-width`} type="range" min="80" max="1200" step="20" value={selectedImage.width} onChange={(event) => resizeSelectedImage(event.target.value)} />
      <button type="button" className="small-button" onClick={() => { editor.current?.formatText(selectedImage.index, 1, 'width', false, 'user'); setSelectedImage(null) }}>Atur otomatis</button>
    </div>}
    <details className="content-preview">
      <summary>Pratinjau konten</summary>
      <div className="rendered-content" dangerouslySetInnerHTML={safePreview(value, previewUrls, katex)} />
    </details>
  </div>
}

function Field({ label, value, onChange, placeholder, type = 'text', min, step, required = false }) {
  const id = useId()
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <input
      id={id}
      type={type}
      value={value ?? ''}
      min={min}
      step={step}
      required={required}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
}

function App() {
  const [data, setData] = useState(EMPTY_DATA)
  const [section, setSection] = useState('overview')
  const [activeCategoryId, setActiveCategoryId] = useState('')
  const [activePackageId, setActivePackageId] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastSaved, setLastSaved] = useState('')
  const [workbookBusy, setWorkbookBusy] = useState(false)
  const [pendingImport, setPendingImport] = useState(null)
  const [imageAssets, setImageAssets] = useState([])
  const [imageUrls, setImageUrls] = useState({})
  const [storageReady, setStorageReady] = useState(false)
  const workbookInput = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadWorkspace().then(async (savedData) => [savedData, await loadImageAssets()]).then(([savedData, assets]) => {
      if (cancelled) return
      setData(savedData)
      setImageAssets(assets)
      setStorageReady(true)
      setError('')
      setNotice(getStorageWarning() || 'Data dan gambar tersimpan langsung ke database SQLite di server aplikasi ini.')
    }).catch((storageError) => {
      if (!cancelled) setError(storageError.message || 'Database lokal tidak dapat dibuka.')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!storageReady) return undefined
    const timeout = window.setTimeout(() => {
      saveWorkspace(data).then(() => {
        setLastSaved(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
      }).catch((saveError) => {
        setError(`Perubahan tidak dapat disimpan ke database SQLite server: ${saveError.message}`)
      })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [data, storageReady])

  useEffect(() => {
    const urls = Object.fromEntries(imageAssets.map((asset) => [asset.path, URL.createObjectURL(asset.blob)]))
    setImageUrls(urls)
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
  }, [imageAssets])

  useEffect(() => {
    if (!data.categories.some((item) => item.id === activeCategoryId)) setActiveCategoryId(data.categories[0]?.id || '')
    if (!data.packages.some((item) => item.id === activePackageId)) setActivePackageId(data.packages[0]?.id || '')
  }, [data.categories, data.packages, activeCategoryId, activePackageId])

  const validation = useMemo(() => validateData(data), [data])
  const activeCategory = data.categories.find((item) => item.id === activeCategoryId)
  const activePackage = data.packages.find((item) => item.id === activePackageId)
  const packageQuestions = data.questions.filter((item) => item.package_id === activePackageId)

  const updateItem = (collection, id, patch) => {
    setData((current) => ({
      ...current,
      [collection]: current[collection].map((item) => item.id === id ? { ...item, ...patch } : item),
    }))
  }

  const reorder = (collection, id, delta, groupKey) => {
    setData((current) => {
      const items = [...current[collection]]
      const item = items.find((entry) => entry.id === id)
      if (!item) return current
      const scoped = groupKey ? items.filter((entry) => entry[groupKey] === item[groupKey]) : items
      const index = scoped.findIndex((entry) => entry.id === id)
      const target = index + delta
      if (target < 0 || target >= scoped.length) return current
      const first = items.findIndex((entry) => entry.id === scoped[index].id)
      const second = items.findIndex((entry) => entry.id === scoped[target].id)
      ;[items[first], items[second]] = [items[second], items[first]]
      return { ...current, [collection]: items }
    })
  }

  const addCategory = () => {
    const category = createCategory()
    setData((current) => ({ ...current, categories: [...current.categories, category] }))
    setActiveCategoryId(category.id)
  }

  const deleteCategory = (id) => {
    const category = data.categories.find((item) => item.id === id)
    if (!window.confirm(`Hapus kategori "${category?.name || 'tanpa nama'}" beserta seluruh paket dan soal di dalamnya? Materi terkait akan menjadi tanpa kategori.`)) return
    const removedPackageIds = data.packages.filter((item) => item.category_id === id).map((item) => item.id)
    setData((current) => ({
      ...current,
      categories: current.categories.filter((item) => item.id !== id),
      packages: current.packages.filter((item) => item.category_id !== id),
      questions: current.questions.filter((item) => !removedPackageIds.includes(item.package_id)),
      materials: current.materials.map((item) => item.category_id === id ? { ...item, category_id: '' } : item),
    }))
  }

  const addPackage = () => {
    if (!activeCategoryId) return setNotice('Buat kategori terlebih dahulu.')
    const pack = createPackage(activeCategoryId)
    setData((current) => ({ ...current, packages: [...current.packages, pack] }))
    setActivePackageId(pack.id)
  }

  const deletePackage = (id) => {
    const pack = data.packages.find((item) => item.id === id)
    if (!window.confirm(`Hapus paket "${pack?.title || 'tanpa judul'}" beserta seluruh soalnya?`)) return
    setData((current) => ({
      ...current,
      packages: current.packages.filter((item) => item.id !== id),
      questions: current.questions.filter((item) => item.package_id !== id),
    }))
  }

  const addQuestion = () => {
    if (!activePackageId) return setNotice('Buat paket latihan terlebih dahulu.')
    setData((current) => ({ ...current, questions: [...current.questions, createQuestion(activePackageId)] }))
  }

  const deleteQuestion = (id) => {
    if (!window.confirm('Hapus soal ini beserta pilihan dan kuncinya?')) return
    setData((current) => ({ ...current, questions: current.questions.filter((item) => item.id !== id) }))
  }

  const addMaterial = () => {
    const material = createMaterial(activeCategoryId)
    setData((current) => ({ ...current, materials: [...current.materials, material] }))
  }

  const deleteMaterial = (id) => {
    if (!window.confirm('Hapus materi belajar ini?')) return
    setData((current) => ({ ...current, materials: current.materials.filter((item) => item.id !== id) }))
  }

  const updateQuestion = (id, patch) => updateItem('questions', id, patch)

  const addGeneratedQuestions = (questions) => {
    setData((current) => ({ ...current, questions: [...current.questions, ...questions] }))
    setNotice(`${questions.length} soal AI berhasil ditambahkan ke paket aktif.`)
  }

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadQuestionTemplate = async () => {
    setError('')
    try {
      const bytes = await createQuestionTemplate()
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'template-impor-soal-cbt.xlsx')
    } catch (templateError) {
      setError(templateError.message || 'Template Excel gagal dibuat.')
    }
  }

  const selectQuestionWorkbook = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setNotice('')
    setPendingImport(null)
    if (!activePackageId) {
      setError('Pilih atau buat paket latihan sebelum mengimpor soal.')
      return
    }
    setWorkbookBusy(true)
    try {
      const result = await parseQuestionWorkbook(file, activePackageId)
      setPendingImport({ ...result, filename: file.name, packageId: activePackageId })
    } catch (importError) {
      setError(importError.message || 'File Excel tidak dapat diimpor.')
    } finally {
      setWorkbookBusy(false)
    }
  }

  const confirmQuestionImport = async () => {
    if (!pendingImport || pendingImport.packageId !== activePackageId) return
    setWorkbookBusy(true)
    setError('')
    try {
      await saveImageAssets(pendingImport.assets)
      setImageAssets((current) => {
        const assetsByPath = new Map(current.map((asset) => [asset.path, asset]))
        pendingImport.assets.forEach((asset) => assetsByPath.set(asset.path, asset))
        return [...assetsByPath.values()]
      })
      setData((current) => ({ ...current, questions: [...current.questions, ...pendingImport.questions] }))
      setNotice(`${pendingImport.questions.length} soal${pendingImport.assets.length ? ` dan ${pendingImport.assets.length} gambar` : ''} berhasil ditambahkan ke paket.`)
      setPendingImport(null)
    } catch (importError) {
      setError(importError.message || 'Soal dan gambar gagal disimpan.')
    } finally {
      setWorkbookBusy(false)
    }
  }

  const downloadQuestionImages = async () => {
    setError('')
    try {
      const { blob, count } = await createQuestionImageArchive(data.questions, imageAssets, data.materials)
      downloadBlob(blob, 'gambar-soal-cbt.zip')
      setNotice(`${count} gambar soal berhasil dikemas dalam ZIP. Ekstrak folder images ke folder public aplikasi CBT.`)
    } catch (archiveError) {
      setError(archiveError.message || 'ZIP gambar gagal dibuat.')
    }
  }

  const uploadEditorImage = async (file) => {
    const compressed = await compressImageToWebp(file)
    const path = `images/${makeId('gambar')}.webp`
    const asset = { path, filename: path.slice('images/'.length), blob: compressed, size: compressed.size }
    await saveImageAssets([asset])
    setImageAssets((current) => [...current, asset])
    setNotice(`Gambar dikompres menjadi WebP (${(file.size / 1024).toFixed(1)} KB → ${(compressed.size / 1024).toFixed(1)} KB).`)
    return path
  }

  const updateOption = (question, optionId, patch) => {
    updateQuestion(question.id, {
      options: question.options.map((option) => option.id === optionId ? { ...option, ...patch } : option),
    })
  }

  const addOption = (question) => updateQuestion(question.id, {
    options: [...question.options, { id: makeId('opsi'), option_text: '', is_correct: false, score_weight: null }],
  })

  const removeOption = (question, optionId) => updateQuestion(question.id, {
    options: question.options.filter((option) => option.id !== optionId),
  })

  const addTarget = (question) => {
    const target = { id: makeId('target'), target_text: '' }
    updateQuestion(question.id, {
      targets: [...question.targets, target],
      matches: [...question.matches, { id: makeId('pasangan'), premise_text: '', target_id: target.id }],
    })
  }

  const exportDatabase = async () => {
    setNotice('')
    setError('')
    if (validation.errors.length) {
      setNotice('Perbaiki kesalahan validasi sebelum mengunduh database.')
      return
    }
    setBusy(true)
    try {
      const bytes = await buildDatabase(data)
      const blob = new Blob([bytes], { type: 'application/x-sqlite3' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'database-latihan.db'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Database berhasil dibuat dan diunduh.')
    } catch (exportError) {
      setError(exportError.message || 'Database gagal dibuat.')
    } finally {
      setBusy(false)
    }
  }

  const exportQuestionWorkbook = async () => {
    setWorkbookBusy(true)
    setError('')
    try {
      const bytes = await createQuestionExportWorkbook(data, imageAssets)
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'soal-cbt.xlsx')
      setNotice('Seluruh soal berhasil diekspor ke Excel. Gambar tetap tersedia melalui ZIP gambar.')
    } catch (exportError) {
      setError(exportError.message || 'Ekspor Excel gagal.')
    } finally {
      setWorkbookBusy(false)
    }
  }

  const renderSection = () => {
    if (section === 'categories') return <CategoriesView
      categories={data.categories}
      activeCategoryId={activeCategoryId}
      onSelect={setActiveCategoryId}
      onAdd={addCategory}
      onDelete={deleteCategory}
      onUpdate={(id, patch) => updateItem('categories', id, patch)}
      onReorder={(id, delta) => reorder('categories', id, delta)}
    />
    if (section === 'packages') return <PackagesView
      categories={data.categories}
      packages={data.packages}
      activeCategoryId={activeCategoryId}
      activeCategory={activeCategory}
      onSelectCategory={setActiveCategoryId}
      onNavigate={setSection}
      onAdd={addPackage}
      onDelete={deletePackage}
      onUpdate={(id, patch) => updateItem('packages', id, patch)}
      onReorder={(id, delta) => reorder('packages', id, delta, 'category_id')}
    />
    if (section === 'questions') return <QuestionsView
      packages={data.packages}
      categories={data.categories}
      questions={data.questions}
      activePackageId={activePackageId}
      onSelectPackage={setActivePackageId}
      onAdd={addQuestion}
      onDelete={deleteQuestion}
      onUpdate={updateQuestion}
      apiKey={DEEPSEEK_API_KEY}
      onAddGeneratedQuestions={addGeneratedQuestions}
      imageUrls={imageUrls}
      onUploadImage={uploadEditorImage}
      workbookBusy={workbookBusy}
      pendingImport={pendingImport}
      imageCount={countReferencedQuestionImages(data.questions, imageAssets, data.materials)}
      workbookInput={workbookInput}
      onDownloadTemplate={downloadQuestionTemplate}
      onSelectWorkbook={selectQuestionWorkbook}
      onConfirmImport={confirmQuestionImport}
      onCancelImport={() => setPendingImport(null)}
      onDownloadImages={downloadQuestionImages}
      onReorder={(id, delta) => reorder('questions', id, delta, 'package_id')}
      onUpdateOption={updateOption}
      onAddOption={addOption}
      onRemoveOption={removeOption}
      onAddTarget={addTarget}
    />
    if (section === 'materials') return <MaterialsView
      categories={data.categories}
      materials={data.materials}
      activeCategoryId={activeCategoryId}
      apiKey={DEEPSEEK_API_KEY}
      imageUrls={imageUrls}
      onUploadImage={uploadEditorImage}
      onSelectCategory={setActiveCategoryId}
      onAdd={addMaterial}
      onDelete={deleteMaterial}
      onUpdate={(id, patch) => updateItem('materials', id, patch)}
      onReorder={(id, delta) => reorder('materials', id, delta, 'category_id')}
    />
    if (section === 'preview') return <PreviewView
      data={data}
      validation={validation}
      onExport={exportDatabase}
      onExportWorkbook={exportQuestionWorkbook}
      onExportImages={downloadQuestionImages}
      imageCount={countReferencedQuestionImages(data.questions, imageAssets, data.materials)}
      busy={busy || workbookBusy}
    />
    return <Overview
      data={data}
      validation={validation}
      onNavigate={setSection}
      onExport={exportDatabase}
      busy={busy}
    />
  }

  const currentSection = NAV_ITEMS.find(([id]) => id === section)
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setSection('overview') }}>
        <span className="brand-mark">DB</span>
        <span><strong>Pembuat Database</strong><small>UNTUK CBT OFFLINE</small></span>
      </a>
      <div className="workspace-label">RUANG KERJA</div>
      <nav className="main-nav" aria-label="Navigasi utama">
        {NAV_ITEMS.map(([id, label, icon]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
          <span className="nav-icon">{icon}</span>{label}
          {id === 'preview' && validation.errors.length > 0 && <span className="nav-count">{validation.errors.length}</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <span className="save-indicator"><i /> {storageReady ? 'Database server aktif' : 'Memuat database server...'}</span>
        <small>{lastSaved ? `Terakhir disimpan ${lastSaved}` : 'SQLite tersimpan di folder data/'}</small>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">DB</span><b>Pembuat Database CBT</b></div>
        <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{currentSection?.[1]}</strong></div>
        <div className="topbar-actions">
          <span className={`ai-status ${DEEPSEEK_API_KEY ? 'connected' : ''}`} title={DEEPSEEK_API_KEY ? 'Kunci API dimuat dari environment.' : 'Atur VITE_DEEPSEEK_API_KEY di .env.local.'}><i /> AI {DEEPSEEK_API_KEY ? 'key dimuat' : 'belum diatur'}</span>
          <button className="top-export" disabled={!storageReady || busy || validation.errors.length > 0} onClick={exportDatabase}>
            {busy ? 'Membuat database...' : '⇩  Unduh .db'}
          </button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Navigasi utama">
        {NAV_ITEMS.map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <div className="content-area">
        {error && <div className="alert alert-error" role="alert"><b>Terjadi masalah</b>{error}<button onClick={() => setError('')} aria-label="Tutup">×</button></div>}
        {notice && <div className="alert alert-info" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Tutup">×</button></div>}
        {storageReady ? renderSection() : <div className="alert alert-info" role="status">Menghubungkan ke database SQLite server…</div>}
        <footer className="page-footer">Pembuat Database CBT <span>·</span> SQLite dibuat langsung di perangkat Anda</footer>
      </div>
    </main>
  </div>
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading">
    <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
    {action}
  </div>
}

function Button({ children, kind = 'primary', ...props }) {
  return <button className={`button button-${kind}`} {...props}>{children}</button>
}

function EmptyState({ title, description, action }) {
  return <div className="empty-state"><span className="empty-icon">◇</span><h3>{title}</h3><p>{description}</p>{action}</div>
}

function Overview({ data, validation, onNavigate, onExport, busy }) {
  const valid = validation.errors.length === 0
  return <>
    <PageHeading eyebrow="SELAMAT DATANG" title="Ruang kerja konten" description="Susun paket latihan dan materi belajar, lalu ekspor menjadi database SQLite untuk aplikasi CBT offline." action={<Button disabled={!valid || busy} onClick={onExport}>{busy ? 'Membuat...' : '⇩  Ekspor database'}</Button>} />
    <section className="welcome-panel">
      <div className="welcome-copy"><span className="welcome-tag">PEMBUAT DATABASE CBT</span><h2>Semua konten CBT,<br /><em>dalam satu database.</em></h2><p>Kelola kategori, soal, dan materi belajar. Hasil ekspor kompatibel dengan fitur Belajar dan Latihan offline.</p><Button kind="light" onClick={() => onNavigate('categories')}>Mulai susun konten <span>→</span></Button></div>
      <div className="welcome-art" aria-hidden="true"><div className="art-sheet"><div /><div /><div /><div /></div><div className="art-database"><span>SQLite</span><b>.db</b></div><span className="art-spark">✳</span></div>
    </section>
    <div className="stats-grid">
      <StatCard label="Kategori" value={data.categories.length} helper="bidang materi" icon="▤" />
      <StatCard label="Paket latihan" value={data.packages.length} helper="paket soal" icon="▣" />
      <StatCard label="Total soal" value={data.questions.length} helper="siap dikerjakan" icon="✎" />
      <StatCard label="Materi belajar" value={data.materials.length} helper="bacaan offline" icon="▧" />
    </div>
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">LANGKAH KERJA</span><h2>Siapkan database Anda</h2></div><span className="step-count">4 LANGKAH</span></div>
        <div className="steps">
          {[
            ['01', 'Buat kategori', 'Kelompokkan materi seperti TKP, TWK, atau TIU.', 'categories'],
            ['02', 'Susun paket dan soal', 'Atur tipe soal, opsi, kunci, dan bobot.', 'questions'],
            ['03', 'Tambahkan materi belajar', 'Isi materi HTML per kategori.', 'materials'],
            ['04', 'Validasi dan unduh', 'Periksa pratinjau, lalu ekspor file .db.', 'preview'],
          ].map(([number, title, detail, destination]) => <button className="step-row" key={number} onClick={() => onNavigate(destination)}><b>{number}</b><span><strong>{title}</strong><small>{detail}</small></span><i>→</i></button>)}
        </div>
      </section>
      <section className={`panel validation-panel ${valid ? 'is-valid' : 'has-errors'}`}>
        <div className="panel-heading"><div><span className="eyebrow">STATUS DATABASE</span><h2>{valid ? 'Siap untuk divalidasi' : 'Perlu dilengkapi'}</h2></div><span className={`status-pill ${valid ? 'good' : 'bad'}`}>{valid ? 'SIAP' : `${validation.errors.length} MASALAH`}</span></div>
        <p className="panel-description">{valid ? 'Data memenuhi struktur minimum agar dapat diimpor oleh aplikasi CBT.' : 'Lengkapi item yang wajib sebelum file database dapat diunduh.'}</p>
        {valid ? <div className="validation-success"><span>✓</span><div><strong>Struktur konten sesuai</strong><small>Foreign key dan format SQLite diperiksa saat ekspor.</small></div></div> : <ul className="issue-list">{validation.errors.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>}
        <button className="text-link" onClick={() => onNavigate('preview')}>Lihat semua pemeriksaan <span>→</span></button>
      </section>
    </div>
    <section className="panel schema-panel"><div><span className="eyebrow">SKEMA KOMPATIBEL</span><h2>Dirancang untuk CBT offline</h2><p>Mengikuti tabel database yang digunakan aplikasi CBT: kategori, paket, soal, opsi, pasangan soal, target, dan materi belajar.</p></div><div className="schema-chips">{['categories', 'packages', 'questions', 'options', 'matches', 'targets', 'learning_materials'].map((table) => <code key={table}>{table}</code>)}</div></section>
  </>
}

function StatCard({ label, value, helper, icon }) {
  return <div className="stat-card"><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{helper}</span></div></div>
}

function CategoriesView({ categories, activeCategoryId, onSelect, onAdd, onDelete, onUpdate, onReorder }) {
  return <>
    <PageHeading eyebrow="STRUKTUR KONTEN" title="Kategori" description="Buat kategori untuk mengelompokkan paket latihan dan materi belajar." action={<Button onClick={onAdd}>＋ Kategori baru</Button>} />
    <div className="editor-layout">
      <section className="panel list-panel"><div className="panel-heading"><div><h2>Daftar kategori</h2><p>{categories.length} kategori</p></div></div>
        {categories.length ? <div className="entity-list">{categories.map((category, index) => <button key={category.id} className={`entity-row ${activeCategoryId === category.id ? 'selected' : ''}`} onClick={() => onSelect(category.id)}><span className={`category-dot dot-${index % 5}`}>{category.name.trim().slice(0, 2).toUpperCase() || '??'}</span><span className="entity-copy"><strong>{category.name || 'Kategori tanpa nama'}</strong><small>{category.description || 'Belum ada deskripsi'}</small></span><span className="entity-chevron">›</span></button>)}</div> : <EmptyState title="Belum ada kategori" description="Mulai dengan membuat kategori pertama Anda." action={<Button onClick={onAdd}>Buat kategori</Button>} />}
      </section>
      <section className="panel form-panel">
        {categories.find((item) => item.id === activeCategoryId) ? <CategoryEditor category={categories.find((item) => item.id === activeCategoryId)} index={categories.findIndex((item) => item.id === activeCategoryId)} count={categories.length} onUpdate={onUpdate} onDelete={onDelete} onReorder={onReorder} /> : <EmptyState title="Pilih kategori" description="Pilih kategori dari daftar atau buat kategori baru." />}
      </section>
    </div>
  </>
}

function CategoryEditor({ category, index, count, onUpdate, onDelete, onReorder }) {
  return <><div className="form-panel-heading"><div><span className="eyebrow">DETAIL KATEGORI</span><h2>{category.name || 'Kategori baru'}</h2></div><div className="row-actions"><button className="icon-button" disabled={index === 0} title="Naikkan urutan" onClick={() => onReorder(category.id, -1)}>↑</button><button className="icon-button" disabled={index === count - 1} title="Turunkan urutan" onClick={() => onReorder(category.id, 1)}>↓</button><button className="icon-button danger" title="Hapus kategori" onClick={() => onDelete(category.id)}>⌫</button></div></div>
    <div className="form-stack"><Field label="Nama kategori" required value={category.name} placeholder="Contoh: Tes Wawasan Kebangsaan" onChange={(value) => onUpdate(category.id, { name: value })} /><Field label="Deskripsi" value={category.description} placeholder="Deskripsi singkat kategori" onChange={(value) => onUpdate(category.id, { description: value })} /><div className="hint-box"><span>i</span><p>Kategori yang sama digunakan oleh paket Latihan dan materi Belajar.</p></div></div>
  </>
}

function PackagesView({ categories, packages, activeCategoryId, activeCategory, onSelectCategory, onNavigate, onAdd, onDelete, onUpdate, onReorder }) {
  const shownPackages = packages.filter((item) => item.category_id === activeCategoryId)
  return <>
    <PageHeading eyebrow="LATIHAN MANDIRI" title="Paket latihan" description="Paket mengelompokkan soal yang akan dikerjakan pengguna CBT." action={<Button disabled={!categories.length} onClick={onAdd}>＋ Paket baru</Button>} />
    <div className="filter-bar"><label htmlFor="package-category">Kategori</label><select id="package-category" value={activeCategoryId} onChange={(event) => onSelectCategory(event.target.value)}>{categories.length ? categories.map((category) => <option key={category.id} value={category.id}>{category.name || 'Kategori tanpa nama'}</option>) : <option value="">Buat kategori dahulu</option>}</select><span>{shownPackages.length} paket</span></div>
    {!categories.length ? <EmptyState title="Kategori belum tersedia" description="Tambahkan kategori sebelum membuat paket latihan." action={<Button onClick={() => onNavigate('categories')}>Buat kategori dahulu</Button>} /> : shownPackages.length ? <div className="package-editor-grid">{shownPackages.map((pack, index) => <PackageEditor key={pack.id} pack={pack} index={index} count={shownPackages.length} category={activeCategory} onUpdate={onUpdate} onDelete={onDelete} onReorder={onReorder} />)}</div> : <EmptyState title="Belum ada paket latihan" description={`Buat paket pertama di kategori ${activeCategory?.name || 'ini'}.`} action={<Button onClick={onAdd}>＋ Buat paket</Button>} />}
  </>
}

function PackageEditor({ pack, index, count, category, onUpdate, onDelete, onReorder }) {
  const customDifficulty = pack.difficulty && !DIFFICULTY_LEVELS.some((level) => level.value === pack.difficulty)
  return <section className="panel package-editor"><div className="form-panel-heading"><div><span className="eyebrow">{category?.name || 'KATEGORI'} · PAKET</span><h2>{pack.title || 'Paket tanpa judul'}</h2></div><div className="row-actions"><button className="icon-button" disabled={index === 0} onClick={() => onReorder(pack.id, -1)} title="Naikkan urutan">↑</button><button className="icon-button" disabled={index === count - 1} onClick={() => onReorder(pack.id, 1)} title="Turunkan urutan">↓</button><button className="icon-button danger" onClick={() => onDelete(pack.id)} title="Hapus paket">⌫</button></div></div><div className="form-stack"><Field label="Judul paket" required value={pack.title} placeholder="Contoh: Paket 1" onChange={(value) => onUpdate(pack.id, { title: value })} /><Field label="Deskripsi" value={pack.description} placeholder="Ringkasan isi paket" onChange={(value) => onUpdate(pack.id, { description: value })} /><div className="field"><label htmlFor={`difficulty-${pack.id}`}>Tingkat kesulitan</label><select id={`difficulty-${pack.id}`} value={customDifficulty ? '__custom__' : pack.difficulty} onChange={(event) => onUpdate(pack.id, { difficulty: event.target.value === '__custom__' ? pack.difficulty : event.target.value })}><option value="">Pilih tingkat kesulitan</option>{DIFFICULTY_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}{customDifficulty && <option value="__custom__">{pack.difficulty} (nilai lama)</option>}</select></div></div></section>
}

function QuestionsView({ categories, packages, questions, activePackageId, onSelectPackage, onAdd, onDelete, onUpdate, onReorder, onUpdateOption, onAddOption, onRemoveOption, onAddTarget, apiKey, onAddGeneratedQuestions, imageUrls, onUploadImage, workbookBusy, pendingImport, imageCount, workbookInput, onDownloadTemplate, onSelectWorkbook, onConfirmImport, onCancelImport, onDownloadImages }) {
  const activePackage = packages.find((pack) => pack.id === activePackageId)
  const categoryName = categories.find((category) => category.id === activePackage?.category_id)?.name || ''
  const packageTitle = activePackage?.title || ''
  const selectedQuestions = questions.filter((question) => question.package_id === activePackageId)
  return <>
    <PageHeading eyebrow="KONTEN LATIHAN" title="Bank soal" description="Tulis soal dalam HTML, pilih tipe jawaban, lalu tandai kunci dan bobot nilai." action={<div className="question-heading-actions"><Button kind="secondary" onClick={onDownloadTemplate}>⇩ Template Excel</Button><Button disabled={!packages.length} onClick={onAdd}>＋ Tambah soal</Button></div>} />
    <div className="filter-bar"><label htmlFor="question-package">Paket aktif</label><select id="question-package" value={activePackageId} onChange={(event) => onSelectPackage(event.target.value)}>{packages.length ? packages.map((pack) => <option key={pack.id} value={pack.id}>{pack.title || 'Paket tanpa judul'}</option>) : <option value="">Buat paket dahulu</option>}</select><span>{selectedQuestions.length} soal</span></div>
    <section className="panel workbook-import">
      <div className="workbook-import-copy"><strong>Impor soal dari Excel</strong><span>Unggah .xlsx, termasuk gambar yang ditempel pada sel soal, pembahasan, atau opsi.</span></div>
      <input ref={workbookInput} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onSelectWorkbook} />
      <Button kind="secondary" disabled={!activePackage || workbookBusy} onClick={() => workbookInput.current?.click()}>{workbookBusy ? 'Memproses...' : 'Pilih file .xlsx'}</Button>
      {imageCount > 0 && <Button kind="secondary" disabled={workbookBusy} onClick={onDownloadImages}>⇩ ZIP gambar ({imageCount})</Button>}
    </section>
    {pendingImport && <ImportPreview pendingImport={pendingImport} packageTitle={packages.find((pack) => pack.id === pendingImport.packageId)?.title || 'paket yang dipilih'} activePackageId={activePackageId} workbookBusy={workbookBusy} onConfirm={onConfirmImport} onCancel={onCancelImport} />}
    {!packages.length ? <EmptyState title="Paket latihan belum tersedia" description="Buat kategori dan paket latihan sebelum menambahkan soal." /> : <div className="question-list">{selectedQuestions.map((question, index) => <QuestionEditor key={question.id} question={question} index={index} count={selectedQuestions.length} onDelete={onDelete} onUpdate={onUpdate} onReorder={onReorder} onUpdateOption={onUpdateOption} onAddOption={onAddOption} onRemoveOption={onRemoveOption} onAddTarget={onAddTarget} apiKey={apiKey} categoryName={categoryName} packageTitle={packageTitle} difficulty={activePackage?.difficulty || 'Menengah'} onAddGeneratedQuestions={onAddGeneratedQuestions} imageUrls={imageUrls} onUploadImage={onUploadImage} />)}{!selectedQuestions.length && <EmptyState title="Paket ini belum memiliki soal" description="Tambahkan soal untuk memenuhi struktur minimum database." action={<Button onClick={onAdd}>＋ Tambah soal</Button>} />}{!!activePackage && <button className="add-question-card" onClick={onAdd}>＋ Tambahkan soal ke {activePackage.title || 'paket ini'}</button>}</div>}
  </>
}

function ImportPreview({ pendingImport, packageTitle, activePackageId, workbookBusy, onConfirm, onCancel }) {
  const [imageUrls, setImageUrls] = useState({})
  const [imagePreviewError, setImagePreviewError] = useState('')
  useEffect(() => {
    let cancelled = false
    setImagePreviewError('')
    Promise.all(pendingImport.assets.map((asset) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve([asset.path, String(reader.result)])
      reader.onerror = () => reject(new Error(`Pratinjau gambar ${asset.filename} tidak dapat dibuat.`))
      reader.readAsDataURL(asset.blob)
    }))).then((entries) => {
      if (!cancelled) setImageUrls(Object.fromEntries(entries))
    }).catch((previewError) => {
      if (!cancelled) setImagePreviewError(previewError.message)
    })
    return () => { cancelled = true }
  }, [pendingImport.assets])
  const withPreviewImages = (html) => Object.entries(imageUrls).reduce(
    (content, [path, url]) => content.replaceAll(`src="${path}"`, `src="${url}"`),
    html,
  )

  return <section className="panel import-preview" aria-live="polite">
    <div><span className="eyebrow">PRATINJAU IMPOR</span><h2>{pendingImport.filename}</h2><p>{pendingImport.questions.length} soal siap ditambahkan ke <strong>{packageTitle}</strong>{pendingImport.assets.length ? ` · ${pendingImport.assets.length} gambar akan disimpan` : ''}.</p></div>
    {imagePreviewError && <div className="ai-inline-error" role="alert">{imagePreviewError}</div>}
    <div className="import-preview-list">{pendingImport.questions.slice(0, 5).map((question, index) => <div key={question.id}><b>{index + 1}.</b><span dangerouslySetInnerHTML={safePreview(withPreviewImages(question.content))} /><small>{TYPE_LABEL[question.type]}</small></div>)}{pendingImport.questions.length > 5 && <small>dan {pendingImport.questions.length - 5} soal lainnya</small>}</div>
    <div className="import-preview-actions"><Button disabled={workbookBusy || pendingImport.packageId !== activePackageId} onClick={onConfirm}>{workbookBusy ? 'Menyimpan...' : `＋ Tambahkan ${pendingImport.questions.length} soal`}</Button><Button kind="secondary" disabled={workbookBusy} onClick={onCancel}>Batalkan impor</Button></div>
  </section>
}

function QuestionEditor({ question, index, count, onDelete, onUpdate, onReorder, onUpdateOption, onAddOption, onRemoveOption, onAddTarget, apiKey, categoryName, packageTitle, difficulty, onAddGeneratedQuestions, imageUrls, onUploadImage }) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiQuestionCount, setAiQuestionCount] = useState(3)
  const [aiOptionCount, setAiOptionCount] = useState(4)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const isChoice = ['single_choice', 'multiple_choice', 'complex_choice', 'tkp'].includes(question.type)
  const isTrueFalse = ['true_false', 'true_false_multi'].includes(question.type)
  const usesOptionCount = question.type !== 'essay'
  const generateWithAI = async (event) => {
    event.preventDefault()
    setAiError('')
    setAiBusy(true)
    try {
      const generated = await generateQuestionsWithDeepSeek({
        apiKey,
        question,
        categoryName,
        packageTitle,
        difficulty,
        instructions: aiInstructions,
        optionCount: aiOptionCount,
        questionCount: aiQuestionCount,
      })
      onAddGeneratedQuestions(generated)
      setAiInstructions('')
      setAiOpen(false)
    } catch (generationError) {
      setAiError(generationError.message || 'Soal tidak dapat dibuat dengan DeepSeek.')
    } finally {
      setAiBusy(false)
    }
  }
  const markCorrect = (optionId, checked) => {
    if (['single_choice'].includes(question.type)) {
      onUpdate(question.id, { options: question.options.map((option) => ({ ...option, is_correct: option.id === optionId })) })
    } else onUpdateOption(question, optionId, { is_correct: checked })
  }
  return <details className="panel question-editor" open>
    <summary className="question-summary"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className="question-summary-copy"><strong>{question.content.replace(/<[^>]*>/g, '').trim().slice(0, 90) || 'Soal baru — isi pertanyaan di bawah'}</strong><small>{TYPE_LABEL[question.type]} · {question.type === 'matching' ? `${question.matches.length} pasangan` : question.type === 'essay' ? 'Esai' : `${question.options.length} opsi`}</small></span><span className="question-summary-actions" onClick={(event) => event.stopPropagation()}><button className="icon-button" disabled={index === 0} onClick={() => onReorder(question.id, -1)} title="Naikkan urutan">↑</button><button className="icon-button" disabled={index === count - 1} onClick={() => onReorder(question.id, 1)} title="Turunkan urutan">↓</button><button className="icon-button danger" onClick={() => onDelete(question.id)} title="Hapus soal">⌫</button></span></summary>
    <div className="question-form">
      <div className="question-type-row"><label htmlFor={`type-${question.id}`}>Tipe soal</label><select id={`type-${question.id}`} value={question.type} onChange={(event) => onUpdate(question.id, { type: event.target.value })}>{QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label} · {type.value}</option>)}</select><span>Nilai disimpan tepat seperti tipe CBT.</span></div>
      <section className="ai-generator">
        <div className="ai-generator-heading"><span className="ai-spark">✦</span><div><strong>Buat dengan AI DeepSeek</strong><small>Soal baru ditambahkan ke paket; soal yang sudah ada tidak ditimpa.</small></div><button type="button" className="small-button" onClick={() => { setAiOpen((open) => !open); setAiError('') }}>{aiOpen ? 'Tutup' : '✦ Buat dengan AI'}</button></div>
        {aiOpen && <form className="ai-generator-form" onSubmit={generateWithAI}>
          {!apiKey && <div className="ai-inline-warning" role="alert">API key belum diatur. Tambahkan <code>VITE_DEEPSEEK_API_KEY=...</code> di file <code>.env.local</code>, lalu jalankan ulang Vite.</div>}
          <label className="ai-instruction-label" htmlFor={`ai-instructions-${question.id}`}>Topik, kompetensi, atau materi acuan</label>
          <textarea id={`ai-instructions-${question.id}`} rows="3" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Contoh: Buat soal tentang pelayanan publik dan sikap profesional untuk tingkat kesulitan menengah." />
          <div className="ai-question-count"><label htmlFor={`ai-question-count-${question.id}`}>Jumlah soal sekali generate</label><input id={`ai-question-count-${question.id}`} type="number" min="1" max="10" value={aiQuestionCount} onChange={(event) => setAiQuestionCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /><small>1–10 soal baru</small></div>
          {usesOptionCount && <div className="ai-option-count"><label htmlFor={`ai-count-${question.id}`}>{question.type === 'matching' ? 'Jumlah pasangan' : ['true_false', 'true_false_multi'].includes(question.type) ? 'Jumlah pernyataan' : 'Jumlah opsi jawaban'}</label><input id={`ai-count-${question.id}`} type="number" min="2" max="8" value={aiOptionCount} onChange={(event) => setAiOptionCount(Math.max(2, Math.min(8, Number(event.target.value) || 2)))} /><small>2–8</small></div>}
          <p className="ai-privacy-note">Topik dan isi soal saat ini dikirim ke API DeepSeek untuk membuat konten. Tinjau kembali kunci dan pembahasan sebelum dipakai. Maksimal 10 soal per permintaan.</p>
          {aiError && <div className="ai-inline-error" role="alert">{aiError}</div>}
          <button className="button button-primary ai-submit" type="submit" disabled={!apiKey || !aiInstructions.trim() || aiBusy}>{aiBusy ? <><span className="ai-spinner" /> Membuat {aiQuestionCount} soal...</> : `✦ Generate ${aiQuestionCount} soal, opsi & pembahasan`}</button>
        </form>}
      </section>
      <RichField label={`Isi soal ${index + 1}`} value={question.content} onChange={(value) => onUpdate(question.id, { content: value })} rows={4} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={140} />
      {isChoice && <div className="options-section"><div className="section-subheading"><div><h3>Pilihan jawaban</h3><p>{question.type === 'tkp' ? 'Bobot tertinggi menjadi jawaban terbaik TKP.' : question.type === 'single_choice' ? 'Pilih satu kunci jawaban.' : 'Tandai semua opsi yang menjadi kunci.'}</p></div><button className="small-button" onClick={() => onAddOption(question)}>＋ Tambah opsi</button></div>{question.options.map((option, optionIndex) => <OptionEditorRow key={option.id} option={option} index={optionIndex} question={question} imageUrls={imageUrls} onUploadImage={onUploadImage} onUpdate={(patch) => onUpdateOption(question, option.id, patch)} onRemove={() => onRemoveOption(question, option.id)} onMarkCorrect={(checked) => markCorrect(option.id, checked)} />)}</div>}
      {isTrueFalse && <div className="options-section"><div className="section-subheading"><div><h3>Pernyataan</h3><p>CBT menyimpan <code>is_correct=1</code> untuk pernyataan benar.</p></div><button className="small-button" onClick={() => onAddOption(question)}>＋ Tambah pernyataan</button></div>{question.options.map((option, optionIndex) => <TrueFalseEditorRow key={option.id} option={option} index={optionIndex} imageUrls={imageUrls} onUploadImage={onUploadImage} onUpdate={(patch) => onUpdateOption(question, option.id, patch)} onRemove={() => onRemoveOption(question, option.id)} />)}</div>}
      {question.type === 'matching' && <MatchingEditor question={question} onUpdate={onUpdate} onAddTarget={onAddTarget} imageUrls={imageUrls} onUploadImage={onUploadImage} />}
      {question.type === 'essay' && <div className="hint-box"><span>i</span><p>Jawaban esai tidak memiliki opsi/kunci otomatis dan perlu diperiksa secara manual di aplikasi CBT.</p></div>}
      <RichField label={`Pembahasan ${index + 1}`} value={question.explanation} onChange={(value) => onUpdate(question.id, { explanation: value })} rows={3} placeholder="Tulis pembahasan (opsional)" imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={110} />
    </div>
  </details>
}

function OptionEditorRow({ option, index, question, imageUrls, onUploadImage, onUpdate, onRemove, onMarkCorrect }) {
  const letter = String.fromCharCode(65 + index)
  return <div className="option-editor">
    <span className="option-letter">{letter}</span>
    <div className="option-text-field">
      <RichField label={`Opsi ${letter}`} value={option.option_text} onChange={(value) => onUpdate({ option_text: value })} rows={2} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={70} />
    </div>
    {question.type !== 'tkp' && <label className="check-field"><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={`correct-${question.id}`} checked={option.is_correct} onChange={(event) => onMarkCorrect(event.target.checked)} /><span>{option.is_correct ? 'Kunci' : 'Benar'}</span></label>}
    <div className="weight-field"><label htmlFor={`weight-${option.id}`}>Bobot</label><input id={`weight-${option.id}`} type="number" step="any" value={option.score_weight ?? ''} placeholder={question.type === 'tkp' ? 'Wajib' : 'Opsional'} onChange={(event) => onUpdate({ score_weight: event.target.value === '' ? null : event.target.value })} /></div>
    <button className="icon-button danger" onClick={onRemove} aria-label="Hapus opsi">×</button>
  </div>
}

function TrueFalseEditorRow({ option, index, imageUrls, onUploadImage, onUpdate, onRemove }) {
  return <div className="option-editor tf-editor">
    <span className="option-letter">{index + 1}</span>
    <div className="option-text-field">
      <RichField label={`Pernyataan ${index + 1}`} value={option.option_text} onChange={(value) => onUpdate({ option_text: value })} rows={2} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={70} />
    </div>
    <label className="check-field"><input type="checkbox" checked={option.is_correct} onChange={(event) => onUpdate({ is_correct: event.target.checked })} /><span>{option.is_correct ? 'Benar' : 'Salah'}</span></label>
    <button className="icon-button danger" onClick={onRemove} aria-label="Hapus pernyataan">×</button>
  </div>
}

function MatchingEditor({ question, onUpdate, onAddTarget, imageUrls, onUploadImage }) {
  const updateMatch = (id, patch) => onUpdate(question.id, { matches: question.matches.map((item) => item.id === id ? { ...item, ...patch } : item) })
  const updateTarget = (id, target_text) => onUpdate(question.id, { targets: question.targets.map((item) => item.id === id ? { ...item, target_text } : item) })
  const removeMatch = (id) => onUpdate(question.id, { matches: question.matches.filter((item) => item.id !== id) })
  const removeTarget = (id) => onUpdate(question.id, {
    targets: question.targets.filter((item) => item.id !== id),
    matches: question.matches.map((item) => item.target_id === id ? { ...item, target_id: '' } : item),
  })
  return <div className="options-section matching-section"><div className="section-subheading"><div><h3>Pasangan soal</h3><p>Setiap pernyataan dihubungkan ke ID target jawaban yang benar.</p></div><button className="small-button" onClick={() => onAddTarget(question)}>＋ Tambah pasangan</button></div><div className="matching-head"><span>Pernyataan</span><span>Target jawaban</span></div>{question.matches.map((match, index) => <div className="matching-editor-row" key={match.id}><div><RichField label={`Pernyataan pasangan ${index + 1}`} value={match.premise_text} onChange={(value) => updateMatch(match.id, { premise_text: value })} rows={2} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={70} /></div><div><label htmlFor={`match-target-${match.id}`}>Kunci pasangan</label><select id={`match-target-${match.id}`} value={match.target_id} onChange={(event) => updateMatch(match.id, { target_id: event.target.value })}><option value="">Pilih target...</option>{question.targets.map((target) => <option key={target.id} value={target.id}>{target.target_text.replace(/<[^>]*>/g, '').trim() || '(target kosong)'}</option>)}</select></div><button className="icon-button danger" onClick={() => removeMatch(match.id)} aria-label="Hapus pernyataan">×</button></div>)}<div className="target-list"><h4>Pilihan target yang tersedia</h4>{question.targets.map((target, index) => <div className="target-editor-row" key={target.id}><span>{String.fromCharCode(65 + index)}</span><RichField label={`Target pasangan ${index + 1}`} value={target.target_text} onChange={(value) => updateTarget(target.id, value)} rows={1} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={50} /><button className="icon-button danger" onClick={() => removeTarget(target.id)} aria-label="Hapus target">×</button></div>)}</div></div>
}

function MaterialsView({ categories, materials, activeCategoryId, onSelectCategory, onAdd, onDelete, onUpdate, onReorder, apiKey, imageUrls, onUploadImage }) {
  const shown = materials.filter((item) => activeCategoryId ? item.category_id === activeCategoryId : !item.category_id)
  const category = categories.find((item) => item.id === activeCategoryId)
  return <>
    <PageHeading eyebrow="BELAJAR MANDIRI" title="Materi belajar" description="Susun materi HTML yang akan dibaca pengguna di halaman Belajar aplikasi CBT." action={<Button onClick={onAdd}>＋ Materi baru</Button>} />
    <div className="filter-bar"><label htmlFor="material-category">Kategori</label><select id="material-category" value={activeCategoryId} onChange={(event) => onSelectCategory(event.target.value)}><option value="">Tanpa kategori</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name || 'Kategori tanpa nama'}</option>)}</select><span>{shown.length} materi {category ? `di ${category.name}` : 'tanpa kategori'}</span></div>
    {shown.length ? <div className="material-list">{shown.map((material, index) => <MaterialEditor key={material.id} material={material} index={index} count={shown.length} categoryName={category?.name || ''} apiKey={apiKey} imageUrls={imageUrls} onUploadImage={onUploadImage} onUpdate={onUpdate} onDelete={onDelete} onReorder={onReorder} />)}</div> : <EmptyState title="Belum ada materi di sini" description="Materi disimpan dalam tabel learning_materials dan dapat ditautkan ke kategori." action={<Button onClick={onAdd}>＋ Buat materi</Button>} />}
  </>
}

function MaterialEditor({ material, index, count, categoryName, apiKey, imageUrls, onUploadImage, onUpdate, onDelete, onReorder }) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const generateMaterial = async (event) => {
    event.preventDefault()
    setAiError('')
    setAiBusy(true)
    try {
      const generated = await generateLearningMaterialWithDeepSeek({ apiKey, categoryName, instructions: aiInstructions })
      onUpdate(material.id, generated)
      setAiInstructions('')
      setAiOpen(false)
    } catch (generationError) {
      setAiError(generationError.message || 'Materi tidak dapat dibuat dengan DeepSeek.')
    } finally {
      setAiBusy(false)
    }
  }

  return <section className="panel material-editor">
    <div className="form-panel-heading"><div><span className="eyebrow">MATERI BELAJAR</span><h2>{material.title || 'Materi baru'}</h2></div><div className="row-actions"><button className="icon-button" disabled={index === 0} onClick={() => onReorder(material.id, -1)} title="Naikkan urutan">↑</button><button className="icon-button" disabled={index === count - 1} onClick={() => onReorder(material.id, 1)} title="Turunkan urutan">↓</button><button className="icon-button danger" onClick={() => onDelete(material.id)} title="Hapus materi">⌫</button></div></div>
    <div className="form-stack material-form">
      <section className="ai-generator">
        <div className="ai-generator-heading"><span className="ai-spark">✦</span><div><strong>Buat materi dengan AI DeepSeek</strong><small>Hasil akan mengisi judul, ringkasan, dan isi materi editor ini.</small></div><button type="button" className="small-button" onClick={() => { setAiOpen((open) => !open); setAiError('') }}>{aiOpen ? 'Tutup' : '✦ Buat materi'}</button></div>
        {aiOpen && <form className="ai-generator-form" onSubmit={generateMaterial}>
          {!apiKey && <div className="ai-inline-warning" role="alert">API key belum diatur. Tambahkan <code>VITE_DEEPSEEK_API_KEY</code> di <code>.env.local</code>.</div>}
          <label htmlFor={`ai-material-${material.id}`}>Topik dan arahan materi</label>
          <textarea id={`ai-material-${material.id}`} rows="3" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Contoh: Jelaskan prinsip-prinsip Pancasila, sertakan contoh penerapannya dan rangkuman." />
          <p className="ai-privacy-note">Topik dikirim ke API DeepSeek. Hasil berupa HTML profesional; periksa kembali ketepatan fakta sebelum digunakan.</p>
          {aiError && <div className="ai-inline-error" role="alert">{aiError}</div>}
          <button className="button button-primary ai-submit" type="submit" disabled={!apiKey || !aiInstructions.trim() || aiBusy}>{aiBusy ? <><span className="ai-spinner" /> Menyusun materi...</> : '✦ Generate judul, ringkasan & materi'}</button>
        </form>}
      </section>
      <Field label="Judul materi" required value={material.title} placeholder="Contoh: Pancasila sebagai Dasar Negara" onChange={(value) => onUpdate(material.id, { title: value })} />
      <Field label="Ringkasan" value={material.summary} placeholder="Ringkasan yang tampil di daftar materi" onChange={(value) => onUpdate(material.id, { summary: value })} />
      <RichField label={`Isi materi ${index + 1}`} value={material.content} onChange={(value) => onUpdate(material.id, { content: value })} rows={8} imageUrls={imageUrls} onUploadImage={onUploadImage} minHeight={240} />
    </div>
  </section>
}

function PreviewView({ data, validation, onExport, onExportWorkbook, onExportImages, imageCount, busy }) {
  const tables = [
    ['categories', data.categories.map((item, index) => ({ ...item, sort_order: index + 1 })), 'Kategori'],
    ['packages', data.packages.map((item) => ({ ...item, sort_order: data.packages.filter((candidate) => candidate.category_id === item.category_id).findIndex((candidate) => candidate.id === item.id) + 1 })), 'Paket'],
    ['questions', data.questions.map((item) => ({ ...item, position: data.questions.filter((candidate) => candidate.package_id === item.package_id).findIndex((candidate) => candidate.id === item.id) + 1 })), 'Soal'],
    ['options', data.questions.flatMap((item) => OPTION_QUESTION_TYPES.includes(item.type) ? (item.options || []).map((option, index) => ({ ...option, is_correct: option.is_correct ? 1 : 0, position: index + 1 })) : []), 'Opsi jawaban'],
    ['matches', data.questions.flatMap((item) => (item.matches || []).map((match, index) => ({ ...match, id: createMatchRowId(item.id, index) }))), 'Pasangan'],
    ['targets', data.questions.flatMap((item) => (item.targets || []).map((target, index) => ({ ...target, position: index + 1 }))), 'Target jawaban'],
    ['learning_materials', data.materials.map((item, index) => ({ ...item, sort_order: index + 1 })), 'Materi belajar'],
  ]
  return <>
    <PageHeading eyebrow="PEMERIKSAAN DATABASE" title="Pratinjau & ekspor" description="Tinjau isi database dan ekspor soal, gambar, atau database SQLite." action={<div className="export-actions">
      <Button kind="secondary" disabled={busy || !data.questions.length} onClick={onExportWorkbook}>⇩ Soal Excel</Button>
      <Button kind="secondary" disabled={busy || !imageCount} onClick={onExportImages}>⇩ Gambar ZIP ({imageCount})</Button>
      <Button disabled={busy || validation.errors.length > 0} onClick={onExport}>{busy ? 'Membuat...' : '⇩ Database .db'}</Button>
    </div>} />
    <section className={`validation-banner ${validation.errors.length ? 'validation-banner-error' : 'validation-banner-good'}`}><span className="validation-banner-icon">{validation.errors.length ? '!' : '✓'}</span><div><strong>{validation.errors.length ? `${validation.errors.length} kesalahan perlu diperbaiki` : 'Validasi konten berhasil'}</strong><p>{validation.errors.length ? 'Database belum dapat diunduh sampai seluruh kesalahan wajib diselesaikan.' : 'Struktur, referensi, dan data minimum siap diekspor.'}</p></div></section>
    {(validation.errors.length > 0 || validation.warnings.length > 0) && <section className="panel check-panel"><div className="panel-heading"><div><span className="eyebrow">HASIL PEMERIKSAAN</span><h2>Validasi konten</h2></div><span className="check-total">{validation.errors.length + validation.warnings.length} item</span></div>{validation.errors.length > 0 && <div className="check-group"><h3>Kesalahan</h3><ul className="issue-list">{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></div>}{validation.warnings.length > 0 && <div className="check-group warnings"><h3>Peringatan</h3><ul className="issue-list">{validation.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}</section>}
    <section className="panel preview-panel"><div className="panel-heading"><div><span className="eyebrow">ISI FILE SQLITE</span><h2>Pratinjau tabel</h2><p>Tabel konten yang akan ditulis dalam file .db.</p></div><span className="schema-badge">SQLite · Foreign key ON</span></div><div className="table-preview">{tables.map(([table, rows, label]) => <details className="table-row" key={table}><summary><code>{table}</code><span>{label}</span><b>{rows.length}</b><i>baris</i><em>⌄</em></summary><div className="table-sample">{rows.length ? <PreviewRows table={table} rows={rows.slice(0, 5)} /> : <p>Tabel ini belum memiliki data.</p>}{rows.length > 5 && <small>Menampilkan 5 dari {rows.length} baris. Semua data tetap diekspor.</small>}</div></details>)}</div></section>
    <section className="export-note"><span>i</span><p>File menggunakan skema yang kompatibel dengan importir database latihan CBT. Jawaban pengguna dan pengaturan koreksi tidak diekspor; aplikasi CBT menyimpan data tersebut secara lokal.</p></section>
  </>
}

function PreviewRows({ table, rows }) {
  const columns = {
    categories: ['id', 'name', 'description', 'sort_order'],
    packages: ['id', 'category_id', 'title', 'difficulty', 'sort_order'],
    questions: ['id', 'package_id', 'position', 'type'],
    options: ['id', 'question_id', 'is_correct', 'score_weight', 'position'],
    matches: ['id', 'question_id', 'premise_text', 'target_id'],
    targets: ['id', 'question_id', 'target_text', 'position'],
    learning_materials: ['id', 'category_id', 'title', 'summary', 'sort_order'],
  }[table]
  const getValue = (row, key) => {
    if (key === 'option_text') return row.option_text
    if (key === 'premise_text') return row.premise_text
    if (key === 'target_text') return row.target_text
    const value = row[key]
    return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : String(value ?? '—')
  }
  const shownColumns = table === 'options' ? [...columns, 'option_text'] : columns
  return <div className="table-scroll"><table><thead><tr>{shownColumns.map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{shownColumns.map((key) => <td key={key}>{getValue(row, key) || '—'}</td>)}</tr>)}</tbody></table></div>
}

export default App
