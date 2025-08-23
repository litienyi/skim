import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './App.css'
import { useState, useRef, useEffect } from 'react'
import * as fuzz from 'fuzzball'
import ReactMarkdown from 'react-markdown'

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
  // Add state to track last used page range for mapping references
  const [lastPageRange, setLastPageRange] = useState([1, 1])
  const pageRefs = useRef([])
  
  // Simplified highlighting state management for Chrome PDF viewer
  const [currentPage, setCurrentPage] = useState(null)
  const [highlightedQuote, setHighlightedQuote] = useState(null)
  const [highlightWarning, setHighlightWarning] = useState(null)
  const [lastHighlightCall, setLastHighlightCall] = useState(null)
  
  // Simplified state for match quality and debugging
  const [matchQuality, setMatchQuality] = useState({}) // { [pageNum]: { score, strategy, confidence } }

  // Simplified state for Chrome PDF viewer
  const [searchResults, setSearchResults] = useState({}) // { [pageNum]: [searchResult] }
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)
  const [totalSearchResults, setTotalSearchResults] = useState(0)
  const [isSearching, setIsSearching] = useState(false)

  // Landing modal state management
  const [showLandingModal, setShowLandingModal] = useState(true)
  const [existingDocuments, setExistingDocuments] = useState([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [showExistingDocuments, setShowExistingDocuments] = useState(false)
  const [editingDocument, setEditingDocument] = useState(null)
  const [newDocumentName, setNewDocumentName] = useState('')
  const [deletingDocument, setDeletingDocument] = useState(null)
  
  // Enhanced page range state for multiple ranges
  const [pageRangeInput, setPageRangeInput] = useState('')
  const [parsedPageRanges, setParsedPageRanges] = useState([])
  
  // Chat session management
  const [currentChatSessionId, setCurrentChatSessionId] = useState(null)
  const [clearingChat, setClearingChat] = useState(false)
  const [processingReference, setProcessingReference] = useState(null)
  
  // Add state for tracking last used page range for inheritance
  const [lastUsedPageRange, setLastUsedPageRange] = useState(null)



  // PDF viewer state
  const [currentPageNumber, setCurrentPageNumber] = useState(1)
  const [findText, setFindText] = useState('')
  const [findResults, setFindResults] = useState([])
  const [currentFindIndex, setCurrentFindIndex] = useState(0)

  // Blob URL management
  const [currentBlobUrl, setCurrentBlobUrl] = useState(null)

  // Simplified PDF search functionality for Chrome PDF viewer
  async function searchInPDF(searchText, pageNum = null) {
    if (!searchText.trim()) {
      return { results: [], total: 0 }
    }

    // With Chrome's built-in PDF viewer, we can't programmatically search
    // Users will need to use the browser's built-in search (Ctrl+F)
    console.log('🔍 Search functionality is now handled by Chrome\'s built-in PDF viewer')
    console.log('🔍 Users can use Ctrl+F to search in the PDF')
    
    return { results: [], total: 0 }
  }

  // Simplified highlighting for Chrome PDF viewer
  async function highlightQuoteWithSearch(quote, targetPage = null) {
    if (!quote) return false

    try {
      console.log(`🔍 Quote highlighting is now handled by Chrome's built-in PDF viewer`)
      console.log(`🔍 Quote: "${quote}" on page ${targetPage || 'all pages'}`)
      
      // With Chrome's built-in PDF viewer, we can't programmatically highlight
      // Users will need to use the browser's built-in search (Ctrl+F) to find and highlight text
      console.log('💡 Tip: Use Ctrl+F in the PDF viewer to search for and highlight this quote')
      
      return true
    } catch (error) {
      console.error('Error highlighting quote:', error)
      return false
    }
  }

  // Navigate to next/previous search result
  function navigateSearchResult(direction) {
    const allResults = Object.values(searchResults).flat()
    if (allResults.length === 0) return

    let newIndex = currentSearchIndex
    if (direction === 'next') {
      newIndex = (newIndex + 1) % allResults.length
    } else {
      newIndex = (newIndex - 1 + allResults.length) % allResults.length
    }

    setCurrentSearchIndex(newIndex)
    const result = allResults[newIndex]
    
    setCurrentPage(result.page)
    setPageRange([result.page, result.page])
    
    // Scroll to the result
    setTimeout(() => {
      const pdfViewer = document.querySelector('.pdf-viewer')
      if (pdfViewer) {
        const pageElement = pdfViewer.querySelector(`[data-page-number="${result.page}"]`)
        if (pageElement) {
          pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }, 100)
  }

  // Clear search results
  function clearSearchResults() {
    setSearchResults({})
    setCurrentSearchIndex(0)
    setTotalSearchResults(0)
    setHighlightedQuote(null)
  }

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
    // Find the PDF content container (the scrollable area)
    const pdfContent = document.querySelector('[style*="overflow: auto"]')
    if (!pdfContent || !numPages) return

    const scrollTop = pdfContent.scrollTop
    const viewerHeight = pdfContent.clientHeight
    
    // Find all page elements
    const pages = document.querySelectorAll('[data-page-number]')
    let currentPage = 1
    
    for (let i = 0; i < pages.length; i++) {
      const pageElement = pages[i]
      const pageTop = pageElement.offsetTop
      const pageHeight = pageElement.offsetHeight
      
      // Check if this page is most visible in the viewport
      if (scrollTop >= pageTop - viewerHeight / 2 && scrollTop < pageTop + pageHeight - viewerHeight / 2) {
        currentPage = parseInt(pageElement.getAttribute('data-page-number'))
        break
      }
    }

    if (currentPage !== currentPageNumber && currentPage >= 1 && currentPage <= numPages) {
      setCurrentPageNumber(currentPage)
    }
  }

  // Handle find text change - simple and fast
  async function handleFindTextChange(text) {
    setFindText(text)
    
    if (text.trim()) {
      const { results, total } = await searchInPDF(text.trim())
      setFindResults(results)
      setCurrentFindIndex(0)
      
      if (total > 0) {
        // Set up search results for highlighting
        const resultsByPage = {}
        results.forEach(r => {
          if (!resultsByPage[r.page]) {
            resultsByPage[r.page] = []
          }
          resultsByPage[r.page].push(r)
        })
        
        setSearchResults(resultsByPage)
        setCurrentSearchIndex(0)
        setTotalSearchResults(total)
        
        // Navigate to first result
        const firstResult = results[0]
        handlePageChange(firstResult.page)
      } else {
        setSearchResults({})
        setCurrentSearchIndex(0)
        setTotalSearchResults(0)
      }
    } else {
      setFindResults([])
      setCurrentFindIndex(0)
      setSearchResults({})
      setCurrentSearchIndex(0)
      setTotalSearchResults(0)
    }
  }

  // Navigate to next/previous find result
  function navigateFindResult(direction) {
    if (findResults.length === 0) return

    let newIndex = currentFindIndex
    if (direction === 'next') {
      newIndex = (newIndex + 1) % findResults.length
    } else {
      newIndex = (newIndex - 1 + findResults.length) % findResults.length
    }

    setCurrentFindIndex(newIndex)
    const result = findResults[newIndex]
    
    if (result && result.page) {
      handlePageChange(result.page)
      
      // Update search results for highlighting
      const resultsByPage = {}
      findResults.forEach(r => {
        if (!resultsByPage[r.page]) {
          resultsByPage[r.page] = []
        }
        resultsByPage[r.page].push(r)
      })
      
      setSearchResults(resultsByPage)
      setCurrentSearchIndex(newIndex)
      setTotalSearchResults(findResults.length)
    }
  }

  function onDocumentLoadSuccess(numPages) {
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
    if (pdfInfo && pdfInfo.id) {
      setError(null)
      await loadExistingDocument(pdfInfo.id)
    }
  }

  // Retry PDF loading with exponential backoff
  async function retryPdfLoad(documentId, attempt = 1) {
    const maxAttempts = 3
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 1s, 2s, 4s
    
    console.log(`[PDF Load] Retry attempt ${attempt}/${maxAttempts} for document ${documentId}`)
    
    setTimeout(async () => {
      if (attempt >= maxAttempts) {
        console.log('[PDF Load] Max retry attempts reached')
        setError('Failed to load PDF after multiple attempts. Please try again later.')
        return
      }
      
      try {
        await loadExistingDocument(documentId)
      } catch (error) {
        console.log(`[PDF Load] Retry ${attempt} failed:`, error)
        retryPdfLoad(documentId, attempt + 1)
      }
    }, delay)
  }

  // Clean up blob URL
  function cleanupBlobUrl(blobUrl) {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrl)
    }
  }

  // Load existing document from server
  async function loadExistingDocument(documentId) {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`${API_URL}/documents/${documentId}`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Create a blob URL for the PDF
      const pdfResponse = await fetch(`${API_URL}/documents/${documentId}/file`)
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
      setPdfInfo(data)
      
      // Load the most recent chat session for this document
      await loadMostRecentChatSession(documentId)
      
    } catch (error) {
      console.error('Error loading document:', error)
      setError(`Failed to load document: ${error.message}`)
      // Retry with exponential backoff
      retryPdfLoad(documentId)
    } finally {
      setLoading(false)
    }
  }

  // Load chat history
  async function loadChatHistory(sessionId) {
    try {
      const response = await fetch(`${API_URL}/chat/sessions/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        const messages = data.messages || []
        console.log(`Loaded ${messages.length} messages from chat session ${sessionId}`)
        setChatMessages(messages)
        setCurrentChatSessionId(sessionId)
      } else {
        console.error(`Failed to load chat session ${sessionId}: ${response.status}`)
      }
    } catch (error) {
      console.error('Error loading chat history:', error)
    }
  }

  // Load the most recent chat session for a document
  async function loadMostRecentChatSession(documentId) {
    try {
      const response = await fetch(`${API_URL}/documents/${documentId}/chat-sessions`)
      if (response.ok) {
        const data = await response.json()
        const chatSessions = data.chat_sessions || []
        
        if (chatSessions.length > 0) {
          // Get the most recent chat session (they should be ordered by created_at desc)
          const mostRecentSession = chatSessions[0]
          console.log(`Loading chat session: ${mostRecentSession.id} with ${mostRecentSession.message_count} messages`)
          await loadChatHistory(mostRecentSession.id)
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
      console.error('Error loading most recent chat session:', error)
      // Start with empty chat on error
      setChatMessages([])
      setCurrentChatSessionId(null)
    }
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
      if (pdfInfo && pdfInfo.id === documentId) {
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

  // Handle file upload
  async function handleFileUpload(uploadedFile) {
    try {
      setLoading(true)
      setError(null)
      
      const formData = new FormData()
      formData.append('file', uploadedFile)
      
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      
      // Create a blob URL for the uploaded file
      const blobUrl = URL.createObjectURL(uploadedFile)
      
      // Clean up previous blob URL
      if (currentBlobUrl) {
        cleanupBlobUrl(currentBlobUrl)
      }
      
      setCurrentBlobUrl(blobUrl)
      setFile(blobUrl)
      setPdfInfo({
        id: data.document_id,
        filename: data.filename,
        original_filename: data.original_filename,
        num_pages: data.num_pages,
        file_size: data.file_size
      })
      
      // Clear chat messages for new document
      setChatMessages([])
      setCurrentChatSessionId(null)
      
      // Close landing modal
      setShowLandingModal(false)
      
    } catch (error) {
      console.error('Error uploading file:', error)
      setError(`Failed to upload file: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Handle file selection
  function handleFileSelect(event) {
    const selectedFile = event.target.files[0]
    if (selectedFile) {
      handleFileUpload(selectedFile)
    }
  }

  // Handle drag and drop
  function handleDrop(event) {
    event.preventDefault()
    const droppedFile = event.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === 'application/pdf') {
      handleFileUpload(droppedFile)
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  // Handle page range change
  function handlePageRangeChange(value) {
    setPageRangeInput(value)
    
    // Parse page ranges
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
    
    // Add user message to chat
    const newUserMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      page_range: parsedPageRanges.length > 0 ? [Math.min(...parsedPageRanges), Math.max(...parsedPageRanges)] : pageRange
    }
    
    setChatMessages(prev => [...prev, newUserMessage])
    
    // Add loading message
    const loadingMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: 'Thinking...',
      timestamp: new Date().toISOString(),
      loading: true
    }
    
    setChatMessages(prev => [...prev, loadingMessage])
    
    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          document_id: pdfInfo.id,
          page_range: parsedPageRanges.length > 0 ? [Math.min(...parsedPageRanges), Math.max(...parsedPageRanges)] : pageRange,
          chat_session_id: currentChatSessionId
        })
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Update chat session ID if provided
      if (data.chat_session_id) {
        setCurrentChatSessionId(data.chat_session_id)
      }
      
      // Replace loading message with actual response
      setChatMessages(prev => prev.map(msg => 
        msg.id === loadingMessage.id 
          ? {
              id: Date.now().toString(),
              role: 'assistant',
              content: data.message,
              timestamp: new Date().toISOString(),
              references: data.references || []
            }
          : msg
      ))
      
    } catch (error) {
      console.error('Error sending message:', error)
      
      // Replace loading message with error
      setChatMessages(prev => prev.map(msg => 
        msg.id === loadingMessage.id 
          ? {
              id: Date.now().toString(),
              role: 'assistant',
              content: `Error: ${error.message}`,
              timestamp: new Date().toISOString(),
              error: true
            }
          : msg
      ))
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





  // Handle message click for highlighting
  async function handleMessageClick(message) {
    if (message.role === 'assistant' && message.content && !message.loading && !message.error) {
      // First, try to use structured references if available
      if (message.references && message.references.length > 0) {
        const firstRef = message.references[0]
        if (firstRef.quote) {
          setHighlightedQuote(firstRef.quote)
          setCurrentPage(firstRef.page || 1)
          
          // Use enhanced search-based highlighting
          await highlightQuoteWithSearch(firstRef.quote, firstRef.page)
          return
        }
      }
      
      // Fallback: Extract quotes from the message content
      const quotes = message.content.match(/"([^"]+)"/g) || []
      
      if (quotes.length > 0) {
        const firstQuote = quotes[0].replace(/"/g, '')
        setHighlightedQuote(firstQuote)
        setCurrentPage(1) // Start from first page
        
        // Use enhanced search-based highlighting
        await highlightQuoteWithSearch(firstQuote)
      }
    }
  }

  // Load existing documents on mount
  useEffect(() => {
    loadExistingDocuments()
  }, [])

  // Add scroll listener for page tracking - real-time like Chrome
  useEffect(() => {
    // Find the PDF content container (the scrollable area)
    const pdfContent = document.querySelector('[style*="overflow: auto"]')
    if (pdfContent && file && !loading) {
      const handleScroll = () => {
        updateCurrentPageFromScroll()
      }
      
      pdfContent.addEventListener('scroll', handleScroll, { passive: true })
      
      return () => {
        pdfContent.removeEventListener('scroll', handleScroll)
      }
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
            <i className="bi bi-arrow-left"></i> Open another file
          </button>
          
          {highlightedQuote && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isSearching && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  fontSize: '11px',
                  color: '#6c757d'
                }}>
                  <div className="spinner-border spinner-border-sm" role="status">
                    <span className="visually-hidden">Searching...</span>
                  </div>
                  <span>Searching...</span>
                </div>
              )}
              {totalSearchResults > 0 && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  fontSize: '11px',
                  color: '#6c757d'
                }}>
                  <button
                    onClick={() => navigateSearchResult('prev')}
                    className="btn btn-outline-secondary btn-sm"
                    style={{ padding: '2px 4px', fontSize: '10px' }}
                    title="Previous result"
                  >
                    <i className="bi bi-chevron-left"></i>
                  </button>
                  <span>
                    {currentSearchIndex + 1} of {totalSearchResults}
                  </span>
                  <button
                    onClick={() => navigateSearchResult('next')}
                    className="btn btn-outline-secondary btn-sm"
                    style={{ padding: '2px 4px', fontSize: '10px' }}
                    title="Next result"
                  >
                    <i className="bi bi-chevron-right"></i>
                  </button>
                </div>
              )}
              <button
                onClick={clearSearchResults}
                className="btn btn-outline-warning btn-sm"
                style={{ whiteSpace: 'nowrap', fontSize: '11px', padding: '4px 8px' }}
                title="Clear highlights"
              >
                <i className="bi bi-highlighter"></i> Clear
              </button>
            </div>
          )}
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
              {pdfInfo.original_filename || pdfInfo.filename}
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
                  {showExistingDocuments ? 'Existing Documents' : 'Welcome to Skim2'}
                </h2>
                <p style={{ color: '#718096', fontSize: '14px' }}>
                  {showExistingDocuments ? 'Select a document to continue' : 'Upload a PDF to start analyzing'}
                </p>
              </div>

              {!showExistingDocuments ? (
                // Upload new file
                <div>
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    style={{
                      border: '2px dashed #cbd5e0',
                      borderRadius: '8px',
                      padding: '40px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                      marginBottom: '20px'
                    }}
                    onClick={() => document.getElementById('file-input').click()}
                  >
                    <i className="bi bi-cloud-upload" style={{ fontSize: '48px', color: '#a0aec0', marginBottom: '16px' }}></i>
                    <p style={{ margin: '0 0 8px 0', color: '#4a5568', fontWeight: '500' }}>
                      Drop your PDF here or click to browse
                    </p>
                    <p style={{ margin: 0, color: '#718096', fontSize: '14px' }}>
                      Supports PDF files up to 50MB
                    </p>
                  </div>
                  
                  <input
                    id="file-input"
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  <div className="text-center">
                    <button
                      onClick={() => setShowExistingDocuments(true)}
                      className="btn btn-outline-secondary"
                      style={{ fontSize: '14px' }}
                    >
                      View Existing Documents
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
                          key={doc.id}
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
                            loadExistingDocument(doc.id)
                            setShowLandingModal(false)
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#2d3748' }}>
                                {doc.original_filename}
                              </h4>
                              <p style={{ margin: '0 0 8px 0', color: '#718096', fontSize: '14px' }}>
                                {doc.num_pages} pages • {(doc.file_size / 1024 / 1024).toFixed(2)} MB
                              </p>
                              <p style={{ margin: 0, color: '#a0aec0', fontSize: '12px' }}>
                                Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteDocument(doc.id)
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
                      Upload New Document
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Application */}
        {!showLandingModal && (
          <div style={{ display: 'flex', height: '100%' }}>
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
                  <div className="pdf-header" style={{
                    position: 'fixed',
                    top: '38px',
                    left: '0',
                    right: '50%',
                    backgroundColor: '#f1f3f4',
                    borderBottom: '1px solid #dadce0',
                    padding: '8px 16px',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    fontFamily: 'Roboto, Arial, sans-serif'
                  }}>
                )}

                {/* PDF Content */}
                <div style={{ 
                  padding: '30px 20px',
                  paddingTop: file && !loading ? '60px' : '30px',
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
                  <div style={{ 
                    width: '100%', 
                    height: '100%', 
                    display: 'flex', 
                    flexDirection: 'column',
                    position: 'relative'
                  }}>
                    {/* PDF Info Bar */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: '#f8f9fa',
                      borderBottom: '1px solid #dee2e6',
                      padding: '8px 16px',
                      zIndex: 100,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      color: '#495057'
                    }}>
                      <span>
                        {pdfInfo?.original_filename || 'PDF Document'} 
                        {numPages && ` (${numPages} pages)`}
                      </span>
                      <span>
                        {inContext ? 'In Context' : 'All Pages'}
                      </span>
                    </div>
                    
                                         {/* Chrome PDF Viewer */}
                     <iframe
                       src={`${file}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`}
                       style={{
                         width: '100%',
                         height: '100%',
                         border: 'none',
                         marginTop: '40px' // Space for info bar
                       }}
                       title="PDF Viewer"
                       onLoad={() => {
                         // Set numPages to a default value since we can't easily get it from Chrome's viewer
                         if (!numPages && pdfInfo?.num_pages) {
                           onDocumentLoadSuccess(pdfInfo.num_pages);
                         }
                       }}
                     />
                  </div>
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
                          gap: '12px',
                          maxWidth: '80%',
                          flexDirection: message.role === 'user' ? 'row-reverse' : 'row'
                        }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            color: 'white',
                            backgroundColor: message.role === 'user' ? '#007bff' : '#6c757d',
                            flexShrink: 0
                          }}>
                            {message.role === 'user' ? 'U' : 'A'}
                          </div>
                          
                          <div style={{
                            backgroundColor: message.role === 'user' ? '#007bff' : '#f8f9fa',
                            color: message.role === 'user' ? 'white' : '#212529',
                            padding: '12px 16px',
                            borderRadius: '12px',
                            cursor: message.role === 'assistant' ? 'pointer' : 'default',
                            border: message.role === 'assistant' ? '1px solid #e9ecef' : 'none'
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
                            
                            {message.page_range && message.page_range.length >= 2 && (
                              <div style={{ 
                                fontSize: '11px', 
                                color: message.role === 'user' ? 'rgba(255,255,255,0.8)' : '#6c757d', 
                                marginTop: '8px',
                                fontStyle: 'italic'
                              }}>
                                Pages {message.page_range[0]}-{message.page_range[1]}
                              </div>
                            )}
                            
                            {/* References Section */}
                            {message.references && message.references.length > 0 && (
                              <div style={{ 
                                marginTop: '12px',
                                padding: '8px 12px',
                                backgroundColor: message.role === 'user' ? 'rgba(255,255,255,0.1)' : '#f8f9fa',
                                borderRadius: '6px',
                                border: message.role === 'user' ? '1px solid rgba(255,255,255,0.2)' : '1px solid #e9ecef'
                              }}>
                                <div style={{ 
                                  fontSize: '12px', 
                                  fontWeight: '600',
                                  color: message.role === 'user' ? 'rgba(255,255,255,0.9)' : '#495057',
                                  marginBottom: '6px'
                                }}>
                                  📚 References:
                                </div>
                                {message.references.map((ref, refIndex) => (
                                  <div key={refIndex} style={{ 
                                    marginBottom: '6px',
                                    fontSize: '11px',
                                    lineHeight: '1.4'
                                  }}>
                                    <span style={{ 
                                      color: message.role === 'user' ? '#ffd700' : '#007bff',
                                      fontWeight: '500',
                                      cursor: 'pointer',
                                      textDecoration: 'underline'
                                    }}
                                    onClick={async () => {
                                      if (ref.page && numPages) {
                                        const targetPage = Math.min(Math.max(1, ref.page), numPages);
                                        console.log(`📄 Navigating to page ${targetPage} for reference`)
                                        
                                        // Set page range and current page
                                        setPageRange([targetPage, targetPage]);
                                        setCurrentPage(targetPage);
                                        
                                        // Scroll to the page in PDF viewer with enhanced positioning
                                        setTimeout(() => {
                                          const pdfViewer = document.querySelector('.pdf-viewer');
                                          if (pdfViewer) {
                                            const pageElement = pdfViewer.querySelector(`[data-page-number="${targetPage}"]`);
                                            if (pageElement) {
                                              // Scroll to the page with better positioning
                                              pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                              
                                              // Add a visual indicator that the page was found
                                              pageElement.style.border = '3px solid #007bff';
                                              pageElement.style.borderRadius = '8px';
                                              pageElement.style.transition = 'border 0.3s ease';
                                              
                                              // Remove the border after 2 seconds
                                              setTimeout(() => {
                                                pageElement.style.border = '';
                                                pageElement.style.borderRadius = '';
                                              }, 2000);
                                            }
                                          }
                                        }, 100);
                                      }
                                    }}
                                    >
                                      Page {ref.page}
                                    </span>
                                    <span style={{ 
                                      color: message.role === 'user' ? 'rgba(255,255,255,0.8)' : '#6c757d',
                                      marginLeft: '8px',
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                      fontStyle: 'italic',
                                      backgroundColor: highlightedQuote === ref.quote ? 'rgba(255, 224, 102, 0.3)' : 'transparent',
                                      padding: highlightedQuote === ref.quote ? '2px 4px' : 
                                             processingReference === `${ref.page}-${ref.quote.substring(0, 20)}` ? '2px 4px' : '0',
                                      borderRadius: highlightedQuote === ref.quote ? '3px' : 
                                                  processingReference === `${ref.page}-${ref.quote.substring(0, 20)}` ? '3px' : '0',
                                      transition: 'all 0.2s ease'
                                    }}
                                    onClick={() => {
                                      // Copy quote to clipboard
                                      navigator.clipboard.writeText(ref.quote).then(() => {
                                        console.log('✅ Quote copied to clipboard:', ref.quote)
                                        
                                        // Show brief feedback
                                        const quoteElement = event.target
                                        const originalText = quoteElement.textContent
                                        quoteElement.textContent = '✅ Copied!'
                                        quoteElement.style.color = '#28a745'
                                        
                                        setTimeout(() => {
                                          quoteElement.textContent = originalText
                                          quoteElement.style.color = ''
                                        }, 1500)
                                        
                                        // Show a helpful tooltip
                                        const tooltip = document.createElement('div')
                                        tooltip.style.cssText = `
                                          position: fixed;
                                          top: 50%;
                                          left: 50%;
                                          transform: translate(-50%, -50%);
                                          background: #333;
                                          color: white;
                                          padding: 12px 16px;
                                          border-radius: 6px;
                                          font-size: 14px;
                                          z-index: 10000;
                                          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                                        `
                                        tooltip.textContent = 'Quote copied! Press Ctrl+F (or Cmd+F) to find it in the PDF'
                                        document.body.appendChild(tooltip)
                                        
                                        setTimeout(() => {
                                          document.body.removeChild(tooltip)
                                        }, 3000)
                                      }).catch(err => {
                                        console.error('Failed to copy quote:', err)
                                      })
                                    }}
                                    >
                                      `"${ref.quote}"`
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
        )}

      </div>
    </div>
  )
}

export default App
