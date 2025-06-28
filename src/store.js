import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

// PDF processing state
const usePDFStore = create(
  devtools(
    (set, get) => ({
      // PDF document state
      document: null,
      pages: [],
      currentPage: 1,
      totalPages: 0,
      scale: 1.0,
      
      // Structural elements
      blocks: [],
      sentences: [],
      headings: [],
      paragraphs: [],
      
      // Editing state
      selectedBlocks: new Set(),
      editingMode: 'select', // 'view', 'select', 'edit'
      bulkEditPattern: null,
      
      // Processing state
      isProcessing: false,
      processingProgress: 0,
      
      // Export state
      exportFormat: 'markdown', // 'markdown', 'json', 'html'
      exportContent: '',
      
      // Actions
      setDocument: (document) => set({ document }),
      
      setPages: (pages) => set({ pages, totalPages: pages.length }),
      
      setTotalPages: (totalPages) => set({ totalPages }),
      
      setCurrentPage: (page) => set({ currentPage: page }),
      
      setScale: (scale) => set({ scale }),
      
      setBlocks: (blocks) => set({ blocks }),
      
      setSentences: (sentences) => set({ sentences }),
      
      setHeadings: (headings) => set({ headings }),
      
      setParagraphs: (paragraphs) => set({ paragraphs }),
      
      toggleBlockSelection: (blockId) => {
        const { selectedBlocks } = get()
        const newSelected = new Set(selectedBlocks)
        if (newSelected.has(blockId)) {
          newSelected.delete(blockId)
        } else {
          newSelected.add(blockId)
        }
        set({ selectedBlocks: newSelected })
      },
      
      clearSelection: () => set({ selectedBlocks: new Set() }),
      
      setEditingMode: (mode) => set({ editingMode: mode }),
      
      setBulkEditPattern: (pattern) => set({ bulkEditPattern: pattern }),
      
      setIsProcessing: (isProcessing) => set({ isProcessing }),
      
      setProcessingProgress: (progress) => set({ processingProgress: progress }),
      
      setExportFormat: (format) => set({ exportFormat: format }),
      
      setExportContent: (content) => set({ exportContent: content }),
      
      // Bulk operations
      applyBulkEdit: (operation) => {
        const { blocks, selectedBlocks } = get()
        const updatedBlocks = blocks.map(block => {
          if (selectedBlocks.has(block.id)) {
            return { ...block, ...operation }
          }
          return block
        })
        set({ blocks: updatedBlocks })
      },
      
      // Reset state
      reset: () => set({
        document: null,
        pages: [],
        currentPage: 1,
        totalPages: 0,
        scale: 1.0,
        blocks: [],
        sentences: [],
        headings: [],
        paragraphs: [],
        selectedBlocks: new Set(),
        editingMode: 'view',
        bulkEditPattern: null,
        isProcessing: false,
        processingProgress: 0,
        exportFormat: 'markdown',
        exportContent: ''
      })
    }),
    { name: 'pdf-store' }
  )
)

export default usePDFStore 