import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './App.css'
import { useState, useRef, useEffect } from 'react'
import * as fuzz from 'fuzzball'
import ReactMarkdown from 'react-markdown'
import Auth from './Auth'

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
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

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
  
  // Add state for tracking last used page range for inheritance
  const [lastUsedPageRange, setLastUsedPageRange] = useState(null)

  // Add state for highlighting status
  const [highlightingStatus, setHighlightingStatus] = useState({}); // { [pageNum]: 'success' | 'failed' | 'retrying' }

  // Check authentication on mount
  useEffect(() => {
    if (token) {
      setIsAuthenticated(true);
    }
  }, [token]);

  // Authentication handlers
  const handleLogin = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    // Reset all app state
    setFile(null);
    setPdfInfo(null);
    setChatMessages([]);
    setExistingDocuments([]);
    // Clean up blob URL if it exists
    if (currentBlobUrl) {
      cleanupBlobUrl(currentBlobUrl);
      setCurrentBlobUrl(null);
    }
  };

  // Helper function to add auth headers to API calls
  const getAuthHeaders = () => {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages)
    setPageRange([1, numPages])
    setPageRangeInput('')
    setParsedPageRanges([])
    // Initialize last used page range to full range
    setLastUsedPageRange([1, numPages])
    // Clear any previous errors
    setError(null)
  }

  // Handle PDF loading errors
  function onDocumentLoadError(error) {
    console.error('PDF load error:', error)
    
    // Check if it's an authentication error
    if (error.message && error.message.includes('401')) {
      setError('Authentication failed. Please log in again.')
    } else if (error.message && error.message.includes('404')) {
      setError('PDF file not found. The file may have been deleted.')
    } else {
      setError(`Failed to load PDF: ${error.message}`)
    }
    
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
    if (pdfInfo && pdfInfo.document_id) {
      setError(null)
      await loadExistingDocument(pdfInfo.document_id)
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
        console.warn(`[PDF Load] Retry ${attempt} failed:`, error)
        retryPdfLoad(documentId, attempt + 1)
      }
    }, delay)
  }

  // Load existing documents from backend
  async function loadExistingDocuments() {
    setLoadingDocuments(true)
    try {
      const response = await fetch(`${API_URL}/documents`, {
        headers: getAuthHeaders()
      })
      if (response.ok) {
        const documents = await response.json()
        setExistingDocuments(documents)
      } else {
        console.error('Failed to load documents')
      }
    } catch (error) {
      console.error('Error loading documents:', error)
    } finally {
      setLoadingDocuments(false)
    }
  }

  // Load an existing document
  async function loadExistingDocument(documentId) {
    console.log('=== Loading existing document ===')
    console.log('Document ID:', documentId)
    console.log('API URL:', API_URL)
    
    setLoading(true)
    setError(null)
    try {
      console.log('Fetching document data...')
      const response = await fetch(`${API_URL}/documents/${documentId}`, {
        headers: getAuthHeaders()
      })
      
      console.log('Document response status:', response.status)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Document fetch failed:', errorText)
        throw new Error(`Failed to load document: ${response.status} ${errorText}`)
      }
      
      const documentData = await response.json()
      console.log('Document data loaded:', documentData)
      
      // Create a direct URL to the PDF with proper headers
      const pdfUrl = `${API_URL}/pdf/${documentData.filename}`
      console.log('PDF URL:', pdfUrl)
      
      // Fetch the PDF with authentication headers and create a blob URL
      console.log('Fetching PDF with authentication...')
      const pdfResponse = await fetch(pdfUrl, {
        headers: getAuthHeaders()
      })
      
      console.log('PDF response status:', pdfResponse.status)
      if (!pdfResponse.ok) {
        const errorText = await pdfResponse.text()
        console.error('PDF fetch failed:', errorText)
        
        // Provide specific error messages for common issues
        if (pdfResponse.status === 401) {
          throw new Error('Authentication failed. Please log in again.')
        } else if (pdfResponse.status === 404) {
          throw new Error('PDF file not found. The file may have been deleted.')
        } else if (pdfResponse.status === 0) {
          throw new Error('Network error. Please check your connection and try again.')
        } else {
          throw new Error(`PDF file not accessible: ${pdfResponse.status} ${errorText}`)
        }
      }
      
      // Create blob URL from the PDF response
      const pdfBlob = await pdfResponse.blob()
      const blobUrl = URL.createObjectURL(pdfBlob)
      console.log('Created blob URL for PDF:', blobUrl)
      
      // Clean up previous blob URL if it exists
      if (currentBlobUrl) {
        cleanupBlobUrl(currentBlobUrl)
      }
      
      console.log('PDF is accessible, setting up viewer...')
      // Set the PDF info and blob URL
      setPdfInfo(documentData)
      setFile(blobUrl) // Use blob URL instead of direct URL
      setCurrentBlobUrl(blobUrl) // Track the blob URL for cleanup
      setNumPages(documentData.num_pages)
      setPageRange([1, documentData.num_pages])
      setPageRangeInput('')
      setParsedPageRanges([])
      setLastUsedPageRange([1, documentData.num_pages]) // Initialize last used range
      setShowLandingModal(false)
      
      // Initialize chat session and load existing chat messages
      console.log('Loading chat history...')
      await loadChatHistory(documentData.document_id)
      
      console.log('Document loaded successfully')
    } catch (e) {
      console.error('Error loading document:', e)
      
      // Provide user-friendly error messages
      let errorMessage = e.message
      if (e.message.includes('Failed to fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (e.message.includes('CORS')) {
        errorMessage = 'Browser security error. Please refresh the page and try again.'
      } else if (e.message.includes('Authentication failed')) {
        errorMessage = 'Session expired. Please log in again.'
      }
      
      setError(`Error loading document: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  // Update page ranges when input changes
  function handlePageRangeChange(input) {
    setPageRangeInput(input)
    if (numPages) {
      const parsed = parsePageRanges(input, numPages)
      setParsedPageRanges(parsed)
    }
  }

  // Create or get chat session for document
  async function getOrCreateChatSession(documentId) {
    try {
      // First try to get existing chat sessions
      const response = await fetch(`${API_URL}/chat_sessions`, {
        headers: getAuthHeaders()
      })
      if (response.ok) {
        const sessions = await response.json()
        if (sessions && sessions.length > 0) {
          // Use the most recent session
          const latestSession = sessions[sessions.length - 1]
          setCurrentChatSessionId(latestSession.id)
          return latestSession.id
        }
      }
      
      // Create new session if none exists
      const createResponse = await fetch(`${API_URL}/chat_sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ document_id: documentId })
      })
      
      if (createResponse.ok) {
        const newSession = await createResponse.json()
        setCurrentChatSessionId(newSession.chat_session_id)
        return newSession.chat_session_id
      }
    } catch (error) {
      console.error('Error managing chat session:', error)
    }
    return null
  }

  // Save chat message to database
  async function saveChatMessage(sender, message, references = [], pageRange = null) {
    if (!currentChatSessionId) return
    
    try {
      await fetch(`${API_URL}/chat_messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          chat_session_id: currentChatSessionId,
          sender: sender,
          message: message,
          reference_word_ids: references.length > 0 ? references.map(ref => ref.word_ids).flat() : null,
          reference_page: references.length > 0 ? references[0].pdfPage || references[0].page : null,
          reference_quote: references.length > 0 ? references[0].quote : null,
          page_range: pageRange,
          references: references  // Save all references
        })
      })
    } catch (error) {
      console.error('Error saving chat message:', error)
    }
  }

  // Load chat history for a document
  async function loadChatHistory(documentId) {
    try {
      // First get or create chat session
      const sessionId = await getOrCreateChatSession(documentId)
      if (!sessionId) return
      
      // Load messages for this session
      const response = await fetch(`${API_URL}/chat_messages?chat_session_id=${sessionId}`, {
        headers: getAuthHeaders()
      })
      if (response.ok) {
        const messages = await response.json()
        setChatMessages(messages.map(msg => ({
          role: msg.sender,
          content: msg.message,
          references: msg.references || (msg.reference_page ? [{ 
            pdfPage: msg.reference_page,
            quote: msg.reference_quote || '',
            page: msg.reference_page
          }] : []),
          pageRange: msg.page_range
        })))
      }
    } catch (error) {
      console.error('Error loading chat history:', error)
    }
  }

  // Handle new document upload
  function handleNewDocument() {
    setShowLandingModal(false)
    // Reset state for new document
    setFile(null)
    setPdfInfo(null)
    setChatMessages([])
    setHighlightRefs([])
    setCurrentPage(null)
    setHighlightedQuote(null)
    setHighlightedFragmentIndices({})
    setMatchQuality({})
    setError(null)
    setCurrentChatSessionId(null)
    
    // Trigger file input dialog
    setTimeout(() => {
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = '.pdf'
      fileInput.onchange = onFileChange
      fileInput.click()
    }, 100)
  }

  // Handle opening existing session
  function handleOpenExistingSession() {
    setShowExistingDocuments(true)
  }

  // Go back to main modal
  function handleBackToMain() {
    setShowExistingDocuments(false)
  }

  // Handle document rename
  async function handleRenameDocument(documentId, newName) {
    if (!newName.trim()) return
    
    try {
      const response = await fetch(`${API_URL}/documents/${documentId}/rename`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ new_name: newName.trim() })
      })
      
      if (response.ok) {
        // Update the local state
        setExistingDocuments(prev => prev.map(doc => 
          doc.document_id === documentId 
            ? { ...doc, original_filename: newName.trim() }
            : doc
        ))
        setEditingDocument(null)
        setNewDocumentName('')
      } else {
        console.error('Failed to rename document')
      }
    } catch (error) {
      console.error('Error renaming document:', error)
    }
  }

  // Handle document delete
  async function handleDeleteDocument(documentId) {
    try {
      const response = await fetch(`${API_URL}/documents/${documentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      
      if (response.ok) {
        // Remove from local state
        setExistingDocuments(prev => prev.filter(doc => doc.document_id !== documentId))
        setDeletingDocument(null)
      } else {
        console.error('Failed to delete document')
      }
    } catch (error) {
      console.error('Error deleting document:', error)
    }
  }

  // Start editing a document
  function startEditDocument(doc) {
    setEditingDocument(doc.document_id)
    setNewDocumentName(doc.original_filename || doc.filename)
  }

  // Cancel editing
  function cancelEdit() {
    setEditingDocument(null)
    setNewDocumentName('')
  }

  // Parse page range input into array of individual page numbers
  function parsePageRanges(input, maxPages) {
    if (!input.trim()) return []
    
    const pages = new Set()
    
    // Handle square bracket groups first
    const bracketRegex = /\[([^\]]+)\]/g
    let processedInput = input
    let bracketMatches = []
    let match
    
    // Extract all bracket groups
    while ((match = bracketRegex.exec(input)) !== null) {
      bracketMatches.push(match[1])
      processedInput = processedInput.replace(match[0], `__BRACKET_${bracketMatches.length - 1}__`)
    }
    
    // Process bracket groups
    for (let i = 0; i < bracketMatches.length; i++) {
      const bracketContent = bracketMatches[i]
      const ranges = bracketContent.split(';').map(r => r.trim()).filter(r => r)
      
      for (const range of ranges) {
        if (range.includes('-')) {
          const [start, end] = range.split('-').map(n => parseInt(n.trim()))
          if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0 && start <= end && end <= maxPages) {
            for (let j = start; j <= end; j++) {
              pages.add(j)
            }
          }
        } else {
          const page = parseInt(range)
          if (!isNaN(page) && page > 0 && page <= maxPages) {
            pages.add(page)
          }
        }
      }
    }
    
    // Process remaining ranges (outside brackets)
    const ranges = processedInput.split(';').map(r => r.trim()).filter(r => r && !r.startsWith('__BRACKET_'))
    
    for (const range of ranges) {
      if (range.includes('-')) {
        // Handle range like "11-13"
        const [start, end] = range.split('-').map(n => parseInt(n.trim()))
        if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0 && start <= end && end <= maxPages) {
          for (let i = start; i <= end; i++) {
            pages.add(i)
          }
        }
      } else {
        // Handle single page like "5"
        const page = parseInt(range)
        if (!isNaN(page) && page > 0 && page <= maxPages) {
          pages.add(page)
        }
      }
    }
    
    return Array.from(pages).sort((a, b) => a - b)
  }

  // Load existing documents when modal is shown
  useEffect(() => {
    if (showLandingModal) {
      loadExistingDocuments()
    }
  }, [showLandingModal])

  async function onFileChange(event) {
    const file = event.target.files[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      // Create headers without Content-Type for FormData
      const headers = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      
      const uploadResponse = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: headers,
        body: formData
      })
      if (!uploadResponse.ok) throw new Error('Failed to upload file')
      const uploadData = await uploadResponse.json()
      setPdfInfo(uploadData)
      setFile(file)
      setNumPages(uploadData.num_pages)
      setPageRange([1, uploadData.num_pages])
      setPageRangeInput('')
      setParsedPageRanges([])
      setShowLandingModal(false) // Close modal after successful upload
      
      // Initialize chat session for new document
      await getOrCreateChatSession(uploadData.document_id)
    } catch (e) {
      setError('Error uploading file')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendMessage() {
    if (!inputMessage.trim() || !pdfInfo) return
    
    const userMessage = inputMessage.trim()
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setInputMessage('')
    setLoading(true)
    
      // Auto-fill page range input with last used range if empty
  if (pageRangeInput.trim() === '' && lastUsedPageRange) {
    const rangeText = `${lastUsedPageRange[0]}-${lastUsedPageRange[1]}`
    setPageRangeInput(rangeText)
    const newParsedRanges = lastUsedPageRange[0] === lastUsedPageRange[1] ? [lastUsedPageRange[0]] : 
                           Array.from({length: lastUsedPageRange[1] - lastUsedPageRange[0] + 1}, (_, i) => lastUsedPageRange[0] + i)
    setParsedPageRanges(newParsedRanges)
    
    // Show a brief notification that range was auto-filled
    const rangeIndicator = document.createElement('div')
    rangeIndicator.textContent = `Auto-filled page range: ${rangeText}`
    rangeIndicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      animation: fadeInOut 3s ease-in-out;
    `
    document.body.appendChild(rangeIndicator)
    setTimeout(() => {
      if (rangeIndicator.parentNode) {
        rangeIndicator.parentNode.removeChild(rangeIndicator)
      }
    }, 3000)
  }
    
    // Use current page range or inherit from last message
    let currentPageRange = parsedPageRanges.length > 0 ? parsedPageRanges : 
                          (lastUsedPageRange || [1, numPages])
    
    // Use the raw page range input string for backend processing
    // The backend has advanced parsing for square brackets and complex formats
    let pageRangeString = pageRangeInput.trim()
    
    // If no page range input, use the parsed ranges as fallback
    if (!pageRangeString && currentPageRange.length > 0) {
      // Convert array to string format like "1-50;51-98"
      const ranges = []
      let start = currentPageRange[0]
      let end = currentPageRange[0]
      
      for (let i = 1; i < currentPageRange.length; i++) {
        if (currentPageRange[i] === end + 1) {
          // Consecutive page, extend range
          end = currentPageRange[i]
        } else {
          // Gap found, save current range and start new one
          ranges.push(start === end ? `${start}` : `${start}-${end}`)
          start = currentPageRange[i]
          end = currentPageRange[i]
        }
      }
      // Add the last range
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
      pageRangeString = ranges.join(';')
    }
    
    // Save user message to database
    await saveChatMessage('user', userMessage, [], currentPageRange.length > 0 ? [currentPageRange[0], currentPageRange[currentPageRange.length - 1]] : [1, numPages])
    
    // Debug: Log the request being sent to Gemini
    const requestBody = {
      document_id: pdfInfo.document_id,
      message: userMessage,
      page_range: pageRangeString
    }
    console.log('=== GEMINI REQUEST DEBUG ===')
    console.log('Request URL:', `${API_URL}/chat`)
    console.log('Request Method:', 'POST')
    console.log('Request Headers:', { 'Content-Type': 'application/json' })
    console.log('Request Body:', JSON.stringify(requestBody, null, 2))
    console.log('Page Range Details:', {
      currentPageRange,
      pageRangeString,
      startPage: currentPageRange.length > 0 ? currentPageRange[0] : 1,
      endPage: currentPageRange.length > 0 ? currentPageRange[currentPageRange.length - 1] : numPages,
      totalPages: currentPageRange.length
    })
    console.log('Current pageRange state:', pageRange)
    console.log('Parsed page ranges:', parsedPageRanges)
    console.log('============================')
    
    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody)
      })
      
      // Debug: Log the raw response
      console.log('=== GEMINI RESPONSE DEBUG ===')
      console.log('Response Status:', response.status)
      console.log('Response Headers:', Object.fromEntries(response.headers.entries()))
      
      let data = await response.json()
      console.log('Raw Response Data:', data)
      console.log('Response Data Type:', typeof data)
      console.log('Response Data Keys:', data && typeof data === 'object' ? Object.keys(data) : 'N/A')
      console.log('============================')
      // Robustly parse Gemini response: handle both JSON and plain text, including markdown-wrapped JSON
      let answer = ''
      let references = []
      
      // Handle new batching format - display each batch separately
      if (data && data.batches && Array.isArray(data.batches)) {
        console.log('[Gemini Debug] Processing batched response:', data.batches.length, 'batches')
        
        // Combine all batches into one message while maintaining order
        const allAnswers = []
        const allReferences = []
        
        data.batches.forEach((batch, index) => {
          console.log(`[Gemini Debug] Processing batch ${index + 1}:`, batch)
          
          if (batch.response && batch.response.answer) {
            // Add batch answer with page range header
            let batchContent = `**Pages ${batch.pages}:**\n\n${batch.response.answer}`
            
                    // Add references for this batch if they exist
        if (batch.response && batch.response.references && Array.isArray(batch.response.references) && batch.response.references.length > 0) {
          batchContent += '\n\n**References:**\n'
          batch.response.references.forEach((ref, refIndex) => {
            batchContent += `- PDF page ${ref.page}: "${ref.quote}"\n`
          })
        }
            
            allAnswers.push(batchContent)
          }
        })
        
        // Create single message with all batches
        answer = allAnswers.join('\n\n---\n\n')
        references = allReferences // Use the combined references from all batches
        
        // Save the combined message to database
        await saveChatMessage('assistant', answer, references, currentPageRange.length > 0 ? [currentPageRange[0], currentPageRange[currentPageRange.length - 1]] : [1, numPages])
      } else {
        // --- BEGIN ENHANCED GEMINI RESPONSE PARSING WITH DEBUG LOGGING ---
        console.log('[Gemini Debug] Raw data:', data)
        if (typeof data === 'string') {
          let text = data.trim()
          console.log('[Gemini Debug] As string, before code block removal:', text)
          // Remove markdown code block if present (handles ```json and ```)
          text = text.replace(/^```json[\s\n]*/i, '').replace(/^```[\s\n]*/i, '').replace(/```\s*$/i, '').trim()
          console.log('[Gemini Debug] After code block removal:', text)
          // If it looks like JSON, try to parse
          if (text.startsWith('{')) {
            try {
              data = JSON.parse(text)
              console.log('[Gemini Debug] Parsed JSON:', data)
            } catch (err) {
              console.log('[Gemini Debug] JSON parse error, using fallback string:', err)
              answer = text // fallback: just use the text
            }
          } else {
            console.log('[Gemini Debug] Not JSON, using as answer')
            answer = text
          }
        }
        // If data is an object with a single key and that key's value is an object, use that value
        if (typeof data === 'object' && data !== null && Object.keys(data).length === 1) {
          const val = Object.values(data)[0]
          if (typeof val === 'object') data = val
        }
        // Extract answer and references
        if (typeof data === 'object' && data !== null) {
          if (typeof data.answer === 'string') {
            console.log('[Gemini Debug] Using data.answer')
            answer = data.answer
          } else if (typeof data.response === 'string') {
            console.log('[Gemini Debug] Using data.response')
            answer = data.response
          } else {
            // fallback: try to find a string value in the object
            const firstString = Object.values(data).find(v => typeof v === 'string')
            console.log('[Gemini Debug] Fallback: using first string value in object:', firstString)
            answer = firstString || ''
          }
          if (Array.isArray(data.references)) {
            console.log('[Gemini Debug] Found references array:', data.references)
            references = data.references
            // Debug each reference structure
            references.forEach((ref, index) => {
              console.log(`[Gemini Debug] Reference ${index}:`, {
                page: ref.page,
                quote: ref.quote
              });
            });
          }
          // Fallback: try to extract references from answer text if not present
          if (references.length === 0 && typeof answer === 'string') {
            // Look for [page X: 'quoted phrase'] or similar patterns
            const refRegex = /\[page ([^\]:]+): '([^']+)'\]/g
            let match
            while ((match = refRegex.exec(answer)) !== null) {
              references.push({ page: match[1], quote: match[2] })
            }
            // Optionally, remove these reference tags from the answer text
            answer = answer.replace(refRegex, '').trim()
            if (references.length > 0) {
              console.log('[Gemini Debug] Extracted references from answer text:', references)
            }
          }
        }
        // Remove any remaining code block formatting from the answer
        if (typeof answer === 'string') {
          const cleaned = answer.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
          if (cleaned !== answer) {
            console.log('[Gemini Debug] Cleaned code block from answer')
          }
          answer = cleaned
        }
        console.log('[Gemini Debug] Final answer:', answer)
        console.log('[Gemini Debug] Final references:', references)
        // --- END ENHANCED GEMINI RESPONSE PARSING WITH DEBUG LOGGING ---
      }
      
      // No mapping needed - use references directly as they contain the correct PDF page numbers
      console.log('[Reference Debug] Using references directly (no mapping needed):', references);
      
      // Validate that references are within the expected page range
      const expectedStart = currentPageRange.length > 0 ? currentPageRange[0] : 1;
      const expectedEnd = currentPageRange.length > 0 ? currentPageRange[currentPageRange.length - 1] : numPages;
      console.log('[Reference Debug] Page Range Validation:');
      console.log(`  Expected range: ${expectedStart} - ${expectedEnd}`);
      references.forEach((ref, index) => {
        const isInRange = ref.page >= expectedStart && ref.page <= expectedEnd;
        console.log(`  Reference ${index}: page ${ref.page} - ${isInRange ? 'IN RANGE' : 'OUT OF RANGE'}`);
      });
      
      // Function to format page ranges for display
      const formatPageRanges = (pageArray) => {
        if (!pageArray || pageArray.length === 0) return [1, numPages];
        
        const ranges = [];
        let start = pageArray[0];
        let end = pageArray[0];
        
        for (let i = 1; i < pageArray.length; i++) {
          if (pageArray[i] === end + 1) {
            // Consecutive page, extend range
            end = pageArray[i];
          } else {
            // Gap found, save current range and start new one
            ranges.push([start, end]);
            start = pageArray[i];
            end = pageArray[i];
          }
        }
        // Add the last range
        ranges.push([start, end]);
        
        return ranges;
      };
      
      const assistantMessage = {
        role: 'assistant',
        content: answer,
        references: references,
        pageRange: formatPageRanges(currentPageRange)
      }
      
      // Debug: Log the final message details
      console.log('[Message Debug] Final assistant message:', {
        contentLength: answer.length,
        referencesCount: references.length,
        pageRange: assistantMessage.pageRange,
        references: references.map(ref => ({ page: ref.page, quote: ref.quote.substring(0, 50) + '...' }))
      });
      
      setChatMessages(prev => [...prev, assistantMessage])
      setHighlightRefs(references.map(ref => ({ 
        ...ref, 
        page: ref.page 
      })) || [])
      setLastPageRange(pageRange)
      
      // Update last used page range for inheritance
      setLastUsedPageRange(currentPageRange.length > 0 ? [currentPageRange[0], currentPageRange[currentPageRange.length - 1]] : [1, numPages])
      
      // Save assistant message to database
      await saveChatMessage('assistant', answer, references, currentPageRange.length > 0 ? [currentPageRange[0], currentPageRange[currentPageRange.length - 1]] : [1, numPages])
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error processing your message.' }])
    } finally {
      setLoading(false)
    }
  }

  // Add clear chat function
  async function clearChat() {
    if (window.confirm('Are you sure you want to clear the chat history? This action cannot be undone.')) {
      try {
        console.log('[Clear Chat] Starting chat clear...');
        
        // Call backend to clear chat messages from database
        const response = await fetch('/api/chat/clear', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('[Clear Chat] Backend response:', result);
        
        // Clear UI state
        setChatMessages([]);
        setHighlightRefs([]);
        setCurrentPage(null);
        setHighlightedQuote(null);
        setHighlightedFragmentIndices({});
        setMatchQuality({});
        setInputMessage('');
        setError(null);
        
        // Clean up blob URL if exists
        if (currentBlobUrl) {
          cleanupBlobUrl();
          setCurrentBlobUrl(null);
        }
        
      // Reset page range to last used or full range
      if (lastUsedPageRange) {
          setPageRange(lastUsedPageRange);
          setPageRangeInput(`${lastUsedPageRange[0]}-${lastUsedPageRange[1]}`);
        setParsedPageRanges(lastUsedPageRange[0] === lastUsedPageRange[1] ? [lastUsedPageRange[0]] : 
                            Array.from({length: lastUsedPageRange[1] - lastUsedPageRange[0] + 1}, (_, i) => lastUsedPageRange[0] + i));
        }
        
        console.log('[Clear Chat] Chat cleared successfully');
        
      } catch (error) {
        console.error('[Clear Chat] Error clearing chat:', error);
        setError('Failed to clear chat. Please try again.');
        
        // Still clear UI state even if backend fails
        setChatMessages([]);
        setHighlightRefs([]);
        setCurrentPage(null);
        setHighlightedQuote(null);
        setHighlightedFragmentIndices({});
        setMatchQuality({});
        setInputMessage('');
      }
    }
  }

  // Add ref for chat messages container to enable scrolling
  const chatMessagesRef = useRef(null)

  // Function to scroll to bottom of chat
  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }

  // Scroll to bottom when chat messages change
  useEffect(() => {
    scrollToBottom()
  }, [chatMessages])

  // Add state for tracking blob URLs to clean up
  const [currentBlobUrl, setCurrentBlobUrl] = useState(null)

  // Cleanup function for blob URLs
  const cleanupBlobUrl = (url) => {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
      console.log('Cleaned up blob URL:', url)
    }
  }

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup blob URL when component unmounts
      if (currentBlobUrl) {
        cleanupBlobUrl(currentBlobUrl)
      }
    }
  }, [currentBlobUrl])

  // Enhanced reference click handler
  function handleReferenceClick(ref) {
    console.log('[Highlight] Reference clicked:', ref);
    
    // Clear previous highlighting status
    setHighlightingStatus({});
    
    // Always update state to trigger re-render and highlighting
    const pageIndex = ref.page;
    setCurrentPage(Number(pageIndex));
      setHighlightedQuote(ref.quote);
      setHighlightRefs([ref]);
    
    // Scroll to the page
    setTimeout(() => {
      if (pageRefs.current[Number(pageIndex) - 1]) {
        pageRefs.current[Number(pageIndex) - 1].scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        }
      }, 100);
      }

  // State-of-the-art fast fuzzy matching for real-time highlighting
  function highlightTextInPage(pageNum, quote) {
    console.log('[Highlight] Starting fast fuzzy matching for page', pageNum, 'quote:', quote);
    
    // Get the page text from the fragments
    const fragments = pageTextFragments.current[pageNum];
    
    if (!fragments || fragments.length === 0) {
      console.log('[Highlight] No fragments found for page', pageNum);
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { score: 0, strategy: 'none', confidence: 'low' } 
      }));
      setHighlightingStatus(prev => ({ ...prev, [pageNum]: 'failed' }));
      return;
    }

    // Fast normalization (preserve structure)
    const normalizeText = (text) => {
      return text
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
    };
    
    const normQuote = normalizeText(quote);
    console.log('[Highlight] Normalized quote:', normQuote);
    
    // Build the full page text
    let fullText = '';
    const fragmentPositions = [];
    
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      const fragmentText = fragment?.str || '';
      fragmentPositions.push(fullText.length);
      fullText += fragmentText;
      if (i < fragments.length - 1) fullText += ' ';
    }
    
    const normFullText = normalizeText(fullText);
    console.log('[Highlight] Full text length:', normFullText.length);
    
    // Fast fuzzy matching algorithms
    
    // 1. Rolling Hash for fast substring comparison (O(n))
    function rollingHash(text, start, length) {
      let hash = 0;
      const prime = 31;
      const mod = 1e9 + 7;
      
      for (let i = 0; i < length; i++) {
        hash = (hash * prime + text.charCodeAt(start + i)) % mod;
      }
      return hash;
    }
    
    // 2. Fast similarity using character frequency (O(n))
    function fastSimilarity(str1, str2) {
      if (str1.length === 0 || str2.length === 0) return 0;
      
      // Count character frequencies
      const freq1 = new Array(128).fill(0);
      const freq2 = new Array(128).fill(0);
      
      for (const char of str1) freq1[char.charCodeAt(0)]++;
      for (const char of str2) freq2[char.charCodeAt(0)]++;
      
      // Calculate intersection
      let intersection = 0;
      let union = 0;
      
      for (let i = 0; i < 128; i++) {
        const min = Math.min(freq1[i], freq2[i]);
        const max = Math.max(freq1[i], freq2[i]);
        intersection += min;
        union += max;
      }
      
      return union === 0 ? 0 : (intersection / union) * 100;
    }
    
    // 3. Boyer-Moore inspired fast substring search (O(n/m))
    function fastSubstringSearch(text, pattern, minSimilarity = 70) {
      const patternLength = pattern.length;
      const textLength = text.length;
      
      if (patternLength > textLength) return null;

    let bestMatch = null;
    let bestScore = 0;

      // Use sliding window with step size for performance
      const stepSize = Math.max(1, Math.floor(patternLength / 4));
      
      for (let i = 0; i <= textLength - patternLength; i += stepSize) {
        const substring = text.substring(i, i + patternLength);
        
        // Quick exact match check
        if (substring === pattern) {
          return {
            start: i,
            end: i + patternLength,
            score: 100,
            type: 'exact'
          };
        }
        
        // Fast similarity check
        const similarity = fastSimilarity(pattern, substring);
        if (similarity > bestScore && similarity >= minSimilarity) {
          bestScore = similarity;
          bestMatch = {
            start: i,
            end: i + patternLength,
            score: similarity,
            type: 'fast-similarity'
          };
        }
      }

    return bestMatch;
  }

    // 4. Fast word-based matching using hash sets (O(n))
    function fastWordMatching(text, pattern) {
      const textWords = text.split(/\s+/);
      const patternWords = pattern.split(/\s+/);
      
      if (patternWords.length === 0) return null;
      
      // Create hash set for fast lookup
      const textWordSet = new Set(textWords);
      const patternWordSet = new Set(patternWords);
      
      // Calculate word overlap
      let intersection = 0;
      for (const word of patternWordSet) {
        if (textWordSet.has(word)) intersection++;
      }
      
      const wordSimilarity = (intersection / patternWordSet.size) * 100;
      
      if (wordSimilarity > 60) {
        // Find the best consecutive word sequence
        let bestStart = 0;
        let bestScore = 0;
        
        for (let i = 0; i <= textWords.length - patternWords.length; i++) {
          let matches = 0;
          for (let j = 0; j < patternWords.length; j++) {
            if (textWords[i + j] === patternWords[j]) matches++;
          }
          
          const score = (matches / patternWords.length) * 100;
          if (score > bestScore) {
            bestScore = score;
            bestStart = i;
          }
        }
        
        if (bestScore > 50) {
          // Calculate precise text position
          let startPos = 0;
          for (let k = 0; k < bestStart; k++) {
            startPos += textWords[k].length + 1;
          }
          
          let endPos = startPos;
          for (let k = bestStart; k < bestStart + patternWords.length; k++) {
            endPos += textWords[k].length + 1;
          }
          
          return {
            start: startPos,
            end: endPos - 1,
            score: bestScore,
            type: 'fast-word'
          };
        }
      }
      
      return null;
    }
    
    // 5. Precise boundary refinement
    function refineBoundaries(text, match, pattern) {
      if (!match) return match;
      
      const { start, end, score, type } = match;
      const matchedText = text.substring(start, end);
      
      // For exact matches, boundaries are already precise
      if (type === 'exact') return match;
      
      // For fuzzy matches, try to find the most precise boundaries
      if (type === 'fast-similarity') {
        // Try to find the best substring within the matched region
        let bestSubStart = 0;
        let bestSubEnd = matchedText.length;
        let bestSimilarity = 0;
        
        // Try different substring lengths within the matched region
        for (let len = pattern.length; len >= Math.max(10, pattern.length * 0.7); len--) {
          for (let i = 0; i <= matchedText.length - len; i++) {
            const substring = matchedText.substring(i, i + len);
            const similarity = fastSimilarity(pattern, substring);
            
            if (similarity > bestSimilarity) {
              bestSimilarity = similarity;
              bestSubStart = i;
              bestSubEnd = i + len;
            }
          }
        }
        
        // Only refine if we found a better match
        if (bestSimilarity > score * 0.9) {
          return {
            start: start + bestSubStart,
            end: start + bestSubEnd,
            score: bestSimilarity,
            type: 'refined-similarity'
          };
        }
      }
      
      return match;
    }
    
    // 6. Main matching logic with performance optimization
    let bestMatch = null;
    
    // Strategy 1: Exact match (fastest)
    const exactIndex = normFullText.indexOf(normQuote);
    if (exactIndex !== -1) {
      console.log('[Highlight] Found exact match at position:', exactIndex);
      bestMatch = {
        start: exactIndex,
        end: exactIndex + normQuote.length,
        score: 100,
        type: 'exact'
      };
    } else {
      // Strategy 2: Fast substring search
      console.log('[Highlight] Trying fast substring search');
      bestMatch = fastSubstringSearch(normFullText, normQuote, 70);
      
      if (bestMatch) {
        console.log('[Highlight] Fast substring match found, score:', bestMatch.score);
        // Refine boundaries for more precision
        bestMatch = refineBoundaries(normFullText, bestMatch, normQuote);
      } else {
        // Strategy 3: Fast word-based matching
        console.log('[Highlight] Trying fast word matching');
        bestMatch = fastWordMatching(normFullText, normQuote);
        
        if (bestMatch) {
          console.log('[Highlight] Fast word match found, score:', bestMatch.score);
        }
      }
    }
    
    if (bestMatch) {
      console.log('[Highlight] Best match found:', bestMatch);
      
      // Find which fragments are covered by this match with precise boundaries
      const matchedFragments = new Set();
      
      for (let i = 0; i < fragments.length; i++) {
        const fragmentStart = fragmentPositions[i];
        const fragmentEnd = i < fragments.length - 1 ? fragmentPositions[i + 1] : fullText.length;
        
        // Check if this fragment overlaps with the match
        if (fragmentStart < bestMatch.end && fragmentEnd > bestMatch.start) {
          // Additional precision check: ensure the fragment actually contains part of the match
          const fragmentText = fragments[i]?.str || '';
          const normalizedFragmentText = normalizeText(fragmentText);
          
          // Check if this fragment contains any part of the matched text
          const matchStartInFragment = Math.max(0, bestMatch.start - fragmentStart);
          const matchEndInFragment = Math.min(fragmentText.length, bestMatch.end - fragmentStart);
          
          if (matchStartInFragment < matchEndInFragment) {
            // This fragment contains part of the match
            matchedFragments.add(i);
            console.log('[Highlight] Fragment', i, 'matched (contains match text)');
          } else {
            console.log('[Highlight] Fragment', i, 'skipped (no match content)');
          }
        }
      }
      
      console.log('[Highlight] Matched fragments:', Array.from(matchedFragments));
      
      setHighlightedFragmentIndices(prev => ({ 
        ...prev, 
        [pageNum]: matchedFragments 
      }));
      
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { 
          score: bestMatch.score, 
          strategy: bestMatch.type, 
          confidence: bestMatch.score > 90 ? 'high' : bestMatch.score > 75 ? 'medium' : 'low' 
        } 
      }));
      
      setHighlightingStatus(prev => ({ ...prev, [pageNum]: 'success' }));
      console.log('[Highlight] Highlighting successful with', matchedFragments.size, 'fragments');
      
    } else {
      console.log('[Highlight] No match found for quote:', normQuote);
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { score: 0, strategy: 'none', confidence: 'low' } 
      }));
      setHighlightingStatus(prev => ({ ...prev, [pageNum]: 'failed' }));
    }
  }

  // Fast retry highlighting with immediate fallback
  function retryHighlight(pageNum, quote, attempt = 1) {
    const maxAttempts = 2;
    const delay = 50; // Very short delay
    
    console.log(`[Highlight] Retry attempt ${attempt}/${maxAttempts} for page ${pageNum}`);
    setHighlightingStatus(prev => ({ ...prev, [pageNum]: 'retrying' }));
    
    setTimeout(() => {
      if (attempt >= maxAttempts) {
        console.log('[Highlight] Max retry attempts reached');
        setHighlightingStatus(prev => ({ ...prev, [pageNum]: 'failed' }));
        return;
      }
      
      if (pageTextFragments.current[pageNum] && pageTextFragments.current[pageNum].length > 0) {
        try {
    highlightTextInPage(pageNum, quote);
        } catch (error) {
          console.warn(`[Highlight] Retry ${attempt} failed:`, error);
          retryHighlight(pageNum, quote, attempt + 1);
        }
    } else {
        retryHighlight(pageNum, quote, attempt + 1);
      }
    }, delay);
  }

  return (
    <div id="root" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      
      {/* Authentication Check */}
      {!isAuthenticated ? (
        <Auth onLogin={handleLogin} />
      ) : (
        <>
          {/* Combined header with user info, logout, and navigation */}
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
              <div style={{ fontSize: '12px', color: '#6c757d' }}>
                Welcome, {user?.username || 'User'}
              </div>
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

            <button
              onClick={handleLogout}
              className="btn btn-outline-secondary btn-sm"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            >
              Logout
            </button>
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
              <p style={{ color: '#4a5568', fontSize: '16px' }}>
                {showExistingDocuments ? 'Select a document to continue your session' : 'Your intelligent PDF analysis companion'}
              </p>
            </div>

            {showExistingDocuments && (
              <div className="mb-3">
                <button
                  onClick={handleBackToMain}
                  className="btn btn-outline-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <i className="bi bi-arrow-left"></i>
                  Back to Options
                </button>
              </div>
            )}

            {!showExistingDocuments && (
            <div className="row g-4">
              {/* Upload New Document */}
              <div className="col-md-6">
                <div className="card h-100" style={{
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }} 
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#3182ce'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                onClick={handleNewDocument}>
                  <div className="card-body text-center p-4">
                    <div style={{ fontSize: '48px', color: '#3182ce', marginBottom: '16px' }}>
                      📄
                    </div>
                    <h5 className="card-title" style={{ color: '#2d3748', marginBottom: '12px' }}>
                      Upload New Document
                    </h5>
                    <p className="card-text" style={{ color: '#718096', fontSize: '14px' }}>
                      Start a new analysis session with a fresh PDF document
                    </p>
                  </div>
                </div>
              </div>

              {/* Open Existing Session */}
              <div className="col-md-6">
                <div className="card h-100" style={{
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#38a169'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                onClick={handleOpenExistingSession}>
                  <div className="card-body text-center p-4">
                    <div style={{ fontSize: '48px', color: '#38a169', marginBottom: '16px' }}>
                      📚
                    </div>
                    <h5 className="card-title" style={{ color: '#2d3748', marginBottom: '12px' }}>
                      Open Existing Session
                    </h5>
                    <p className="card-text" style={{ color: '#718096', fontSize: '14px' }}>
                      Continue working with previously uploaded documents
                    </p>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Existing Documents List */}
            {(showExistingDocuments || existingDocuments.length > 0) && (
              <div className="mt-4">
                <h6 style={{ color: '#2d3748', marginBottom: '16px' }}>
                  {showExistingDocuments ? 'Available Documents' : 'Recent Documents'}
                </h6>
                <div>
                  {loadingDocuments ? (
                    <div className="text-center py-3">
                      <div className="spinner-border spinner-border-sm" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                      <span className="ms-2">Loading documents...</span>
                    </div>
                  ) : existingDocuments.length > 0 ? (
                    existingDocuments.map((doc) => (
                      <div key={doc.document_id} className="card mb-2" style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f7fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}>
                        <div className="card-body p-3">
                          {editingDocument === doc.document_id ? (
                            // Edit mode
                            <div>
                              <input
                                type="text"
                                value={newDocumentName}
                                onChange={(e) => setNewDocumentName(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleRenameDocument(doc.document_id, newDocumentName)}
                                className="form-control form-control-sm mb-2"
                                style={{ fontSize: '14px' }}
                                autoFocus
                              />
                              <div className="d-flex gap-2">
                                <button
                                  onClick={() => handleRenameDocument(doc.document_id, newDocumentName)}
                                  className="btn btn-primary btn-sm"
                                  style={{ fontSize: '12px' }}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="btn btn-outline-secondary btn-sm"
                                  style={{ fontSize: '12px' }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            // View mode
                            <div className="d-flex justify-content-between align-items-center">
                              <div 
                                style={{ flex: 1, cursor: 'pointer' }}
                                onClick={() => loadExistingDocument(doc.document_id)}
                              >
                                <h6 className="card-title mb-1" style={{ color: '#2d3748', fontSize: '14px' }}>
                                  {doc.original_filename || doc.filename}
                                </h6>
                                <p className="card-text mb-0" style={{ color: '#718096', fontSize: '12px' }}>
                                  {doc.num_pages} pages • Uploaded {new Date(doc.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <div className="d-flex align-items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEditDocument(doc)
                                  }}
                                  className="btn btn-outline-primary btn-sm"
                                  style={{ fontSize: '10px', padding: '2px 6px' }}
                                  title="Rename"
                                >
                                  <i className="bi bi-pencil"></i>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDeletingDocument(doc.document_id)
                                  }}
                                  className="btn btn-outline-danger btn-sm"
                                  style={{ fontSize: '10px', padding: '2px 6px' }}
                                  title="Delete"
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                                <div style={{ color: '#a0aec0', fontSize: '20px', cursor: 'pointer' }}
                                     onClick={() => loadExistingDocument(doc.document_id)}>
                                  →
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4">
                      <div style={{ fontSize: '48px', color: '#cbd5e0', marginBottom: '16px' }}>
                        📄
                      </div>
                      <p style={{ color: '#718096', fontSize: '14px' }}>
                        {showExistingDocuments ? 'No documents found. Upload your first document to get started.' : 'No recent documents'}
                      </p>
                      {showExistingDocuments && (
                        <button
                          onClick={handleNewDocument}
                          className="btn btn-primary btn-sm mt-2"
                        >
                          Upload New Document
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Close Button */}
            <div className="text-center mt-4">
              <button
                onClick={() => {
                  setShowLandingModal(false)
                  setShowExistingDocuments(false)
                }}
                className="btn btn-outline-secondary btn-sm"
                style={{ minWidth: '100px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="App d-flex flex-column" style={{ width: '100%', height: 'calc(100vh - 38px)', overflow: 'hidden' }}>
        {/* Status indicators */}
        {loading && <div className="p-2 bg-info text-white text-center">Processing...</div>}
        {error && (
          <div className="alert alert-danger mb-0 py-2 d-flex justify-content-between align-items-center">
            <span>{error}</span>
            {(error.includes('Failed to load PDF') || error.includes('Error loading document')) && (
              <button className="btn btn-sm btn-outline-danger" onClick={retryLoadDocument}>
                <i className="bi bi-arrow-clockwise"></i> Retry
              </button>
            )}
          </div>
        )}
        {file && !error && (
          <div className="main-content" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* PDF Viewer */}
            <div className="pdf-container" ref={pdfViewerRef}>
              <Document 
                file={file} 
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading PDF...</span>
                    </div>
                  </div>
                }
                error={
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: '#dc3545' }}>
                    <div>
                      <i className="bi bi-exclamation-triangle"></i>
                      <p>Failed to load PDF</p>
                      <button className="btn btn-sm btn-outline-primary" onClick={retryLoadDocument}>
                        Retry
                      </button>
                    </div>
                  </div>
                }
              >
                  {Array.from(new Array(numPages), (el, index) => {
                    const pageNum = index + 1;
                  const inContext = pageNum >= pageRange[0] && pageNum <= pageRange[1];
                    return (
                    <div key={index} style={{ position: 'relative', marginBottom: 8 }} ref={el => pageRefs.current[index] = el}>
                      {/* Page number label */}
                      <div style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 11,
                        zIndex: 10
                      }}>
                        Page {pageNum}
                      </div>
                      {/* Context window indicator */}
                      {inContext && (
                        <div style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          background: '#007bff',
                          color: '#fff',
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontSize: 10,
                          zIndex: 10
                        }}>
                          In Chat Context
                        </div>
                      )}
                      {/* Match quality indicator */}
                      {matchQuality[pageNum] && matchQuality[pageNum].score > 0 && (
                        <div style={{
                          position: 'absolute',
                          bottom: 6,
                          left: 6,
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
                        style={{
                          border: inContext ? '2px solid #007bff' : '2px solid transparent',
                          borderRadius: 6
                        }}
                        customTextRenderer={({ str, itemIndex, transform, width, height, dir }) => {
                          // Collect fragments for the current page
                          if (!pageTextFragments.current[pageNum]) {
                            pageTextFragments.current[pageNum] = [];
                          }
                          
                          pageTextFragments.current[pageNum][itemIndex] = { str, itemIndex };
                          
                          // Check if this fragment should be highlighted
                          const isHighlighted = currentPage === pageNum && 
                                               highlightedFragmentIndices[pageNum] && 
                                               highlightedFragmentIndices[pageNum].has(itemIndex);
                          
                          // Debug logging
                          if (currentPage === pageNum && highlightedFragmentIndices[pageNum]) {
                            console.log(`[Highlight Debug] Fragment ${itemIndex} on page ${pageNum}:`, {
                              str,
                              isHighlighted,
                              currentPage,
                              pageNum,
                              hasFragment: highlightedFragmentIndices[pageNum].has(itemIndex),
                              fragmentSet: Array.from(highlightedFragmentIndices[pageNum])
                            });
                          }
                          
                          // Return highlighted text if needed
                          if (isHighlighted) {
                            console.log('[Highlight] Rendering highlight for fragment', itemIndex, 'on page', pageNum, ':', str);
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
                            console.log('[Highlight] Rendering page', pageNum, 'with quote:', highlightedQuote);
                            // Use retry mechanism for reliability
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
            </div>
            {/* Chat Panel */}
            <div className="right-panel" style={{ width: '50%', height: '100%', overflow: 'hidden' }}>
              <div className="chat-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', borderBottom: '1px solid #dee2e6', flexShrink: 0 }}>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>Chat with Gemini</h3>
                  <button 
                    onClick={clearChat}
                    className="btn btn-outline-danger btn-sm"
                    style={{ fontSize: '11px', padding: '3px 6px' }}
                    title="Clear chat history"
                  >
                    <i className="bi bi-trash"></i> Clear Chat
                  </button>
                </div>
                <div className="chat-messages" ref={chatMessagesRef} style={{ flex: 1, overflowY: 'auto', padding: 15, minHeight: 0 }}>
                  <>
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`chat-message ${msg.role}`}> 
                        <div className="message-content">
                          {msg.role === 'assistant' && msg.pageRange && !msg.batch && (
                            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                              Chat context: PDF pages {Array.isArray(msg.pageRange[0]) 
                                ? msg.pageRange.map(range => 
                                    range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`
                                  ).join('; ')
                                : `${msg.pageRange[0]} - ${msg.pageRange[1]}`
                              }
                            </div>
                          )}
                          {/* Render markdown content */}
                          <ReactMarkdown 
                            components={{
                              // Style different markdown elements
                              h1: ({node, ...props}) => <h1 style={{fontSize: '1.2em', fontWeight: 'bold', marginBottom: '0.4em', color: '#2c3e50'}} {...props} />,
                              h2: ({node, ...props}) => <h2 style={{fontSize: '1.1em', fontWeight: 'bold', marginBottom: '0.3em', color: '#34495e'}} {...props} />,
                              h3: ({node, ...props}) => <h3 style={{fontSize: '1em', fontWeight: 'bold', marginBottom: '0.25em', color: '#34495e'}} {...props} />,
                              p: ({node, ...props}) => <p style={{marginBottom: '0.6em', lineHeight: '1.5', fontSize: '12px'}} {...props} />,
                              ul: ({node, ...props}) => <ul style={{marginBottom: '0.6em', paddingLeft: '1.2em', fontSize: '12px'}} {...props} />,
                              ol: ({node, ...props}) => <ol style={{marginBottom: '0.6em', paddingLeft: '1.2em', fontSize: '12px'}} {...props} />,
                              strong: ({node, ...props}) => <strong style={{fontWeight: 'bold', color: '#2c3e50'}} {...props} />,
                              em: ({node, ...props}) => <em style={{fontStyle: 'italic', color: '#7f8c8d'}} {...props} />,
                              code: ({node, ...props}) => <code style={{backgroundColor: '#f8f9fa', padding: '0.15em 0.3em', borderRadius: '2px', fontSize: '11px', fontFamily: 'monospace'}} {...props} />,
                              blockquote: ({node, ...props}) => <blockquote style={{borderLeft: '3px solid #3498db', paddingLeft: '0.8em', marginLeft: '0', fontStyle: 'italic', color: '#7f8c8d', fontSize: '12px'}} {...props} />,
                              // Custom component for reference links
                              li: ({node, children, ...props}) => {
                                // Get the text content
                                let text = '';
                                if (typeof children === 'string') {
                                  text = children;
                                } else if (children?.props?.children) {
                                  text = children.props.children;
                                } else if (Array.isArray(children)) {
                                  text = children.map(child => 
                                    typeof child === 'string' ? child : child?.props?.children || ''
                                  ).join('');
                                }
                                
                                // Check if this is a reference line
                                if (text && text.includes('PDF page') && text.includes('"')) {
                                  // Extract page number and quote from the reference text
                                  const pageMatch = text.match(/PDF page (\d+): "([^"]+)"/);
                                  if (pageMatch) {
                                    const page = parseInt(pageMatch[1]);
                                    const quote = pageMatch[2];
                                    return (
                                      <li 
                                        {...props} 
                                        style={{ marginBottom: '0.3em', cursor: 'pointer', color: '#007bff', listStyle: 'disc' }}
                                        onClick={() => handleReferenceClick({ page, quote })}
                                      >
                                        {children}
                                      </li>
                                    );
                                  }
                                }
                                return <li {...props} style={{ marginBottom: '0.25em', fontSize: '12px' }}>{children}</li>;
                              }
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                          
                        </div>
                      </div>
                    ))}
                    
                    {loading && (
                      <div className="chat-message assistant">
                        <div className="message-content" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="spinner-border spinner-border-sm" role="status">
                            <span className="visually-hidden">Loading...</span>
                          </div>
                          <span>Processing your question...</span>
                        </div>
                      </div>
                    )}
                  </>
                </div>
                <div className="chat-input" style={{ padding: 12, background: '#fff', borderTop: '1px solid #dee2e6', flexShrink: 0 }}>
                  <div className="chat-input-container" style={{ 
                    border: '2px solid #e9ecef', 
                    borderRadius: '6px', 
                    overflow: 'hidden',
                    backgroundColor: '#f8f9fa',
                    width: '100%'
                  }}>
                    {/* First Line - Context Page Range */}
                    {numPages && (
                      <div className="context-line" style={{ 
                        padding: '6px 9px', 
                        borderBottom: '1px solid #e9ecef',
                        backgroundColor: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px'
                      }}>
                        <span style={{ color: '#6c757d', fontWeight: '500', minWidth: '60px' }}>Context pages:</span>
                        <div className="d-flex align-items-center gap-1">
                          <input
                            type="text"
                            value={pageRangeInput}
                            onChange={e => handlePageRangeChange(e.target.value)}
                            placeholder="e.g., 5; 7; 11-13; [1-3;5-7]"
                            style={{ 
                              width: '300px', 
                              padding: '3px 5px', 
                              border: '1px solid #ced4da', 
                              borderRadius: '3px',
                              fontSize: '11px',
                              textAlign: 'left',
                              backgroundColor: '#fff'
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
                      gap: '6px'
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
                        Send
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
        </>
      )}
    </div>
  )
}

export default App


