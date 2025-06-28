import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

export class PDFProcessor {
  constructor() {
    this.document = null
    this.pages = []
    this.blocks = []
    this.sentences = []
    this.headings = []
    this.paragraphs = []
  }

  async loadDocument(file) {
    console.log('PDFProcessor.loadDocument called with:', file)
    try {
      const arrayBuffer = await file.arrayBuffer()
      console.log('File converted to ArrayBuffer, size:', arrayBuffer.byteLength)
      this.document = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      console.log('PDF document loaded, pages:', this.document.numPages)
      return this.document
    } catch (error) {
      console.error('Error loading PDF:', error)
      throw error
    }
  }

  async processDocument() {
    if (!this.document) {
      throw new Error('No document loaded')
    }

    const numPages = this.document.numPages
    console.log(`Processing ${numPages} pages...`)
    
    // For testing, limit to first 10 pages
    const pagesToProcess = Math.min(numPages, 10)
    console.log(`Processing first ${pagesToProcess} pages for testing`)
    
    const allBlocks = []
    const allSentences = []
    const allHeadings = []
    const allParagraphs = []

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      console.log(`Processing page ${pageNum}/${pagesToProcess}...`)
      const page = await this.document.getPage(pageNum)
      const pageBlocks = await this.processPage(page, pageNum)
      
      // Analyze page blocks for structural elements
      const { headings, paragraphs, sentences } = this.analyzeStructure(pageBlocks)
      
      allBlocks.push(...pageBlocks)
      allHeadings.push(...headings)
      allParagraphs.push(...paragraphs)
      allSentences.push(...sentences)
      
      console.log(`Page ${pageNum} completed: ${pageBlocks.length} blocks`)
    }

    this.blocks = allBlocks
    this.headings = allHeadings
    this.paragraphs = allParagraphs
    this.sentences = allSentences

    console.log(`Total processing completed: ${allBlocks.length} blocks across ${pagesToProcess} pages`)

