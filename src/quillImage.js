let registered = false

function imagePathFromSource(source) {
  if (typeof source !== 'string' || !source.trim()) return ''
  try {
    const parsed = new URL(source, window.location.origin)
    if (parsed.pathname === '/api/image') {
      const path = parsed.searchParams.get('path') || ''
      return path.startsWith('images/') ? path : ''
    }
  } catch {
    return ''
  }
  const path = source.replace(/^\/+/, '').replace(/^public\//i, '')
  return path.startsWith('images/') ? path : ''
}

function editorImageUrl(path) {
  return `/api/image?path=${encodeURIComponent(path)}`
}

export function serializeQuillHtml(html) {
  const parsed = new DOMParser().parseFromString(html || '', 'text/html')
  parsed.querySelectorAll('img[src]').forEach((image) => {
    const path = imagePathFromSource(image.getAttribute('src'))
    if (path) image.setAttribute('src', path)
  })
  return parsed.body.innerHTML
}

export function registerResizableImage(Quill) {
  if (registered) return
  const ImageBlot = Quill.import('formats/image')

  class ResizableImage extends ImageBlot {
    static create(value) {
      const node = super.create(value)
      const path = imagePathFromSource(value)
      if (path) node.setAttribute('src', editorImageUrl(path))
      return node
    }

    static value(node) {
      const path = imagePathFromSource(node.getAttribute('src'))
      return path || super.value(node)
    }

    static formats(node) {
      const formats = super.formats(node) || {}
      const width = node.getAttribute('width')
      if (width) formats.width = width
      return formats
    }

    format(name, value) {
      if (name === 'width') {
        if (value) this.domNode.setAttribute('width', String(value))
        else this.domNode.removeAttribute('width')
        return
      }
      super.format(name, value)
    }
  }

  ResizableImage.blotName = 'image'
  ResizableImage.tagName = 'IMG'
  Quill.register(ResizableImage, true)
  registered = true
}
