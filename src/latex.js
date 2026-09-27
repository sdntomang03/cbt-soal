const LATEX_DELIMITER_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|\$[^$\r\n]+\$)/g

export function renderLatexInHtml(html, katex) {
  const parsed = new DOMParser().parseFromString(html || '', 'text/html')
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT)
  const textNodes = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement?.closest('code, pre, script, style, .katex, .ql-formula')) continue
    if (LATEX_DELIMITER_PATTERN.test(node.textContent || '')) {
      LATEX_DELIMITER_PATTERN.lastIndex = 0
      textNodes.push(node)
    }
    LATEX_DELIMITER_PATTERN.lastIndex = 0
  }

  for (const textNode of textNodes) {
    const fragment = parsed.createDocumentFragment()
    const text = textNode.textContent || ''
    let previousIndex = 0
    for (const match of text.matchAll(LATEX_DELIMITER_PATTERN)) {
      const index = match.index ?? 0
      if (index > previousIndex) fragment.append(parsed.createTextNode(text.slice(previousIndex, index)))

      const source = match[0]
      const displayMode = source.startsWith('$$') || source.startsWith('\\[')
      const expression = displayMode
        ? source.slice(2, -2)
        : source.startsWith('\\(')
          ? source.slice(2, -2)
          : source.slice(1, -1)
      const formula = parsed.createElement(displayMode ? 'div' : 'span')
      formula.className = `latex-rendered${displayMode ? ' latex-rendered-display' : ''}`
      formula.innerHTML = katex.renderToString(expression, {
        displayMode,
        output: 'htmlAndMathml',
        throwOnError: false,
      })
      fragment.append(formula)
      previousIndex = index + source.length
    }
    if (previousIndex < text.length) fragment.append(parsed.createTextNode(text.slice(previousIndex)))
    textNode.replaceWith(fragment)
  }
  return parsed.body.innerHTML
}