    return {
      blocks: allBlocks,
      headings: allHeadings,
      paragraphs: allParagraphs,
      sentences: allSentences
    }
  }

  async processPage(page, pageNum) {
    const viewport = page.getViewport({ scale: 1.0 })
    const textContent = await page.getTextContent()
    
    const blocks = this.extractBlocks(textContent, viewport, pageNum)
    return blocks
  }

  extractBlocks(textContent, viewport, pageNum) {
    console.log(`Extracting blocks for page ${pageNum}`)
    console.log('Text content items:', textContent.items.length)
    console.log('Sample text item:', textContent.items[0])
    
    const blocks = []
    let currentBlock = null
    let blockId = 1

    for (const item of textContent.items) {
      const fontSize = item.height
      const text = item.str.trim()
      
      if (!text) continue

      // Determine if this is a new block based on position and font size
      const isNewBlock = this.shouldStartNewBlock(item, currentBlock)
      
      if (isNewBlock || !currentBlock) {
        if (currentBlock) {
          blocks.push(currentBlock)
        }
        
        currentBlock = {
          id: `${pageNum}-${blockId++}`,
          pageNum,
          text: text,
          fontSize: fontSize,
          fontFamily: item.fontName,
          bbox: {
            x0: item.transform[4],
            y0: viewport.height - item.transform[5],
            x1: item.transform[4] + item.width,
            y1: viewport.height - item.transform[5] + item.height
          },
          words: [{
            text: text,
            bbox: {
              x0: item.transform[4],
              y0: viewport.height - item.transform[5],
              x1: item.transform[4] + item.width,
              y1: viewport.height - item.transform[5] + item.height
            }
          }],
          type: 'text' // Will be refined by structure analysis
        }
      } else {
        // Add to current block
        currentBlock.text += ' ' + text
        currentBlock.words.push({
          text: text,
          bbox: {
            x0: item.transform[4],
            y0: viewport.height - item.transform[5],
            x1: item.transform[4] + item.width,
            y1: viewport.height - item.transform[5] + item.height
          }
        })
        
        // Update block bbox
        currentBlock.bbox.x1 = Math.max(currentBlock.bbox.x1, item.transform[4] + item.width)
        currentBlock.bbox.y0 = Math.min(currentBlock.bbox.y0, viewport.height - item.transform[5])
        currentBlock.bbox.y1 = Math.max(currentBlock.bbox.y1, viewport.height - item.transform[5] + item.height)
      }
    }

    if (currentBlock) {
      blocks.push(currentBlock)
    }

    console.log(`Extracted ${blocks.length} blocks for page ${pageNum}`)
    console.log('Sample block:', blocks[0])
    return blocks
  }

  shouldStartNewBlock(item, currentBlock) {
    if (!currentBlock) return true

    const fontSize = item.height
    const currentFontSize = currentBlock.fontSize
    
    // Check for significant font size difference (likely heading)
    if (Math.abs(fontSize - currentFontSize) > 2) {
      return true
    }

    // Check for vertical spacing (new paragraph)
    const verticalGap = Math.abs(item.transform[5] - currentBlock.words[currentBlock.words.length - 1].bbox.y0)
    if (verticalGap > fontSize * 1.5) {
      return true
    }

    // Check for horizontal position (new column or section)
    const horizontalGap = Math.abs(item.transform[4] - currentBlock.bbox.x0)
    if (horizontalGap > 100) {
      return true
    }

    return false
  }

  analyzeStructure(blocks) {
    const headings = []
    const paragraphs = []
    const sentences = []
    let sentenceId = 1

    // Analyze font sizes to identify headings
    const fontSizes = blocks.map(b => b.fontSize).sort((a, b) => b - a)
    const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)]
    const headingThreshold = medianFontSize * 1.2

    blocks.forEach((block) => {
      // Detect headings based on font size and position
      const isHeading = this.isHeading(block, blocks, headingThreshold)
      
      if (isHeading) {
        block.type = 'heading'
        block.level = this.determineHeadingLevel(block, blocks)
        headings.push(block)
      } else {
        block.type = 'paragraph'
        paragraphs.push(block)
      }

      // Extract sentences from block text
      const blockSentences = this.extractSentences(block, sentenceId)
      sentences.push(...blockSentences)
      sentenceId += blockSentences.length
    })

    return { headings, paragraphs, sentences }
  }

  isHeading(block, allBlocks, threshold) {
    // Large font size
    if (block.fontSize > threshold) {
      return true
    }

    // Short text (likely heading)
    if (block.text.length < 100 && block.text.length > 3) {
      // Check if it's not just a short paragraph
      const words = block.text.split(' ')
      if (words.length <= 8) {
        return true
      }
    }

    // All caps text
    if (block.text === block.text.toUpperCase() && block.text.length > 3) {
      return true
    }

    // Check for numbering patterns (1.2, 1.2.3, etc.)
    if (/^\d+(\.\d+)*\s+/.test(block.text)) {
      return true
    }

    return false
  }

  determineHeadingLevel(block, allBlocks) {
    // Simple heuristic based on font size
    const fontSizes = allBlocks.map(b => b.fontSize).sort((a, b) => b - a)
    const maxFontSize = Math.max(...fontSizes)
    const minFontSize = Math.min(...fontSizes)
    const range = maxFontSize - minFontSize
    
    if (range === 0) return 1
    
    const normalizedSize = (block.fontSize - minFontSize) / range
    
    if (normalizedSize > 0.8) return 1
    if (normalizedSize > 0.6) return 2
    if (normalizedSize > 0.4) return 3
    return 4
  }

  extractSentences(block, startId) {
    const sentences = []
    const text = block.text
    
    // Split by sentence endings
    const sentenceRegex = /[^.!?]+[.!?]+/g
    const matches = text.match(sentenceRegex)
    
    if (!matches) {
      // Single sentence
      sentences.push({
        id: startId,
        text: text.trim(),
        blockId: block.id,
        pageNum: block.pageNum,
        bbox: block.bbox
      })
    } else {
      matches.forEach((sentence, index) => {
        sentences.push({
          id: startId + index,
          text: sentence.trim(),
          blockId: block.id,
          pageNum: block.pageNum,
          bbox: block.bbox
        })
      })
    }

    return sentences
  }

  // Smart pattern matching for bulk editing
  findSimilarBlocks(pattern, blocks) {
    const matches = []
    
    blocks.forEach(block => {
      let score = 0
      
      // Font size similarity
      if (Math.abs(block.fontSize - pattern.fontSize) < 2) {
        score += 0.3
      }
      
      // Text length similarity
      const lengthDiff = Math.abs(block.text.length - pattern.text.length)
      const maxLength = Math.max(block.text.length, pattern.text.length)
      if (maxLength > 0) {
        score += 0.3 * (1 - lengthDiff / maxLength)
      }
      
      // Position similarity (same vertical position)
      const posDiff = Math.abs(block.bbox.y0 - pattern.bbox.y0)
      if (posDiff < 50) {
        score += 0.4
      }
      
      if (score > 0.6) {
        matches.push({ block, score })
      }
    })
    
    return matches.sort((a, b) => b.score - a.score)
  }

  // Export functions
  exportToMarkdown() {
    let markdown = ''
    
    this.blocks.forEach(block => {
      if (block.type === 'heading') {
        const level = '#'.repeat(Math.min(block.level, 6))
        markdown += `${level} ${block.text}\n\n`
      } else {
        markdown += `${block.text}\n\n`
      }
    })
    
    return markdown.trim()
  }

  exportToJSON() {
    return {
      blocks: this.blocks,
      headings: this.headings,
      paragraphs: this.paragraphs,
      sentences: this.sentences
    }
  }

  exportToHTML() {
    let html = '<div class="document">\n'
    
    this.blocks.forEach(block => {
      if (block.type === 'heading') {
        const tag = `h${Math.min(block.level, 6)}`
        html += `  <${tag}>${block.text}</${tag}>\n`
      } else {
        html += `  <p>${block.text}</p>\n`
      }
    })
    
    html += '</div>'
    return html
  }
} 