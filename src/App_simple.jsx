import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './App.css'
import { useState, useRef, useEffect } from 'react'
import * as fuzz from 'fuzzball'
import ReactMarkdown from 'react-markdown'

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'

const API_URL = 'http://localhost:5001/api'

// Helper: Levenshtein distance
function levenshtein(a, b) {
  const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

// Utility function to normalize text for comparison
function normalize(str) {
  return str
    .replace(/[""'':,;\-]/g, '')  // Remove quotes, colons, semicolons, hyphens
    .replace(/[^\w\s]/g, '')      // Remove all non-word, non-space characters
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .toLowerCase()
    .trim();
}

function App() {
  const [numPages, setNumPages] = useState(null)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pdfInfo, setPdfInfo] = useState(null)
  const [pageRange, setPageRange] = useState([1, 1])
  const [chatMessages, setChatMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [highlightRefs, setHighlightRefs] = useState([])
  const pdfViewerRef = useRef()
  const documentRef = useRef()
  // Add state to track last used page range for mapping references
  const [lastPageRange, setLastPageRange] = useState([1, 1])
  const pageRefs = useRef([])
  
  // Enhanced highlighting state management
  const [currentPage, setCurrentPage] = useState(null)
  const [highlightedQuote, setHighlightedQuote] = useState(null)
  const [highlightedFragmentIndices, setHighlightedFragmentIndices] = useState({}) // { [pageNum]: Set(indices) }
  const [textLayerReady, setTextLayerReady] = useState({}) // { [pageNum]: true }
  const [highlightWarning, setHighlightWarning] = useState(null)
  const [lastHighlightCall, setLastHighlightCall] = useState(null)
  
  // Enhanced state for match quality and debugging
  const [matchQuality, setMatchQuality] = useState({}) // { [pageNum]: { score, strategy, confidence } }
  const pageTextFragments = useRef({}) // { [pageNum]: [{str, itemIdx}] }

  // New state for PDF.js search functionality
  const [pdfDocument, setPdfDocument] = useState(null)


  // Landing modal state management
  const [showLandingModal, setShowLandingModal] = useState(true)
  const [existingDocuments, setExistingDocuments] = useState([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [showExistingDocuments, setShowExistingDocuments] = useState(false)
  const [editingDocument, setEditingDocument] = useState(null)
  const [newDocumentName, setNewDocumentName] = useState('')
  const [deletingDocument, setDeletingDocument] = useState(null)
  
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState(null)
  const [deletingInProgress, setDeletingInProgress] = useState(false)
  
  // OCR progress modal state

  // Upload progress state
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  
  // OCR progress state
  const [ocrProgress, setOcrProgress] = useState(0)
  const [processingOcr, setProcessingOcr] = useState(false)
  
  // Enhanced page range state for multiple ranges
  const [pageRangeInput, setPageRangeInput] = useState('')
  const [parsedPageRanges, setParsedPageRanges] = useState([])
  
  // Chat session management
  const [currentChatSessionId, setCurrentChatSessionId] = useState(null)
  const [clearingChat, setClearingChat] = useState(false)
  const [processingReference, setProcessingReference] = useState(null)
  
  // Add state for tracking last used page range for inheritance
  const [lastUsedPageRange, setLastUsedPageRange] = useState(null)

  // Add state for highlighting status
  const [highlightingStatus, setHighlightingStatus] = useState({}); // { [pageNum]: 'success' | 'failed' | 'retrying' }

  // PDF viewer state
  const [currentPageNumber, setCurrentPageNumber] = useState(1)


  // Blob URL management
  const [currentBlobUrl, setCurrentBlobUrl] = useState(null)








  // Handle page change
  function handlePageChange(newPage) {
    if (newPage >= 1 && newPage <= numPages) {
      setCurrentPageNumber(newPage)
      setCurrentPage(newPage)
      setPageRange([newPage, newPage])
      
      // Scroll to the page
      setTimeout(() => {
        const pageElement = document.querySelector(`[data-page-number="${newPage}"]`)
        if (pageElement) {
          pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }

  // Track current page based on scroll position - simple and fast
  function updateCurrentPageFromScroll() {
    // Find the PDF content container (the scrollable area) - more specific selector
    const pdfContent = document.querySelector('.left-panel')
    if (!pdfContent || !numPages) {
      console.log('📄 Scroll tracking: No PDF content or pages found')
      return
    }

    const scrollTop = pdfContent.scrollTop
    const viewerHeight = pdfContent.clientHeight
    
    // Find all page elements
    const pages = document.querySelectorAll('[data-page-number]')
    console.log('📄 Found', pages.length, 'page elements')
    
    let currentPage = 1
    
    for (let i = 0; i < pages.length; i++) {
      const pageElement = pages[i]
      const pageTop = pageElement.offsetTop
      const pageHeight = pageElement.offsetHeight
      const pageNum = parseInt(pageElement.getAttribute('data-page-number'))
      
      // Check if this page is most visible in the viewport
      if (scrollTop >= pageTop - viewerHeight / 2 && scrollTop < pageTop + pageHeight - viewerHeight / 2) {
        currentPage = pageNum
        console.log('📄 Current page detected:', currentPage, 'scrollTop:', scrollTop, 'pageTop:', pageTop)
        break
      }
    }

    if (currentPage !== currentPageNumber && currentPage >= 1 && currentPage <= numPages) {
      console.log('📄 Updating page number from', currentPageNumber, 'to', currentPage)
      setCurrentPageNumber(currentPage)
    }
  }



  function onDocumentLoadSuccess({ numPages, pdf }) {
    console.log('📄 Document loaded successfully:', { numPages, pdf: !!pdf })
    setNumPages(numPages)
    setPageRange([1, numPages])
    setPageRangeInput('')
    setParsedPageRanges([])
    // Initialize last used page range to full range
    setLastUsedPageRange([1, numPages])
    // Initialize current page
    setCurrentPageNumber(1)
    setCurrentPage(1)
    // Clear any previous errors
    setError(null)
    
    // Always load the PDF document for search functionality
    if (file) {
      console.log('📄 Loading PDF document for search functionality')
      pdfjs.getDocument(file).promise.then((pdfDoc) => {
        console.log('📄 Successfully loaded PDF document for search')
        setPdfDocument(pdfDoc)
      }).catch((error) => {
        console.error('📄 Failed to load PDF document for search:', error)
      })
    }
  }

  // Handle PDF loading errors
  function onDocumentLoadError(error) {
    console.error('PDF load error:', error)
    setError(`Failed to load PDF: ${error.message}`)
    // Reset file state to allow retry
    setFile(null)
    setNumPages(null)
    
    // Clean up blob URL if it exists
    if (currentBlobUrl) {
      cleanupBlobUrl(currentBlobUrl)
      setCurrentBlobUrl(null)
    }
  }

  // Retry loading the current document
  async function retryLoadDocument() {
    if (pdfInfo && pdfInfo.file_path) {
      setError(null)
      await loadExistingDocument(pdfInfo.file_path)
    }
  }

  // Retry PDF loading with exponential backoff
  async function retryPdfLoad(filePath, attempt = 1) {
    // Add defensive check to prevent undefined filePath
    if (!filePath) {
      console.error('retryPdfLoad called with undefined filePath')
      return
    }
    
    const maxAttempts = 3
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 1s, 2s, 4s
    
    console.log(`[PDF Load] Retry attempt ${attempt}/${maxAttempts} for file ${filePath}`)
    
    // Show retry message to user
    setError(`Loading document... (attempt ${attempt}/${maxAttempts}) - This may take a few minutes for large files`)
    
    setTimeout(async () => {
      if (attempt >= maxAttempts) {
        console.log('[PDF Load] Max retry attempts reached')
        setError('Failed to load PDF after multiple attempts. Please try again later.')
        return
      }
      
      try {
        await loadExistingDocument(filePath)
        // If we get here, the retry succeeded
        console.log(`[PDF Load] Retry ${attempt} succeeded!`)
        setError(null) // Clear any error messages
        return // Exit the retry function successfully
      } catch (error) {
        console.log(`[PDF Load] Retry ${attempt} failed:`, error)
        console.log(`[PDF Load] Error message:`, error.message)
        // Only retry if the error is not a 404 (document not found)
        if (!error.message.includes('404')) {
          retryPdfLoad(filePath, attempt + 1)
        } else {
          console.log('[PDF Load] Document not found (404), stopping retries')
          setError('Document not found')
        }
      }
    }, delay)
  }

  // Clean up blob URL
  function cleanupBlobUrl(blobUrl) {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrl)
    }
  }

  // Helper function to clean file path for API calls (remove leading slash)
  function cleanFilePathForAPI(filePath) {
    return filePath.startsWith('/') ? filePath.substring(1) : filePath
  }

  // Load existing document from server
  async function loadExistingDocument(filePath) {
    console.log('=== LOAD EXISTING DOCUMENT START ===')
    console.log('filePath:', filePath)
    
    // Add defensive check to prevent undefined filePath
    if (!filePath) {
      console.error('loadExistingDocument called with undefined filePath')
      setError('Invalid file path')
      return
    }
    
    try {
      console.log('Setting loading state...')
      setLoading(true)
      setError('Loading document... This may take a few minutes for large files')
      
      // Keep the full path as is, just encode it properly
      const encodedPath = encodeURIComponent(filePath)
      console.log('Encoded path:', encodedPath)
      console.log('Making request to:', `${API_URL}/documents/${encodedPath}`)
      
      const response = await fetch(`${API_URL}/documents/${encodedPath}`, {
        signal: AbortSignal.timeout(120000) // 2 minute timeout for large files
      })
      
      console.log('Response status:', response.status)
      console.log('Response ok:', response.ok)
      
      if (!response.ok) {
        console.log('Response not ok, throwing error')
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      console.log('Parsing response JSON...')
      const data = await response.json()
      console.log('Response data:', data)
      
      // For existing documents, we need to fetch the file from the server
      // since we don't have the original file object
      console.log('=== TIMING DEBUG ===')
      const fetchStartTime = Date.now()
      console.log('Starting PDF fetch at:', fetchStartTime)
      
      console.log('Fetching PDF file from:', `${API_URL}/documents/${encodedPath}/file`)
      const pdfResponse = await fetch(`${API_URL}/documents/${encodedPath}/file`, {
        signal: AbortSignal.timeout(120000) // 2 minute timeout for large files
      })
      
      const fetchEndTime = Date.now()
      console.log('PDF fetch completed at:', fetchEndTime)
      console.log('Fetch duration:', fetchEndTime - fetchStartTime, 'ms')
      console.log('PDF response status:', pdfResponse.status)
      console.log('PDF response ok:', pdfResponse.ok)
      
      if (!pdfResponse.ok) {
        console.log('PDF response not ok, throwing error')
        throw new Error('Failed to fetch PDF file')
      }
      
      // Clone the response to avoid body consumption issues
      console.log('Cloning PDF response...')
      const clonedResponse = pdfResponse.clone()
      console.log('PDF response cloned successfully')
      
      console.log('=== RESPONSE ANALYSIS ===')
      console.log('Original response type:', pdfResponse.type)
      console.log('Original response headers:', [...pdfResponse.headers.entries()])
      console.log('Original response body used:', pdfResponse.bodyUsed)
      console.log('Original response status:', pdfResponse.status)
      console.log('Cloned response type:', clonedResponse.type)
      console.log('Cloned response headers:', [...clonedResponse.headers.entries()])
      console.log('Cloned response body used:', clonedResponse.bodyUsed)
      console.log('Cloned response status:', clonedResponse.status)
      
      // Check for specific headers that might indicate issues
      const contentType = clonedResponse.headers.get('content-type')
      const contentLength = clonedResponse.headers.get('content-length')
      console.log('Content-Type:', contentType)
      console.log('Content-Length:', contentLength)
      
      let pdfBlob, blobUrl
      try {
        // Check if cloned response body is already used
        if (clonedResponse.bodyUsed) {
          console.error('Cloned response body already used, cannot create blob')
          throw new Error('Cloned response body already consumed')
        }
        
        // Check if cloned response is ok
        if (!clonedResponse.ok) {
          console.error('Cloned PDF response not ok:', clonedResponse.status, clonedResponse.statusText)
          throw new Error(`Cloned PDF response failed: ${clonedResponse.status}`)
        }
        
        console.log('Reading response as array buffer...')
        const blobStartTime = Date.now()
        console.log('Starting blob creation at:', blobStartTime)
        
        // Ensure response is fully ready before processing
        await new Promise(resolve => setTimeout(resolve, 10))
        
        let arrayBuffer
        try {
          arrayBuffer = await clonedResponse.arrayBuffer()
          const arrayBufferEndTime = Date.now()
          console.log('Array buffer created successfully')
          console.log('Array buffer creation duration:', arrayBufferEndTime - blobStartTime, 'ms')
          console.log('Array buffer size:', arrayBuffer.byteLength)
        } catch (arrayBufferError) {
          console.error('=== ARRAY BUFFER ERROR ===')
          console.error('Array buffer error:', arrayBufferError.message)
          console.log('Trying direct blob creation as fallback...')
          try {
            pdfBlob = await clonedResponse.blob()
            console.log('Direct blob creation succeeded')
            console.log('PDF blob size:', pdfBlob.size)
            console.log('PDF blob type:', pdfBlob.type)
          } catch (blobError) {
            console.error('=== DIRECT BLOB ERROR ===')
            console.error('Direct blob error:', blobError.message)
            console.log('Trying fresh request as final fallback...')
            
            // Make a fresh request specifically for blob
            const freshResponse = await fetch(`${API_URL}/documents/${encodedPath}/file`, {
              signal: AbortSignal.timeout(120000)
            })
            
            if (!freshResponse.ok) {
              throw new Error(`Fresh request failed: ${freshResponse.status}`)
            }
            
            pdfBlob = await freshResponse.blob()
            console.log('Fresh request blob creation succeeded')
            console.log('PDF blob size:', pdfBlob.size)
            console.log('PDF blob type:', pdfBlob.type)
          }
        }
        
        if (!arrayBuffer && !pdfBlob) {
          console.error('Both array buffer and direct blob creation failed')
          throw new Error('Failed to read response data')
        }
        
        if (arrayBuffer) {
          if (arrayBuffer.byteLength === 0) {
            console.error('Array buffer is empty')
            throw new Error('Empty array buffer')
          }
          
          console.log('Creating blob from array buffer...')
          // Ensure array buffer is fully processed before creating blob
          await new Promise(resolve => setTimeout(resolve, 10))
          pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' })
          console.log('PDF blob created successfully')
          console.log('PDF blob size:', pdfBlob.size)
          console.log('PDF blob type:', pdfBlob.type)
        }
        
        if (!pdfBlob || pdfBlob.size === 0) {
          console.error('Created blob is empty or invalid')
          throw new Error('Invalid blob created')
        }
        
        console.log('Creating object URL from blob...')
        blobUrl = URL.createObjectURL(pdfBlob)
        console.log('Created blob URL successfully:', blobUrl)
        console.log('Blob URL length:', blobUrl.length)
      } catch (blobError) {
        console.error('=== BLOB CREATION ERROR ===')
        console.error('Blob error message:', blobError.message)
        console.error('Blob error stack:', blobError.stack)
        console.error('Blob error type:', blobError.constructor.name)
        throw blobError
      }
      
      // Ensure all state updates happen in sequence
      await new Promise(resolve => {
        // Clean up previous blob URL
        if (currentBlobUrl) {
          cleanupBlobUrl(currentBlobUrl)
        }
        
        console.log('Setting blob URL and file...')
        setCurrentBlobUrl(blobUrl)
        setFile(blobUrl)
        setPdfInfo(data)
        
        // Use setTimeout to ensure state updates are processed
        setTimeout(resolve, 0)
      })
      
      console.log('Loading most recent chat session...')
      // Load the most recent chat session for this document
      await loadMostRecentChatSession(filePath)
      console.log('Chat session loaded successfully')
      
    } catch (error) {
      console.error('=== ERROR IN LOAD EXISTING DOCUMENT ===')
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      console.error('Error type:', error.constructor.name)
      
      // Don't show error immediately, let retry mechanism handle it
      // Only show error if it's a 404 (document not found) or if we're not retrying
      if (error.message.includes('404')) {
        console.log('404 error detected, showing error immediately')
        setError('Document not found')
      } else {
        console.log('Non-404 error, triggering retry...')
        // Retry with exponential backoff
        retryPdfLoad(filePath, 1)
      }
    } finally {
      console.log('Setting loading to false')
      setLoading(false)
      console.log('=== LOAD EXISTING DOCUMENT END ===')
    }
  }

  // Load chat history
  async function loadChatHistory(sessionId) {
    console.log('=== LOAD CHAT HISTORY START ===')
    console.log('Session ID:', sessionId)
    
    try {
      console.log('Fetching chat history from:', `${API_URL}/chat/sessions/${sessionId}`)
      const response = await fetch(`${API_URL}/chat/sessions/${sessionId}`)
      console.log('Chat history response status:', response.status)
      console.log('Chat history response ok:', response.ok)
      
      if (response.ok) {
        console.log('Parsing chat history response...')
        const data = await response.json()
        console.log('Chat history data:', data)
        const messages = data.messages || []
        console.log(`Loaded ${messages.length} messages from chat session ${sessionId}`)
        setChatMessages(messages)
        setCurrentChatSessionId(sessionId)
        console.log('Chat messages and session ID set successfully')
      } else {
        console.error(`Failed to load chat session ${sessionId}: ${response.status}`)
      }
    } catch (error) {
      console.error('=== CHAT HISTORY LOAD ERROR ===')
      console.error('Chat history error message:', error.message)
      console.error('Chat history error stack:', error.stack)
      console.error('Chat history error type:', error.constructor.name)
    }
    
    console.log('=== LOAD CHAT HISTORY END ===')
  }

  // Load the most recent chat session for a document
  async function loadMostRecentChatSession(filePath) {
    console.log('=== LOAD MOST RECENT CHAT SESSION START ===')
    console.log('File path:', filePath)
    
    // Add defensive check to prevent undefined filePath
    if (!filePath) {
      console.error('loadMostRecentChatSession called with undefined filePath')
      return
    }
    
    try {
      // Remove leading slash if present for the API call (to match backend expectation)
      const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath
      const encodedPath = encodeURIComponent(cleanPath)
      console.log('Original file path:', filePath)
      console.log('Clean path for API:', cleanPath)
      console.log('Encoded path for chat sessions:', encodedPath)
      console.log('Fetching chat sessions from:', `${API_URL}/documents/${encodedPath}/chat-sessions`)
      
      const response = await fetch(`${API_URL}/documents/${encodedPath}/chat-sessions`)
      console.log('Chat sessions response status:', response.status)
      console.log('Chat sessions response ok:', response.ok)
      
      if (response.ok) {
        console.log('Parsing chat sessions response...')
        const data = await response.json()
        console.log('Chat sessions data:', data)
        const chatSessions = data.chat_sessions || []
        console.log('Number of chat sessions found:', chatSessions.length)
        
        if (chatSessions.length > 0) {
          // Get the most recent chat session (they should be ordered by created_at desc)
          const mostRecentSession = chatSessions[0]
          console.log(`Loading chat session: ${mostRecentSession.id} with ${mostRecentSession.message_count} messages`)
          await loadChatHistory(mostRecentSession.id)
          console.log('Chat history loaded successfully')
        } else {
          // No existing chat sessions, start fresh
          console.log('No existing chat sessions found, starting fresh')
          setChatMessages([])
          setCurrentChatSessionId(null)
        }
      } else {
        // If the endpoint fails, start with empty chat
        console.log('Failed to fetch chat sessions, starting with empty chat')
        setChatMessages([])
        setCurrentChatSessionId(null)
      }
    } catch (error) {
      console.error('=== CHAT SESSION LOAD ERROR ===')
      console.error('Chat session error message:', error.message)
      console.error('Chat session error stack:', error.stack)
      console.error('Chat session error type:', error.constructor.name)
      // Start with empty chat on error
      setChatMessages([])
      setCurrentChatSessionId(null)
    }
    
    console.log('=== LOAD MOST RECENT CHAT SESSION END ===')
  }

  // Load existing documents
  async function loadExistingDocuments() {
    try {
      setLoadingDocuments(true)
      const response = await fetch(`${API_URL}/documents`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      setExistingDocuments(data.documents || [])
      
    } catch (error) {
      console.error('Error loading documents:', error)
      setError(`Failed to load documents: ${error.message}`)
    } finally {
      setLoadingDocuments(false)
    }
  }

  // Delete document
  async function deleteDocument(documentId) {
    try {
      const response = await fetch(`${API_URL}/documents/${documentId}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      // Remove from local state
      setExistingDocuments(prev => prev.filter(doc => doc.id !== documentId))
      
      // If this was the current document, clear it
      if (pdfInfo && pdfInfo.file_path === documentId) {
        setPdfInfo(null)
        setFile(null)
        setChatMessages([])
        setCurrentChatSessionId(null)
        if (currentBlobUrl) {
          cleanupBlobUrl(currentBlobUrl)
          setCurrentBlobUrl(null)
        }
      }
      
    } catch (error) {
      console.error('Error deleting document:', error)
      setError(`Failed to delete document: ${error.message}`)
    }
  }

  // Show delete confirmation modal
  function showDeleteConfirmation(document) {
    setDocumentToDelete(document)
    setShowDeleteModal(true)
  }

  // Handle delete confirmation
  async function handleDeleteConfirm() {
    if (!documentToDelete || deletingInProgress) return
    
    setDeletingInProgress(true)
    
    try {
      // IMMEDIATE UI UPDATE: Remove from list immediately to prevent double-clicking
      setExistingDocuments(prev => prev.filter(doc => doc.file_path !== documentToDelete.file_path))
      
      // If this was the current document, clear it immediately
      if (pdfInfo && pdfInfo.file_path === documentToDelete.file_path) {
        setPdfInfo(null)
        setFile(null)
        setChatMessages([])
        setCurrentChatSessionId(null)
        if (currentBlobUrl) {
          cleanupBlobUrl(currentBlobUrl)
          setCurrentBlobUrl(null)
        }
      }
      
      // Close modal immediately
      setShowDeleteModal(false)
      setDocumentToDelete(null)
      
      // Make API call in background
      const cleanPath = cleanFilePathForAPI(documentToDelete.file_path)
      const response = await fetch(`${API_URL}/documents/${encodeURIComponent(cleanPath)}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      console.log('Document deleted successfully:', documentToDelete.filename)
      
    } catch (error) {
      console.error('Error deleting document:', error)
      setError(`Failed to delete document: ${error.message}`)
      
      // Revert UI changes if deletion failed
      setExistingDocuments(prev => [...prev, documentToDelete].sort((a, b) => 
        new Date(b.uploaded_at) - new Date(a.uploaded_at)
      ))
    } finally {
      setDeletingInProgress(false)
    }
  }

  // Cancel delete confirmation
  function handleDeleteCancel() {
    setShowDeleteModal(false)
    setDocumentToDelete(null)
    setDeletingInProgress(false)
  }



  // Process OCR on current document
  async function processOcr() {
    if (!pdfInfo || !pdfInfo.file_path) {
      setError('No document loaded')
      return
    }

    try {
      setLoading(true)
      setProcessingOcr(true)
      setOcrProgress(0)
      setError(null)
      
      // Remove leading slash to avoid redirect issues with CORS
      const filePath = pdfInfo.file_path.startsWith('/') ? pdfInfo.file_path.substring(1) : pdfInfo.file_path
      
      // Start OCR processing with progress simulation
      const startTime = Date.now()
      const estimatedDuration = 60000 // 60 seconds estimate for OCR (increased for larger files)
      
      // Progress simulation interval
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        const progress = Math.min((elapsed / estimatedDuration) * 100, 95) // Cap at 95% until complete
        setOcrProgress(Math.round(progress))
      }, 500)
      
      const response = await fetch(`${API_URL}/documents/${encodeURIComponent(filePath)}/ocr`, {
        method: 'POST'
      })
      
      // Clear progress interval
      clearInterval(progressInterval)
      setOcrProgress(100)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      console.log('OCR processing completed:', data.message)
      
      // Reload the document to get updated text
      await loadExistingDocument(pdfInfo.file_path)
      
      // Show success message
      setError(null)
      
    } catch (error) {
      console.error('Error processing OCR:', error)
      setError(`OCR processing failed: ${error.message}`)
    } finally {
      setLoading(false)
      setProcessingOcr(false)
      setOcrProgress(0)
    }

  }

  // Re-extract text from current document
  async function reExtractText() {
    if (!pdfInfo || !pdfInfo.file_path) {
      setError('No document loaded')
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      // Remove leading slash to avoid redirect issues with CORS
      const filePath = pdfInfo.file_path.startsWith('/') ? pdfInfo.file_path.substring(1) : pdfInfo.file_path
      const response = await fetch(`${API_URL}/documents/${encodeURIComponent(filePath)}/extract-text`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      console.log('Text extraction completed:', data.message)
      
      // Reload the document to get updated text
      await loadExistingDocument(pdfInfo.file_path)
      
      // Show success message
      setError(null)
      
    } catch (error) {
      console.error('Error re-extracting text:', error)
      setError(`Text extraction failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Handle file selection
  function handleFileSelect(event) {
    const selectedFile = event.target.files[0]
    if (selectedFile) {
      console.log('Selected file:', selectedFile)
      console.log('File path available:', selectedFile.path)
      console.log('File name:', selectedFile.name)
      
      // Try to get the full path, but browsers don't provide it for security
      const filePath = selectedFile.path || selectedFile.webkitRelativePath || selectedFile.name
      console.log('Using file path:', filePath)
      
      // If we only have the filename, we need to upload the file instead
      if (filePath === selectedFile.name) {
        console.log('Only filename available, uploading file...')
        handleFileUpload(selectedFile)
      } else {
        console.log('Full path available, using direct file access...')
        handleFileOpen(filePath)
      }
    }
  }

  // Handle drag and drop
  function handleDrop(event) {
    event.preventDefault()
    const droppedFile = event.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === 'application/pdf') {
      console.log('Dropped file:', droppedFile)
      console.log('File path available:', droppedFile.path)
      console.log('File name:', droppedFile.name)
      
      const filePath = droppedFile.path || droppedFile.webkitRelativePath || droppedFile.name
      console.log('Using file path:', filePath)
      
      // If we only have the filename, we need to upload the file instead
      if (filePath === droppedFile.name) {
        console.log('Only filename available, uploading file...')
        handleFileUpload(droppedFile)
      } else {
        console.log('Full path available, using direct file access...')
        handleFileOpen(filePath)
      }
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  // Handle file opening (new simplified approach)
  async function handleFileOpen(filePath) {
    console.log('=== HANDLE FILE OPEN CALLED ===')
    console.log('filePath:', filePath)
    console.log('API_URL:', API_URL)
    console.log('Full URL:', `${API_URL}/open-file`)
    
    try {
      setLoading(true)
      setError(null)
      
      const requestBody = {
        file_path: filePath
      }
      console.log('Request body:', requestBody)
      console.log('Request headers:', {
        'Content-Type': 'application/json'
      })
      
      const response = await fetch(`${API_URL}/open-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })
      
      console.log('Response status:', response.status)
      console.log('Response headers:', Object.fromEntries(response.headers.entries()))
      
      if (!response.ok) {
        console.log('Response not OK, trying to get error data...')
        let errorData
        try {
          errorData = await response.json()
          console.log('Error data:', errorData)
        } catch (e) {
          console.log('Could not parse error response as JSON:', e)
          errorData = { error: `HTTP ${response.status}` }
        }
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      
      console.log('Response OK, parsing JSON...')
      const data = await response.json()
      console.log('Response data:', data)
      
      // For existing documents, we need to fetch the file from the server
      // since we don't have the original file object
      const storedFilePath = data.file_path || filePath
      const pdfResponse = await fetch(`${API_URL}/documents/${encodeURIComponent(storedFilePath)}/file`)
      if (!pdfResponse.ok) {
        throw new Error('Failed to fetch PDF file')
      }
      
      const pdfBlob = await pdfResponse.blob()
      const blobUrl = URL.createObjectURL(pdfBlob)
      
      // Clean up previous blob URL
      if (currentBlobUrl) {
        cleanupBlobUrl(currentBlobUrl)
      }
      
      setCurrentBlobUrl(blobUrl)
      setFile(blobUrl)
      setPdfInfo({
        file_path: data.file_path,
        filename: data.filename,
        num_pages: data.document?.num_pages || data.num_pages,
        file_size: data.document?.file_size || data.file_size
      })
      
      // Clear chat messages
      setChatMessages([])
      setCurrentChatSessionId(null)
      setShowLandingModal(false)
      
    } catch (error) {
      console.error('=== ERROR IN HANDLE FILE OPEN ===')
      console.error('Error type:', error.constructor.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      setError(`Failed to open file: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Handle file selection (single or multiple)
  function handleFileSelect(event) {
    const selectedFiles = Array.from(event.target.files)
    console.log('Selected files:', selectedFiles)
    
    if (selectedFiles.length === 0) return
    
    if (selectedFiles.length === 1) {
      // Single file upload
      handleFileUpload(selectedFiles[0])
    } else {
      // Multiple file upload
      handleBatchFileUpload(selectedFiles)
    }
  }

  // Handle drag and drop
  function handleDrop(event) {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer.files)
    const pdfFiles = droppedFiles.filter(file => file.type === 'application/pdf')
    
    if (pdfFiles.length === 0) return
    
    console.log('Dropped files:', pdfFiles)
    if (pdfFiles.length === 1) {
      handleFileUpload(pdfFiles[0])
    } else {
      handleBatchFileUpload(pdfFiles)
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  // Handle batch file upload
  async function handleBatchFileUpload(files) {
    console.log('=== BATCH FILE UPLOAD CALLED ===')
    console.log('Uploading files:', files.map(f => f.name))
    
    try {
      setLoading(true)
      setUploading(true)
      setUploadProgress(0)
      setError(null)
      
      const uploadPromises = files.map(async (file, index) => {
        const formData = new FormData()
        formData.append('file', file)
        
        // Use XMLHttpRequest to track progress for each file
        const response = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              // Calculate overall progress across all files
              const fileProgress = (event.loaded / event.total) * 100
              const overallProgress = ((index + fileProgress / 100) / files.length) * 100
              setUploadProgress(Math.round(overallProgress))
            }
          })
          
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText)
                resolve({ ok: true, status: xhr.status, json: () => Promise.resolve(data) })
              } catch (e) {
                reject(new Error('Invalid JSON response'))
              }
            } else {
              reject(new Error(`Upload failed for ${file.name}: HTTP ${xhr.status}`))
            }
          })
          
          xhr.addEventListener('error', () => {
            reject(new Error(`Network error for ${file.name}`))
          })
          
          xhr.open('POST', `${API_URL}/upload`)
          xhr.send(formData)
        })
        
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `Upload failed for ${file.name}: HTTP ${response.status}`)
        }
        
        return await response.json()
      })
      
      const results = await Promise.all(uploadPromises)
      console.log('Batch upload results:', results)
      
      // Show success message
      setError(`Successfully uploaded ${results.length} files!`)
      
      // Refresh the existing documents list
      loadExistingDocuments()
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setError(null)
      }, 3000)
      
    } catch (error) {
      console.error('=== ERROR IN BATCH FILE UPLOAD ===')
      console.error('Error type:', error.constructor.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      setError(`Batch upload failed: ${error.message}`)
    } finally {
      setLoading(false)
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // Handle file upload (for when we only have the file object, not the path)
  async function handleFileUpload(uploadedFile) {
    console.log('=== HANDLE FILE UPLOAD CALLED ===')
    console.log('Uploading file:', uploadedFile.name)
    
    try {
      setLoading(true)
      setUploading(true)
      setUploadProgress(0)
      setError(null)
      
      // Create FormData to upload the file
      const formData = new FormData()
      formData.append('file', uploadedFile)
      
      console.log('Uploading to:', `${API_URL}/upload`)
      
      // Use XMLHttpRequest to track upload progress
      const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100)
            setUploadProgress(progress)
          }
        })
        
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText)
              resolve({ ok: true, status: xhr.status, json: () => Promise.resolve(data) })
            } catch (e) {
              reject(new Error('Invalid JSON response'))
            }
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`))
          }
        })
        
        xhr.addEventListener('error', () => {
          reject(new Error('Network error'))
        })
        
        xhr.open('POST', `${API_URL}/upload`)
        xhr.send(formData)
      })
      
      console.log('Upload response status:', response.status)
      
      if (!response.ok) {
        let errorData
        try {
          errorData = await response.json()
          console.log('Upload error data:', errorData)
        } catch (e) {
          console.log('Could not parse upload error response as JSON:', e)
          errorData = { error: `HTTP ${response.status}` }
        }
        throw new Error(errorData.error || `Upload failed: HTTP ${response.status}`)
      }
      
      const data = await response.json()
      console.log('Upload response data:', data)
      console.log('File path from response:', data.file_path)
      
      // Use the original file that was uploaded instead of fetching it again
      // This avoids the fetch issue and is more efficient
      const blobUrl = URL.createObjectURL(uploadedFile)
      console.log('Using original uploaded file, blob size:', uploadedFile.size)
      
      // Clean up previous blob URL
      if (currentBlobUrl) {
        cleanupBlobUrl(currentBlobUrl)
      }
      
      setCurrentBlobUrl(blobUrl)
      setFile(blobUrl)
      setPdfInfo({
        file_path: data.file_path,
        filename: data.filename,
        num_pages: data.document?.num_pages || data.num_pages,
        file_size: data.document?.file_size || data.file_size
      })
      
      // Clear chat messages and close modal
      setChatMessages([])
      setCurrentChatSessionId(null)
      setShowLandingModal(false)
      setError(null) // Clear any previous errors
      
    } catch (error) {
      console.error('=== ERROR IN HANDLE FILE UPLOAD ===')
      console.error('Error type:', error.constructor.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      setError(`Failed to upload file: ${error.message}`)
    } finally {
      setLoading(false)
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // Parse page ranges into actual ranges
  function parsePageRanges(value) {
    const ranges = []
    
    console.log('=== PAGE RANGE PARSING ===')
    console.log('Input value:', value)
    
    // Use a more sophisticated approach to handle mixed content with brackets
    let currentIndex = 0
    const parts = []
    
    while (currentIndex < value.length) {
      const char = value[currentIndex]
      
      if (char === '[') {
        // Find the matching closing bracket
        let bracketCount = 1
        let endIndex = currentIndex + 1
        
        while (endIndex < value.length && bracketCount > 0) {
          if (value[endIndex] === '[') bracketCount++
          if (value[endIndex] === ']') bracketCount--
          endIndex++
        }
        
        if (bracketCount === 0) {
          // Extract the complete bracketed part
          const bracketedPart = value.substring(currentIndex, endIndex)
          parts.push(bracketedPart)
          currentIndex = endIndex
        } else {
          // Unmatched bracket, treat as regular content
          parts.push(char)
          currentIndex++
        }
      } else if (char === ';') {
        // Skip semicolons, they're our separators
        currentIndex++
      } else {
        // Collect regular content until semicolon or bracket
        let content = ''
        while (currentIndex < value.length && value[currentIndex] !== ';' && value[currentIndex] !== '[') {
          content += value[currentIndex]
          currentIndex++
        }
        if (content.trim()) {
          parts.push(content.trim())
        }
      }
    }
    
    console.log('Parsed parts:', parts)
    
    for (const part of parts) {
      // Check if this part is wrapped in square brackets
      if (part.startsWith('[') && part.endsWith(']')) {
        // Extract content inside brackets
        const bracketContent = part.slice(1, -1)
        console.log('Bracket content:', bracketContent)
        
        // Parse the content inside brackets as individual page numbers
        // Split by semicolon first, then by comma
        const bracketParts = bracketContent.split(/[;,]/).map(p => p.trim()).filter(p => p)
        console.log('Bracket parts:', bracketParts)
        
        const pageNumbers = []
        for (const bracketPart of bracketParts) {
          if (bracketPart.includes('-')) {
            const [start, end] = bracketPart.split('-').map(num => parseInt(num.trim()))
            if (!isNaN(start) && !isNaN(end) && start <= end) {
              for (let i = start; i <= end; i++) {
                if (i >= 1 && i <= numPages) {
                  pageNumbers.push(i)
                }
              }
            }
          } else {
            const page = parseInt(bracketPart)
            if (!isNaN(page) && page >= 1 && page <= numPages) {
              pageNumbers.push(page)
            }
          }
        }
        
        // Remove duplicates and sort
        const uniquePages = [...new Set(pageNumbers)].sort((a, b) => a - b)
        console.log('Pages inside brackets:', uniquePages)
        
        if (uniquePages.length > 0) {
          // For bracketed content, we need to send the exact pages
          ranges.push({ type: 'specific_pages', pages: uniquePages })
        }
        
      } else {
        // Regular parsing (no brackets)
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(num => parseInt(num.trim()))
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            ranges.push([start, end])
          }
        } else {
          const page = parseInt(part)
          if (!isNaN(page) && page >= 1 && page <= numPages) {
            ranges.push([page, page])
          }
        }
      }
    }
    
    console.log('Parsed ranges:', ranges)
    console.log('=== END PAGE RANGE PARSING ===')
    return ranges
  }

  // Handle page range change
  function handlePageRangeChange(value) {
    setPageRangeInput(value)
    
    // Parse page ranges into individual pages for display
    const ranges = []
    const parts = value.split(/[;,]/).map(part => part.trim()).filter(part => part)
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(num => parseInt(num.trim()))
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            if (i >= 1 && i <= numPages) {
              ranges.push(i)
            }
          }
        }
      } else {
        const page = parseInt(part)
        if (!isNaN(page) && page >= 1 && page <= numPages) {
          ranges.push(page)
        }
      }
    }
    
    // Remove duplicates and sort
    const uniqueRanges = [...new Set(ranges)].sort((a, b) => a - b)
    setParsedPageRanges(uniqueRanges)
  }

  // Handle send message
  async function handleSendMessage() {
    if (!inputMessage.trim() || !pdfInfo) return
    
    const userMessage = inputMessage.trim()
    setInputMessage('')
    
    // Parse page ranges into actual ranges
    const pageRanges = parsePageRanges(pageRangeInput)
    
    // Debug logging for API call tracking
    console.log('=== FRONTEND API CALL START ===')
    console.log('Page ranges to process:', pageRanges)
    console.log('Message length:', userMessage.length)
    
    // Add user message to chat
    const newUserMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      page_range: pageRanges.length > 0 ? pageRanges : [pageRange]
    }
    
    setChatMessages(prev => [...prev, newUserMessage])
    
    // Remove the loading message - we'll add individual responses as they come in
    let chatSessionId = currentChatSessionId
    
    try {
      console.log(`Making ${pageRanges.length} API calls in sequence...`)
      
      // Make multiple API calls in sequence and display each response immediately
      for (let i = 0; i < pageRanges.length; i++) {
        const range = pageRanges[i]
        
        // Handle different range formats
        let rangeDescription = ''
        if (typeof range === 'object' && range.type === 'specific_pages') {
          rangeDescription = `pages ${range.pages[0]}-${range.pages[range.pages.length-1]} (${range.pages.length} specific pages)`
        } else if (Array.isArray(range)) {
          rangeDescription = `pages ${range[0]}-${range[1]}`
        } else {
          rangeDescription = `unknown range format`
        }
        
        console.log(`API call ${i + 1}/${pageRanges.length}: ${rangeDescription}`)
        
        // Add a loading message for this specific range
        const rangeLoadingMessage = {
          id: `loading-${Date.now()}-${i}`,
          role: 'assistant',
          content: `Thinking about ${rangeDescription}...`,
          timestamp: new Date().toISOString(),
          loading: true,
          page_range: range
        }
        
        setChatMessages(prev => [...prev, rangeLoadingMessage])
        
        // Debug: Log what we're sending to the backend
        const requestBody = {
          message: userMessage,
          document_id: pdfInfo.file_path,
          page_range: range,
          chat_session_id: chatSessionId
        }
        console.log('Sending to backend:', JSON.stringify(requestBody, null, 2))
        
        const response = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        const data = await response.json()
        
        // Update chat session ID for subsequent calls
        if (data.chat_session_id) {
          chatSessionId = data.chat_session_id
        }
        
        console.log(`API call ${i + 1} successful:`, {
          messageLength: data.message?.length || 0,
          referencesCount: data.references?.length || 0
        })
        
        // Replace the loading message with the actual response for this range
        setChatMessages(prev => prev.map(msg => 
          msg.id === rangeLoadingMessage.id 
            ? {
                id: Date.now().toString(),
                role: 'assistant',
                content: data.message,
                timestamp: new Date().toISOString(),
                references: data.references || [],
                page_range: range
              }
            : msg
        ))
      }
      
      // Update chat session ID
      if (chatSessionId) {
        setCurrentChatSessionId(chatSessionId)
      }
      
      console.log('All API calls completed:', {
        totalCalls: pageRanges.length
      })
      console.log('=== FRONTEND API CALL END ===')
      
    } catch (error) {
      console.error('Error sending message:', error)
      
      // Add error message to chat
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
        error: true
      }])
    }
  }

  // Clear chat
  async function clearChat() {
    // Add confirmation dialog
    if (!window.confirm('Are you sure you want to clear this chat? This action cannot be undone.')) {
      return
    }
    
    try {
      setClearingChat(true)
      
      // If there's a current chat session, delete it from the backend
      if (currentChatSessionId) {
        const response = await fetch(`${API_URL}/chat/sessions/${currentChatSessionId}`, {
          method: 'DELETE'
        })
        
        if (response.ok) {
          console.log('Chat session deleted from backend')
        } else {
          console.error('Failed to delete chat session from backend:', response.status)
        }
      }
      
      // Clear frontend state
      setChatMessages([])
      setCurrentChatSessionId(null)
      
      console.log('Chat cleared successfully')
    } catch (error) {
      console.error('Error clearing chat:', error)
      // Still clear frontend state even if backend deletion fails
      setChatMessages([])
      setCurrentChatSessionId(null)
    } finally {
      setClearingChat(false)
    }
  }

  // Highlight text in page
  function highlightTextInPage(pageNum, quote) {
    if (!pageTextFragments.current[pageNum]) {
      console.log('[Highlight] No text fragments available for page', pageNum)
      return
    }
    
    const fragments = pageTextFragments.current[pageNum]
    const normalizedQuote = normalize(quote)
    
    // Try different matching strategies
    const strategies = [
      { name: 'exact', threshold: 100 },
      { name: 'fuzzy', threshold: 85 },
      { name: 'partial', threshold: 70 }
    ]
    
    let bestMatch = null
    let bestScore = 0
    let bestStrategy = 'none'
    
    for (const strategy of strategies) {
      if (strategy.name === 'exact') {
        // Exact match
        const exactMatch = fragments.find(fragment => 
          normalize(fragment.str) === normalizedQuote
        )
        if (exactMatch) {
          bestMatch = exactMatch
          bestScore = 100
          bestStrategy = 'exact'
          break
        }
      } else if (strategy.name === 'fuzzy') {
        // Fuzzy match
        for (const fragment of fragments) {
          const score = fuzz.ratio(normalize(fragment.str), normalizedQuote)
          if (score > bestScore && score >= strategy.threshold) {
            bestScore = score
            bestMatch = fragment
            bestStrategy = 'fuzzy'
          }
        }
      } else if (strategy.name === 'partial') {
        // Partial match
        for (const fragment of fragments) {
          const score = fuzz.partial_ratio(normalize(fragment.str), normalizedQuote)
          if (score > bestScore && score >= strategy.threshold) {
            bestScore = score
            bestMatch = fragment
            bestStrategy = 'partial'
          }
        }
      }
    }
    
    // Update match quality for debugging
    setMatchQuality(prev => ({
      ...prev,
      [pageNum]: {
        score: bestScore,
        strategy: bestStrategy,
        confidence: bestScore >= 85 ? 'high' : bestScore >= 70 ? 'medium' : 'low'
      }
    }))
    
    if (bestMatch && bestScore >= 70) {
      console.log(`[Highlight] Found match on page ${pageNum}:`, {
        quote,
        fragment: bestMatch.str,
        score: bestScore,
        strategy: bestStrategy
      })
      
      // Set highlighted fragment
      setHighlightedFragmentIndices(prev => ({
        ...prev,
        [pageNum]: new Set([bestMatch.itemIndex])
      }))
      
      // Update highlighting status
      setHighlightingStatus(prev => ({
        ...prev,
        [pageNum]: 'success'
      }))
      
      return true
    } else {
      console.log(`[Highlight] No good match found on page ${pageNum}:`, {
        quote,
        bestScore,
        bestStrategy
      })
      
      // Update highlighting status
      setHighlightingStatus(prev => ({
        ...prev,
        [pageNum]: 'failed'
      }))
      
      return false
    }
  }

  // Retry highlighting with different strategies
  function retryHighlight(pageNum, quote, attempt = 1) {
    const maxAttempts = 3
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 1s, 2s, 4s
    
    console.log(`[Highlight] Retry attempt ${attempt}/${maxAttempts} for page ${pageNum}`)
    
    setTimeout(() => {
      if (attempt >= maxAttempts) {
        console.log('[Highlight] Max retry attempts reached')
        setHighlightingStatus(prev => ({
          ...prev,
          [pageNum]: 'failed'
        }))
        return
      }
      
      const success = highlightTextInPage(pageNum, quote)
      if (!success) {
        retryHighlight(pageNum, quote, attempt + 1)
      }
    }, delay)
  }

  // Handle message click for highlighting
  async function handleMessageClick(message) {
    if (message.role === 'assistant' && message.content && !message.loading && !message.error) {
      // First, try to use structured references if available
      if (message.references && message.references.length > 0) {
        const firstRef = message.references[0]
        if (firstRef.quote) {
          setHighlightedQuote(firstRef.quote)
          setCurrentPage(firstRef.page || 1)
          
          // Use simple highlighting
          highlightTextInPage(firstRef.page || 1, firstRef.quote)
          return
        }
      }
      
      // Fallback: Extract quotes from the message content
      const quotes = message.content.match(/"([^"]+)"/g) || []
      
      if (quotes.length > 0) {
        const firstQuote = quotes[0].replace(/"/g, '')
        setHighlightedQuote(firstQuote)
        setCurrentPage(1) // Start from first page
        
        // Use simple highlighting
        highlightTextInPage(1, firstQuote)
      }
    }
  }

  // Load existing documents on mount
  useEffect(() => {
    loadExistingDocuments()
  }, [])

  // Add scroll listener for page tracking - real-time like Chrome
  useEffect(() => {
    // Find the PDF content container (the scrollable area) - more specific selector
    const pdfContent = document.querySelector('.left-panel')
    console.log('📄 Setting up scroll listener for:', pdfContent)
    
    if (pdfContent && file && !loading) {
      const handleScroll = () => {
        updateCurrentPageFromScroll()
      }
      
      pdfContent.addEventListener('scroll', handleScroll, { passive: true })
      console.log('📄 Scroll listener added successfully')
      
      return () => {
        pdfContent.removeEventListener('scroll', handleScroll)
        console.log('📄 Scroll listener removed')
      }
    } else {
      console.log('📄 Cannot set up scroll listener:', { pdfContent: !!pdfContent, file: !!file, loading })
    }
  }, [file, loading, numPages])



  return (
    <div id="root" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      
      {/* Combined header with navigation */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '38px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 15px',
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => {
              setShowLandingModal(true)
              setShowExistingDocuments(false)
            }}
            className="btn btn-outline-primary btn-sm"
            style={{ whiteSpace: 'nowrap', fontSize: '11px', padding: '4px 8px' }}
          >
            <i className="bi bi-arrow-left"></i> Open file
          </button>
          

        </div>
        
        <div className="d-flex align-items-center gap-3" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          {pdfInfo && (
            <div style={{ 
              color: '#495057', 
              fontSize: '12px', 
              fontWeight: '500',
              textAlign: 'center',
              maxWidth: '250px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
                                      {pdfInfo.filename}
            </div>
          )}
        </div>

        <div style={{ fontSize: '12px', color: '#6c757d' }}>
          Skim2 - Local Mode
        </div>
      </div>

      {/* Main content with adjusted top margin for header */}
      <div style={{ marginTop: '38px', height: 'calc(100vh - 38px)' }}>

                {/* Landing Modal */}
        {showLandingModal && (
          <div className="modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div className="modal-content" style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '40px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}>
              <div className="text-center mb-4">
                <h2 style={{ color: '#1a365d', marginBottom: '8px' }}>
                  {showExistingDocuments ? 'Opened Documents' : 'Welcome to Skim2'}
                </h2>
                <p style={{ color: '#718096', fontSize: '14px' }}>
                  {showExistingDocuments ? 'Select a document to continue' : 'Upload PDF files to start analyzing'}
                </p>
              </div>

              {!showExistingDocuments ? (
                // Upload interface
                <div>
                  {/* Unified file upload */}
                  <div className="mb-4">
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      style={{
                        border: '2px dashed #4299e1',
                        borderRadius: '12px',
                        padding: '60px 40px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        backgroundColor: '#f7fafc'
                      }}
                      onMouseEnter={e => {
                        e.target.style.borderColor = '#3182ce'
                        e.target.style.backgroundColor = '#ebf8ff'
                      }}
                      onMouseLeave={e => {
                        e.target.style.borderColor = '#4299e1'
                        e.target.style.backgroundColor = '#f7fafc'
                      }}
                      onClick={() => document.getElementById('file-input').click()}
                    >
                      <i className="bi bi-cloud-upload" style={{ fontSize: '64px', color: '#4299e1', marginBottom: '20px' }}></i>
                      <h3 style={{ margin: '0 0 12px 0', color: '#2d3748', fontSize: '20px' }}>
                        Upload PDF Files
                      </h3>
                      <p style={{ margin: '0 0 16px 0', color: '#4a5568', fontSize: '16px' }}>
                        Drop PDF files here or click to browse
                      </p>
                      <p style={{ margin: 0, color: '#718096', fontSize: '14px' }}>
                        Supports single or multiple file upload
                      </p>
                    </div>
                    
                    <input
                      id="file-input"
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                  </div>

                  

                                     {/* Upload Progress Bar */}
                   {uploading && (
                     <div className="mb-4">
                       <div style={{ 
                         backgroundColor: '#e2e8f0', 
                         borderRadius: '8px', 
                         height: '8px', 
                         overflow: 'hidden',
                         marginBottom: '8px'
                       }}>
                         <div style={{
                           backgroundColor: '#4299e1',
                           height: '100%',
                           width: `${uploadProgress}%`,
                           transition: 'width 0.3s ease',
                           borderRadius: '8px'
                         }}></div>
                       </div>
                       <p style={{ 
                         textAlign: 'center', 
                         fontSize: '14px', 
                         color: '#4a5568', 
                         margin: 0 
                       }}>
                         Uploading... {uploadProgress}%
                       </p>
                     </div>
                   )}

                   {/* Success message */}
                   {error && error.includes('Successfully uploaded') && (
                     <div className="alert alert-success" style={{ fontSize: '14px' }}>
                       {error}
                     </div>
                   )}

                   {/* Error message */}
                   {error && !error.includes('Successfully uploaded') && (
                     <div className="alert alert-danger" style={{ fontSize: '14px' }}>
                       {error}
                     </div>
                   )}

                  {/* View existing documents button */}
                  <div className="text-center mt-4">
                    <button
                      onClick={() => setShowExistingDocuments(true)}
                      className="btn btn-outline-secondary"
                      style={{ fontSize: '14px' }}
                    >
                      View Opened Documents
                    </button>
                  </div>
                </div>
                             ) : (
                 // Show existing documents
                 <div>
                   {loadingDocuments ? (
                    <div className="text-center">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                      <p style={{ marginTop: '16px', color: '#718096' }}>Loading documents...</p>
                    </div>
                  ) : existingDocuments.length > 0 ? (
                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      {existingDocuments.map(doc => (
                        <div
                          key={doc.file_path}
                          style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '16px',
                            marginBottom: '12px',
                            cursor: 'pointer',
                            transition: 'border-color 0.2s, box-shadow 0.2s'
                          }}
                          onMouseEnter={e => e.target.style.borderColor = '#4299e1'}
                          onMouseLeave={e => e.target.style.borderColor = '#e2e8f0'}
                          onClick={() => {
                            loadExistingDocument(doc.file_path)
                            setShowLandingModal(false)
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#2d3748' }}>
                                {doc.filename}
                              </h4>
                              <p style={{ margin: '0 0 8px 0', color: '#718096', fontSize: '14px' }}>
                                {doc.num_pages} pages • {(doc.file_size / 1024 / 1024).toFixed(2)} MB
                              </p>
                              <p style={{ margin: 0, color: '#a0aec0', fontSize: '12px' }}>
                                Opened {new Date(doc.uploaded_at).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                showDeleteConfirmation(doc)
                              }}
                              className="btn btn-outline-danger btn-sm"
                              style={{ fontSize: '12px', padding: '4px 8px' }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center">
                      <i className="bi bi-file-earmark-text" style={{ fontSize: '48px', color: '#a0aec0', marginBottom: '16px' }}></i>
                      <p style={{ color: '#718096', marginBottom: '20px' }}>No documents found</p>
                    </div>
                  )}
                  
                  <div className="text-center mt-3">
                    <button
                      onClick={() => setShowExistingDocuments(false)}
                      className="btn btn-outline-primary"
                      style={{ fontSize: '14px' }}
                    >
                      Open New Document
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Application */}
        {!showLandingModal && (
          <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
            {/* Upload Progress Bar for Main App */}
            {uploading && (
              <div style={{
                position: 'fixed',
                top: '38px',
                left: 0,
                right: 0,
                zIndex: 1001,
                backgroundColor: 'white',
                borderBottom: '1px solid #e2e8f0',
                padding: '12px 20px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}>
                <div style={{ 
                  backgroundColor: '#e2e8f0', 
                  borderRadius: '8px', 
                  height: '6px', 
                  overflow: 'hidden',
                  marginBottom: '6px'
                }}>
                  <div style={{
                    backgroundColor: '#4299e1',
                    height: '100%',
                    width: `${uploadProgress}%`,
                    transition: 'width 0.3s ease',
                    borderRadius: '8px'
                  }}></div>
                </div>
                <p style={{ 
                  fontSize: '12px', 
                  color: '#4a5568', 
                  margin: 0,
                  textAlign: 'center'
                }}>
                  Uploading... {uploadProgress}%
                </p>
              </div>
            )}
            
            <div style={{ display: 'flex', height: uploading ? 'calc(100% - 60px)' : '100%' }}>
            {/* PDF Viewer */}
            <div className="left-panel" style={{ width: '50%', height: '100%', overflow: 'auto', borderRight: '1px solid #dee2e6' }}>

              <div className="pdf-viewer" style={{ 
                backgroundColor: '#f8f9fa',
                minHeight: '100%',
                display: 'flex',
                flexDirection: 'column'
              }}>
                {/* PDF Viewer Header - Chrome Style */}
                {file && !loading && (
                  <div style={{
                    position: 'fixed',
                    top: '38px',
                    left: 0,
                    right: '50%',
                    height: '60px',
                    backgroundColor: '#ffffff',
                    borderBottom: '1px solid #dee2e6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 20px',
                    zIndex: 1000,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <h5 style={{ margin: 0, color: '#2d3748', fontSize: '16px', fontWeight: '600' }}>
                        {pdfInfo?.filename || 'Document'}
                      </h5>
                      <span style={{ 
                        color: '#718096', 
                        fontSize: '12px',
                        backgroundColor: '#f7fafc',
                        padding: '2px 8px',
                        borderRadius: '12px'
                      }}>
                        {pdfInfo?.num_pages || 0} pages
                      </span>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={reExtractText}
                        disabled={loading}
                        className="btn btn-outline-secondary btn-sm"
                        style={{ 
                          fontSize: '11px', 
                          padding: '8px 12px',
                          minWidth: '80px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          whiteSpace: 'nowrap'
                        }}
                        title="Re-extract text from PDF (without OCR)"
                      >
                        {loading ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                            Extracting...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-arrow-clockwise me-1"></i>
                            Extract Text
                          </>
                        )}
                      </button>
                      
                      <button
                        onClick={processOcr}
                        disabled={loading}
                        className="btn btn-primary btn-sm"
                        style={{ 
                          fontSize: '11px', 
                          padding: '8px 12px',
                          minWidth: '80px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          whiteSpace: 'nowrap'
                        }}
                        title="Process OCR and update searchable text"
                      >
                        {processingOcr ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                            OCR...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-eye me-1"></i>
                            OCR
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* OCR Progress Bar */}
                {processingOcr && (
                  <div style={{
                    position: 'fixed',
                    top: '98px', // Below the PDF viewer header
                    left: 0,
                    right: '50%',
                    zIndex: 1001,
                    backgroundColor: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    padding: '12px 20px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    <div style={{ 
                      backgroundColor: '#e2e8f0', 
                      borderRadius: '8px', 
                      height: '6px', 
                      overflow: 'hidden',
                      marginBottom: '6px'
                    }}>
                      <div style={{
                        backgroundColor: '#28a745',
                        height: '100%',
                        width: `${ocrProgress}%`,
                        transition: 'width 0.3s ease',
                        borderRadius: '8px'
                      }}></div>
                    </div>
                    <p style={{ 
                      fontSize: '12px', 
                      color: '#4a5568', 
                      margin: 0,
                      textAlign: 'center'
                    }}>
                      Processing OCR... {ocrProgress}%
                    </p>
                  </div>
                )}

                {/* PDF Content */}
                <div style={{ 
                  padding: '30px 20px',
                  paddingTop: file && !loading ? (processingOcr ? '180px' : '120px') : '30px',
                  flex: 1,
                  overflow: 'auto'
                }}>
                {error && (
                  <div className="alert alert-danger" style={{ marginBottom: '20px' }}>
                    <strong>Error:</strong> {error}
                    <button
                      onClick={retryLoadDocument}
                      className="btn btn-outline-danger btn-sm ms-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
                
                {loading && (
                  <div className="text-center" style={{ padding: '40px' }}>
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p style={{ marginTop: '16px', color: '#718096' }}>Processing PDF...</p>
                  </div>
                )}
                
                {file && !loading && (
                  <Document
                    ref={documentRef}
                    file={file}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={
                      <div className="text-center" style={{ padding: '20px' }}>
                        <div className="spinner-border text-primary" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                      </div>
                    }
                  >
                    {Array.from(new Array(numPages), (el, index) => {
                      const pageNum = index + 1
                      const inContext = parsedPageRanges.length > 0 ? parsedPageRanges.includes(pageNum) : 
                                      pageNum >= pageRange[0] && pageNum <= pageRange[1]
                      
                      return (
                        <div 
                          key={pageNum} 
                          data-page-number={pageNum}
                          style={{ 
                            position: 'relative', 
                            marginBottom: pageNum < numPages ? '60px' : '40px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            paddingBottom: '20px'
                          }}
                        >
                          {/* Page separator line */}
                          {pageNum < numPages && (
                            <div style={{
                              position: 'absolute',
                              bottom: -30,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: '80%',
                              height: '2px',
                              background: 'linear-gradient(to right, transparent, #dee2e6 20%, #dee2e6 80%, transparent)',
                              borderRadius: '1px'
                            }} />
                          )}
                          {/* Classic PDF viewer page number - top centered */}
                          <div 
                            className="page-number-indicator"
                            style={{
                              position: 'absolute',
                              top: -25,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              background: '#f8f9fa',
                              color: '#495057',
                              padding: '4px 12px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: '500',
                              zIndex: 10,
                              border: '1px solid #dee2e6',
                              cursor: 'default',
                              userSelect: 'none',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                            }}
                          >
                            Page {pageNum}/{numPages}
                          </div>
                          
                          {/* Match quality indicator */}
                          {matchQuality[pageNum] && (
                            <div style={{
                              position: 'absolute',
                              top: 6,
                              right: 6,
                              background: matchQuality[pageNum].confidence === 'high' ? '#d4edda' : 
                                         matchQuality[pageNum].confidence === 'medium' ? '#fff3cd' : '#f8d7da',
                              color: matchQuality[pageNum].confidence === 'high' ? '#155724' : 
                                     matchQuality[pageNum].confidence === 'medium' ? '#856404' : '#721c24',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 10,
                              zIndex: 10
                            }}>
                              Match: {matchQuality[pageNum].score}% ({matchQuality[pageNum].strategy})
                            </div>
                          )}
                          
                          {/* Highlighting status indicator */}
                          {highlightingStatus[pageNum] && (
                            <div style={{
                              position: 'absolute',
                              bottom: 6,
                              right: 6,
                              background: highlightingStatus[pageNum] === 'success' ? '#d4edda' : 
                                         highlightingStatus[pageNum] === 'retrying' ? '#fff3cd' : '#f8d7da',
                              color: highlightingStatus[pageNum] === 'success' ? '#155724' : 
                                     highlightingStatus[pageNum] === 'retrying' ? '#856404' : '#721c24',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 10,
                              zIndex: 10
                            }}>
                              {highlightingStatus[pageNum] === 'success' ? '✓ Highlighted' : 
                               highlightingStatus[pageNum] === 'retrying' ? '⟳ Retrying...' : '✗ Failed'}
                            </div>
                          )}
                          <Page
                            key={currentPage === pageNum && highlightedQuote ? `highlight-${currentPage}-${highlightedQuote}` : `page-${pageNum}`}
                            pageNumber={pageNum}
                            className="pdf-page-container"
                            style={{
                              border: inContext ? '2px solid #007bff' : '1px solid #dee2e6',
                              borderRadius: 4,
                              backgroundColor: '#fff'
                            }}
                            customTextRenderer={({ str, itemIndex, transform, width, height, dir }) => {
                              // Collect fragments for the current page
                              if (!pageTextFragments.current[pageNum]) {
                                pageTextFragments.current[pageNum] = [];
                              }
                              
                              pageTextFragments.current[pageNum][itemIndex] = { str, itemIndex };
                              
                              // Check if this fragment should be highlighted (old method)
                              const isHighlighted = currentPage === pageNum && 
                                                   highlightedFragmentIndices[pageNum] && 
                                                   highlightedFragmentIndices[pageNum].has(itemIndex);
                              
                              // Return highlighted text if needed
                              if (isHighlighted) {
                                return `<span class="highlighted-fragment">${str}</span>`;
                              }
                              
                              // Return plain text
                              return str;
                            }}
                            onRenderSuccess={() => {
                              setTextLayerReady(prev => {
                                if (prev[pageNum]) return prev; // already true, do not update
                                return { ...prev, [pageNum]: true };
                              });
                              
                              // Only highlight if this is the current page and we have a quote to highlight
                              if (currentPage === pageNum && highlightedQuote) {
                                retryHighlight(pageNum, highlightedQuote);
                              }
                            }}
                            onRenderError={(error) => {
                              console.error('[Highlight] Render error for page', pageNum, ':', error);
                              // If render fails, try simple retry
                              if (currentPage === pageNum && highlightedQuote) {
                                setTimeout(() => highlightTextInPage(pageNum, highlightedQuote), 50);
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </Document>
                )}
                </div>
              </div>
            </div>
            {/* Chat Panel */}
            <div className="right-panel" style={{ width: '50%', height: '100%', overflow: 'hidden' }}>
              <div className="chat-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', borderBottom: '1px solid #dee2e6', flexShrink: 0 }}>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>Chat with Gemini</h3>
                  <button 
                    onClick={() => clearChat()}
                    disabled={clearingChat}
                    className="btn btn-outline-danger btn-sm"
                    style={{ fontSize: '11px', padding: '3px 6px' }}
                  >
                    {clearingChat ? (
                      <>
                        <div className="spinner-border spinner-border-sm me-1" role="status">
                          <span className="visually-hidden">Clearing...</span>
                        </div>
                        Clearing...
                      </>
                    ) : (
                      'Clear Chat'
                    )}
                  </button>
                </div>
                
                {/* Chat Messages */}
                <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
                  {chatMessages.length === 0 ? (
                    <div className="text-center" style={{ color: '#718096', marginTop: '40px' }}>
                      <i className="bi bi-chat-dots" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
                      <p>Start a conversation about your PDF</p>
                    </div>
                  ) : (
                    chatMessages.map((message, index) => (
                      <div
                        key={message.id}
                        className={`${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
                        style={{
                          marginBottom: '16px',
                          display: 'flex',
                          justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                          width: '100%'
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          maxWidth: '80%',
                          flexDirection: message.role === 'user' ? 'row-reverse' : 'row'
                        }}>
                          <div style={{
                            backgroundColor: message.role === 'user' ? '#007bff' : '#f8f9fa',
                            color: message.role === 'user' ? 'white' : '#212529',
                            padding: '12px 16px',
                            borderRadius: '12px',
                            cursor: message.role === 'assistant' ? 'pointer' : 'default',
                            border: message.role === 'assistant' ? '1px solid #e9ecef' : 'none',
                            fontSize: '12px'
                          }}
                          onClick={() => handleMessageClick(message)}
                          >
                            {message.loading ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div className="spinner-border spinner-border-sm" style={{ color: message.role === 'user' ? 'white' : '#007bff' }} role="status">
                                  <span className="visually-hidden">Loading...</span>
                                </div>
                                <span>Thinking...</span>
                              </div>
                            ) : message.error ? (
                              <div style={{ color: message.role === 'user' ? '#ffcccc' : '#e53e3e' }}>
                                <strong>Error:</strong> {message.content}
                              </div>
                            ) : (
                              <ReactMarkdown>{message.content}</ReactMarkdown>
                            )}
                            
                            {message.page_range && (
                              <div style={{ 
                                fontSize: '12px', 
                                color: message.role === 'user' ? 'rgba(255,255,255,0.8)' : '#6c757d', 
                                marginTop: '8px',
                                fontStyle: 'italic'
                              }}>
                                {(() => {
                                  if (Array.isArray(message.page_range) && message.page_range.length >= 2) {
                                    return `Pages ${message.page_range[0]}-${message.page_range[1]}`
                                  } else if (message.page_range && typeof message.page_range === 'object' && message.page_range.type === 'specific_pages' && message.page_range.pages) {
                                    const pages = message.page_range.pages
                                    if (pages.length === 1) {
                                      return `Page ${pages[0]}`
                                    } else if (pages.length > 1) {
                                      return `Pages ${pages[0]}-${pages[pages.length-1]} (${pages.length} specific pages)`
                                    }
                                  }
                                  return null
                                })()}
                              </div>
                            )}
                            
                            {/* References Section */}
                            {message.references && message.references.length > 0 && (
                              <div style={{ 
                                marginTop: '12px',
                                fontSize: '12px'
                              }}>
                                <div style={{ 
                                  fontSize: '12px', 
                                  fontWeight: '600',
                                  color: message.role === 'user' ? 'rgba(255,255,255,0.9)' : '#495057',
                                  marginBottom: '6px'
                                }}>
                                  References:
                                </div>
                                {message.references.map((ref, refIndex) => (
                                  <div key={refIndex} style={{ 
                                    marginBottom: '6px',
                                    fontSize: '12px',
                                    lineHeight: '1.4'
                                  }}>
                                    <span style={{ 
                                      color: message.role === 'user' ? '#ffd700' : '#007bff',
                                      fontWeight: '500',
                                      fontSize: '12px'
                                    }}
                                    >
                                      Page {ref.page}
                                    </span>
                                    <span style={{ 
                                      color: message.role === 'user' ? 'rgba(255,255,255,0.8)' : '#6c757d',
                                      marginLeft: '8px',
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                      fontSize: '12px'
                                    }}
                                    title="Click to copy quote to clipboard"
                                    onMouseEnter={(e) => {
                                      e.target.style.backgroundColor = message.role === 'user' ? 'rgba(255,255,255,0.2)' : '#e9ecef'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.target.style.backgroundColor = 'transparent'
                                    }}
                                    onClick={(e) => {
                                      // Copy quote to clipboard
                                      navigator.clipboard.writeText(ref.quote).then(() => {
                                        console.log('✅ Quote copied to clipboard:', ref.quote)
                                        
                                        // Show toast notification
                                        const toast = document.createElement('div')
                                        toast.style.cssText = `
                                          position: fixed;
                                          top: 20px;
                                          right: 20px;
                                          background: #28a745;
                                          color: white;
                                          padding: 12px 20px;
                                          border-radius: 8px;
                                          font-size: 14px;
                                          font-weight: 500;
                                          z-index: 10000;
                                          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                                          display: flex;
                                          align-items: center;
                                          gap: 8px;
                                          animation: slideInRight 0.3s ease-out;
                                        `
                                        toast.innerHTML = `                                          <i class="bi bi-check-circle-fill" style="font-size: 16px;"></i>
                                          <span>Copied to clipboard!</span>
                                        `
                                        document.body.appendChild(toast)
                                        
                                        // Add CSS animation
                                        const style = document.createElement('style')
                                        style.textContent = `
                                          @keyframes slideInRight {
                                            from {
                                              transform: translateX(100%);
                                              opacity: 0;
                                            }
                                            to {
                                              transform: translateX(0);
                                              opacity: 1;
                                            }
                                          }
                                        `
                                        document.head.appendChild(style)
                                        
                                        // Remove toast after delay
                                        setTimeout(() => {
                                          if (document.body.contains(toast)) {
                                            document.body.removeChild(toast)
                                          }
                                          if (document.head.contains(style)) {
                                            document.head.removeChild(style)
                                          }
                                        }, 3000)
                                      }).catch(err => {
                                        console.error('Failed to copy quote:', err)
                                        
                                        // Show error toast
                                        const errorToast = document.createElement('div')
                                        errorToast.style.cssText = `
                                          position: fixed;
                                          top: 20px;
                                          right: 20px;
                                          background: #dc3545;
                                          color: white;
                                          padding: 12px 20px;
                                          border-radius: 8px;
                                          font-size: 14px;
                                          font-weight: 500;
                                          z-index: 10000;
                                          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                                          display: flex;
                                          align-items: center;
                                          gap: 8px;
                                          animation: slideInRight 0.3s ease-out;
                                        `
                                        errorToast.innerHTML = `
                                          <i class="bi bi-exclamation-triangle-fill" style="font-size: 16px;"></i>
                                          <span>Failed to copy to clipboard</span>
                                        `
                                        document.body.appendChild(errorToast)
                                        
                                        setTimeout(() => {
                                          if (document.body.contains(errorToast)) {
                                            document.body.removeChild(errorToast)
                                          }
                                        }, 3000)
                                      })
                                    }}
                                    >
                                      {ref.quote}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                
                {/* Chat Input */}
                <div className="chat-input" style={{ borderTop: '1px solid #dee2e6', flexShrink: 0 }}>
                  <div style={{ padding: '12px 15px' }}>
                    {/* First Line - Context Pages */}
                    {pdfInfo && (
                      <div className="context-line" style={{ 
                        padding: '6px 9px', 
                        borderBottom: '1px solid #e9ecef',
                        backgroundColor: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        marginBottom: '8px',
                        borderRadius: '4px',
                        border: '1px solid #dee2e6'
                      }}>
                        <span style={{ color: '#6c757d', fontWeight: '500', minWidth: '80px' }}>Context pages:</span>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px',
                          flex: 1
                        }}>
                          <input
                            type="text"
                            value={pageRangeInput}
                            onChange={e => handlePageRangeChange(e.target.value)}
                            placeholder="e.g., 5; 7; 11-13; [1-3;5-7]"
                            style={{ 
                              flex: 1,
                              padding: '3px 6px', 
                              border: '1px solid #ced4da', 
                              borderRadius: '3px',
                              fontSize: '11px',
                              backgroundColor: '#fff',
                              outline: 'none'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = '#007bff';
                              e.target.style.boxShadow = '0 0 0 2px rgba(0, 123, 255, 0.1)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = '#ced4da';
                              e.target.style.boxShadow = 'none';
                            }}
                          />
                          <span style={{ color: '#6c757d', fontSize: '11px' }}>of {numPages}</span>
                          {parsedPageRanges.length > 0 && (
                            <span style={{ color: '#28a745', fontSize: '10px', marginLeft: '6px' }}>
                              ({parsedPageRanges.length} pages selected)
                            </span>
                          )}
                        </div>
                        {parsedPageRanges.length > 0 && (
                          <button
                            onClick={() => setPageRange(parsedPageRanges.length > 0 ? [parsedPageRanges[0], parsedPageRanges[parsedPageRanges.length - 1]] : [1, numPages])}
                            className="btn btn-outline-secondary btn-sm"
                            style={{ fontSize: '10px', padding: '2px 4px', marginLeft: '3px' }}
                            title="Reset to parsed pages"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                    
                    {/* Second Line - Message Input */}
                    <div className="message-line" style={{ 
                      padding: '6px 9px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #dee2e6',
                      borderRadius: '4px'
                    }}>
                      <input
                        type="text"
                        value={inputMessage}
                        onChange={e => setInputMessage(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Ask a question about the PDF..."
                        disabled={!pdfInfo}
                        style={{ 
                          flex: 1, 
                          border: 'none',
                          outline: 'none',
                          fontSize: '12px',
                          backgroundColor: 'transparent'
                        }}
                      />
                      <button 
                        onClick={handleSendMessage} 
                        disabled={loading || !pdfInfo}
                        className="btn btn-primary btn-sm"
                        style={{ 
                          padding: '4px 9px',
                          fontSize: '11px',
                          fontWeight: '500'
                        }}
                      >
                        {loading ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}



        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(0, 0, 0, 0.5)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 2000
          }}>
            <div style={{ 
              backgroundColor: 'white', 
              borderRadius: '8px', 
              padding: '0',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}>
              <div style={{ 
                borderBottom: '1px solid #dee2e6', 
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#2d3748' }}>Confirm Delete</h5>
                <button 
                  onClick={handleDeleteCancel}
                  disabled={deletingInProgress}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: '#6c757d',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ padding: '20px' }}>
                <p style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#2d3748' }}>
                  Are you sure you want to delete <strong>"{documentToDelete?.filename}"</strong>?
                </p>
                <p style={{ margin: 0, fontSize: '14px', color: '#6c757d' }}>
                  This action cannot be undone. The document and all associated chat history will be permanently deleted.
                </p>
              </div>
              <div style={{ 
                borderTop: '1px solid #dee2e6', 
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px'
              }}>
                <button 
                  onClick={handleDeleteCancel}
                  disabled={deletingInProgress}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #6c757d',
                    borderRadius: '4px',
                    backgroundColor: 'white',
                    color: '#6c757d',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteConfirm}
                  disabled={deletingInProgress}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #dc3545',
                    borderRadius: '4px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                    opacity: deletingInProgress ? 0.6 : 1
                  }}
                >
                  {deletingInProgress ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default App

