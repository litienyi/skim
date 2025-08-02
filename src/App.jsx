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
  const [sessionToken, setSessionToken] = useState(localStorage.getItem('sessionToken'))
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
  
  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages)
    setPageRange([1, numPages])
    setPageRangeInput('')
    setParsedPageRanges([])
    // Initialize last used page range to full range
    setLastUsedPageRange([1, numPages])
  }

  // Load existing documents from backend
  async function loadExistingDocuments() {
    setLoadingDocuments(true)
    try {
      const response = await fetch(`${API_URL}/documents`)
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
    setLoading(true)
    setError(null)
    try {
      console.log('Loading document with ID:', documentId)
      
      const response = await fetch(`${API_URL}/documents/${documentId}`)
      if (!response.ok) throw new Error('Failed to load document')
      const documentData = await response.json()
      console.log('Document data loaded:', documentData)
      
      // Create a file object from the document data
      console.log('Fetching PDF file:', `${API_URL}/pdf/${documentData.filename}`)
      
      // Try a different approach - create a direct URL to the PDF
      const pdfUrl = `${API_URL}/pdf/${documentData.filename}`
      console.log('Using direct PDF URL:', pdfUrl)
      
      // For react-pdf, we can pass the URL directly
      setPdfInfo(documentData)
      setFile(pdfUrl)
      setNumPages(documentData.num_pages)
      setPageRange([1, documentData.num_pages])
      setPageRangeInput('')
      setParsedPageRanges([])
      setShowLandingModal(false)
      
      // Initialize chat session and load existing chat messages
      await loadChatHistory(documentData.document_id)
    } catch (e) {
      setError('Error loading document')
      console.error('Error loading document:', e)
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
      const response = await fetch(`${API_URL}/chat_sessions?document_id=${documentId}`)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId })
      })
      
      if (createResponse.ok) {
        const newSession = await createResponse.json()
        setCurrentChatSessionId(newSession.id)
        return newSession.id
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
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`${API_URL}/chat_messages?chat_session_id=${sessionId}`)
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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
      const uploadResponse = await fetch(`${API_URL}/upload`, {
        method: 'POST',
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
        headers: { 'Content-Type': 'application/json' },
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
      setChatMessages([])
      setHighlightRefs([])
      setCurrentPage(null)
      setHighlightedQuote(null)
      setHighlightedFragmentIndices({})
      setMatchQuality({})
      // Reset page range to last used or full range
      if (lastUsedPageRange) {
        setPageRange(lastUsedPageRange)
        setPageRangeInput(`${lastUsedPageRange[0]}-${lastUsedPageRange[1]}`)
        setParsedPageRanges(lastUsedPageRange[0] === lastUsedPageRange[1] ? [lastUsedPageRange[0]] : 
                          Array.from({length: lastUsedPageRange[1] - lastUsedPageRange[0] + 1}, (_, i) => lastUsedPageRange[0] + i))
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

  // Enhanced reference click handler
  function handleReferenceClick(ref) {
    console.log('[Highlight DEBUG] handleReferenceClick called with', ref);
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

  // Enhanced fuzzy matching function with word-to-fragment mapping
  function findBestMatchInText(quote, pageText) { // pageText is now expected to be normalized
    if (!quote || !pageText) {
      return null;
    }

    const normQuote = normalize(quote); // Normalize quote again just in case
    const normPageText = pageText; // pageText is already normalized

    console.log('[Match Debug] Looking for quote:', normQuote);
    console.log('[Match Debug] In page text (first 200 chars):', normPageText.substring(0, 200));

    // If exact match exists, return it
    const exactIndex = normPageText.indexOf(normQuote);
    if (exactIndex !== -1) {
      console.log('[Match Debug] Found exact match at index:', exactIndex);
      return {
        start: exactIndex,
        end: exactIndex + normQuote.length,
        score: 100,
        type: 'exact',
        matchedText: normQuote
      };
    }

    // Sliding window approach for fuzzy matching using character-based windows
    const quoteLength = normQuote.length;
    const minWindow = Math.max(10, quoteLength - 20); // Minimum 10 chars, or quote length - 20
    const maxWindow = Math.min(normPageText.length, quoteLength + 20); // Maximum quote length + 20

    console.log('[Match Debug] Quote length:', quoteLength);
    console.log('[Match Debug] Window range:', minWindow, 'to', maxWindow);

    let bestMatch = null;
    let bestScore = 0;

    // Try different window sizes around the quote length
    for (let windowSize = minWindow; windowSize <= maxWindow; windowSize++) {
      for (let i = 0; i <= normPageText.length - windowSize; i++) {
        const window = normPageText.substring(i, i + windowSize);
        
        // Use fuzzball's ratio for similarity
        const score = fuzz.ratio(window, normQuote);
        
        if (score > bestScore && score > 70) { // Minimum threshold
          bestScore = score;
          bestMatch = {
            start: i,
            end: i + windowSize,
            score: score,
            type: 'fuzzy',
            matchedText: window
          };
          console.log('[Match Debug] New best match:', { score, window, start: i, end: i + windowSize });
        }
      }
    }

    if (bestMatch) {
      console.log('[Match Debug] Final best match:', bestMatch);
    } else {
      console.log('[Match Debug] No match found');
    }

    return bestMatch;
  }

  // Enhanced main highlighting function
  function highlightTextInPage(pageNum, quote) {
    console.log('[Highlight DEBUG] highlightTextInPage called with', { pageNum, quote });
    setLastHighlightCall({ pageNum, quote, ts: Date.now() });
    
    // Get the page text from the fragments
    const fragments = pageTextFragments.current[pageNum];
    
    if (!fragments || fragments.length === 0) {
      console.warn('[Highlight Debug] No fragments found for page', pageNum);
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { score: 0, strategy: 'none', confidence: 'low' } 
      }));
      setHighlightWarning({
        pageNum,
        quote,
        joined: '(No fragments found)'
      });
      return;
    }

    // Build normalized page text and create character-to-fragment mapping
    let normalizedPageText = '';
    const normalizedCharToFragmentIndexMap = [];
    
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      const originalFragmentStr = fragment?.str || '';
      const normalizedFragmentStr = normalize(originalFragmentStr);
      
      // Add the normalized fragment text
      normalizedPageText += normalizedFragmentStr;
      
      // Map each character in this fragment to this fragment index
      for (let k = 0; k < normalizedFragmentStr.length; k++) {
        normalizedCharToFragmentIndexMap.push(i);
      }
      
      // Add space between fragments (except for the last one)
      if (i < fragments.length - 1) {
        normalizedPageText += ' ';
        normalizedCharToFragmentIndexMap.push(i); // Map the space to the current fragment
      }
    }
    
    normalizedPageText = normalizedPageText.trim();
    
    console.log('[Highlight] Normalized page text length:', normalizedPageText.length);
    console.log('[Highlight] Character-to-fragment map length:', normalizedCharToFragmentIndexMap.length);
    console.log('[Highlight] Normalized page text preview:', normalizedPageText.substring(0, 200) + '...');

    // Find the best match in the normalized text
    const match = findBestMatchInText(quote, normalizedPageText);
    
    if (match) {
      console.log('[Highlight] Found match:', match);
      console.log('[Highlight] Match character range:', match.start, 'to', match.end);
      
      // Use the character-to-fragment mapping to find the correct fragments
      const matchedFragments = new Set();
      
      for (let i = match.start; i < match.end; i++) {
        const fragmentIndex = normalizedCharToFragmentIndexMap[i];
        if (fragmentIndex !== undefined && fragmentIndex !== -1) {
          matchedFragments.add(fragmentIndex);
          console.log('[Highlight] Character', i, 'maps to fragment', fragmentIndex, ':', fragments[fragmentIndex]?.str);
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
          score: match.score, 
          strategy: match.type, 
          confidence: match.score > 90 ? 'high' : match.score > 75 ? 'medium' : 'low' 
        } 
      }));
      
      setHighlightWarning(null);
      console.log('[Highlight] Best match found:', {
        score: match.score,
        type: match.type,
        matchedText: match.matchedText,
        fragments: Array.from(matchedFragments)
      });
      
    } else {
      // No match found
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { score: 0, strategy: 'none', confidence: 'low' } 
      }));
      setHighlightWarning({
        pageNum,
        quote,
        joined: normalizedPageText.substring(0, 500) + '...'
      });
      console.log('[Highlight] No match found for quote:', quote);
    }
  }

  // Helper function to cluster adjacent fragments
  function clusterAdjacentFragments(fragmentIndices, maxGap = 2) {
    if (fragmentIndices.length === 0) return [];
    
    // Sort indices
    const sortedIndices = [...fragmentIndices].sort((a, b) => a - b);
    const clusters = [];
    let currentCluster = [sortedIndices[0]];
    
    for (let i = 1; i < sortedIndices.length; i++) {
      const currentIndex = sortedIndices[i];
      const lastIndex = currentCluster[currentCluster.length - 1];
      
      // If fragments are adjacent or close (within maxGap), add to current cluster
      if (currentIndex - lastIndex <= maxGap) {
        currentCluster.push(currentIndex);
      } else {
        // Start a new cluster
        clusters.push([...currentCluster]);
        currentCluster = [currentIndex];
      }
    }
    
    // Add the last cluster
    clusters.push(currentCluster);
    
    return clusters;
  }

  // Legacy function for backward compatibility
  function runFuzzyHighlight(pageNum, quote) {
    highlightTextInPage(pageNum, quote);
  }

  // Fallback highlighting function that works directly with fragments
  function runFuzzyHighlightFallback(pageNum, quote) {
    console.log('[Highlight DEBUG] runFuzzyHighlightFallback called with', { pageNum, quote });
    setLastHighlightCall({ pageNum, quote, ts: Date.now() });
    const fragments = pageTextFragments.current[pageNum]
    if (!fragments || fragments.length === 0) {
      console.warn('[Highlight Debug] No fragments found for page', pageNum)
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }))
      setHighlightWarning({
        pageNum,
        quote,
        joined: '(No fragments found)'
      })
      return
    }
    // Super-aggressive normalization: remove all punctuation, curly quotes, hyphens, collapse whitespace, lowercase
    const normalize = str => str
      .replace(/[""'':,;\-]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
    const normQuote = normalize(quote);
    const quoteWordCount = normQuote.split(' ').length;
    // Normalize all fragments
    const normFragments = fragments.map(f => normalize(f.str));
    // Sliding window over fragments, always pick the best fuzzy match
    let bestScore = -1;
    let bestIndices = null;
    let bestWindow = '';
    
    // Try different window sizes around the quote length
    const minWindow = Math.max(quoteWordCount - 2, 3);
    const maxWindow = Math.min(normFragments.length, quoteWordCount + 2);
    
    for (let windowSize = minWindow; windowSize <= maxWindow; windowSize++) {
      for (let i = 0; i <= normFragments.length - windowSize; i++) {
        const window = normFragments.slice(i, i + windowSize).join(' ');
        const score = fuzz.ratio(window, normQuote);
        if (score > bestScore && score > 70) { // Minimum threshold to reduce noise
          bestScore = score;
          bestIndices = Array.from({length: windowSize}, (_, k) => i + k);
          bestWindow = window;
        }
      }
    }
    if (bestIndices && bestScore > 0) {
      // Use clustering to group adjacent fragments and reduce noise
      const clusters = clusterAdjacentFragments(bestIndices);
      console.log('[Highlight Debug] Clusters found:', clusters);
      
      // Use the largest cluster (most likely to be the actual quote)
      const largestCluster = clusters.reduce((largest, cluster) => 
        cluster.length > largest.length ? cluster : largest, []);
      
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set(largestCluster) }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { 
          score: bestScore, 
          strategy: 'fragment-fuzzy-clustered', 
          confidence: bestScore > 90 ? 'high' : bestScore > 75 ? 'medium' : 'low' 
        } 
      }));
      setHighlightWarning(null);
      console.log('[Highlight Window] Best clustered match at fragments', largestCluster, 'score:', bestScore, 'window:', bestWindow, 'quote:', normQuote);
    } else {
      setHighlightedFragmentIndices(prev => ({ ...prev, [pageNum]: new Set() }));
      setMatchQuality(prev => ({ 
        ...prev, 
        [pageNum]: { score: 0, strategy: 'none', confidence: 'low' } 
      }));
      setHighlightWarning({
        pageNum,
        quote,
        joined: normFragments.join(' ')
      });
      console.log('[Highlight Window] No match found for quote:', normQuote);
    }
  }

  // Add effect to reset textLayerReady when currentPage changes, but only if the page actually changes
  const prevPageRef = useRef();
  useEffect(() => {
    if (currentPage && prevPageRef.current !== currentPage) {
      setTextLayerReady(prev => ({ ...prev, [currentPage]: false }));
      prevPageRef.current = currentPage;
    }
  }, [currentPage]);

  return (
    <div id="root" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>


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

      {/* Delete Confirmation Modal */}
      {deletingDocument && (
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
          zIndex: 1001
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
          }}>
            <div className="text-center mb-4">
              <div style={{ fontSize: '48px', color: '#dc3545', marginBottom: '16px' }}>
                ⚠️
              </div>
              <h5 style={{ color: '#2d3748', marginBottom: '12px' }}>Delete Document</h5>
              <p style={{ color: '#718096', fontSize: '14px' }}>
                Are you sure you want to delete this document? This action cannot be undone.
              </p>
            </div>
            
            <div className="d-flex gap-3 justify-content-center">
              <button
                onClick={() => setDeletingDocument(null)}
                className="btn btn-outline-secondary"
                style={{ minWidth: '100px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteDocument(deletingDocument)}
                className="btn btn-danger"
                style={{ minWidth: '100px' }}
              >
                Delete
              </button>
            </div>
                    </div>
        </div>
      )}

      <div className="App d-flex flex-column vh-100" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <div className="menu-bar p-2 bg-light border-bottom d-flex align-items-center justify-content-between" style={{ width: '100%' }}>
            <button
              onClick={() => {
                setShowLandingModal(true)
                setShowExistingDocuments(false)
              }}
              className="btn btn-outline-primary btn-sm"
              style={{ whiteSpace: 'nowrap' }}
            >
              <i className="bi bi-arrow-left"></i> Open another file
            </button>
            
            <div className="d-flex align-items-center gap-3" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
              {pdfInfo && (
                <div style={{ 
                  color: '#495057', 
                  fontSize: '14px', 
                  fontWeight: '500',
                  textAlign: 'center',
                  maxWidth: '300px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {pdfInfo.original_filename || pdfInfo.filename}
                </div>
              )}
            </div>

          {loading && <span className="ms-2">Processing...</span>}
          {error && <div className="alert alert-danger mb-0 py-1">{error}</div>}
        </div>
        {file && !error && (
          <div className="main-content" style={{ display: 'flex', flex: 1, height: '100%' }}>
            {/* PDF Viewer */}
            <div className="pdf-container" ref={pdfViewerRef}>
              <Document file={file} onLoadSuccess={onDocumentLoadSuccess}>
                  {Array.from(new Array(numPages), (el, index) => {
                    const pageNum = index + 1;
                  const inContext = pageNum >= pageRange[0] && pageNum <= pageRange[1];
                    return (
                    <div key={index} style={{ position: 'relative', marginBottom: 8 }} ref={el => pageRefs.current[index] = el}>
                      {/* Page number label */}
                      <div style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 14,
                        zIndex: 10
                      }}>
                        Page {pageNum}
                      </div>
                      {/* Context window indicator */}
                      {inContext && (
                        <div style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          background: '#007bff',
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          zIndex: 10
                        }}>
                          In Chat Context
                        </div>
                      )}
                      {/* Match quality indicator */}
                      {matchQuality[pageNum] && matchQuality[pageNum].score > 0 && (
                        <div style={{
                          position: 'absolute',
                          bottom: 8,
                          left: 8,
                          background: matchQuality[pageNum].confidence === 'high' ? '#d4edda' : 
                                     matchQuality[pageNum].confidence === 'medium' ? '#fff3cd' : '#f8d7da',
                          color: matchQuality[pageNum].confidence === 'high' ? '#155724' : 
                                 matchQuality[pageNum].confidence === 'medium' ? '#856404' : '#721c24',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          zIndex: 10
                        }}>
                          Match: {matchQuality[pageNum].score}% ({matchQuality[pageNum].strategy})
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
                          console.log('[Highlight DEBUG] onRenderSuccess for page', pageNum, 'currentPage:', currentPage, 'highlightedQuote:', highlightedQuote);
                          setTextLayerReady(prev => {
                            if (prev[pageNum]) return prev; // already true, do not update
                            return { ...prev, [pageNum]: true };
                          });
                          
                          // Only highlight if this is the current page and we have a quote to highlight
                          if (currentPage === pageNum && highlightedQuote) {
                            console.log('[Highlight DEBUG] Condition met, calling highlightTextInPage for', pageNum, highlightedQuote);
                            // Use a small delay to ensure fragments are collected
                            setTimeout(() => {
                              // Try the enhanced method first, fallback to original if needed
                              try {
                                highlightTextInPage(pageNum, highlightedQuote);
                              } catch (error) {
                                console.warn('[Highlight] Enhanced method failed, trying fallback:', error);
                                runFuzzyHighlightFallback(pageNum, highlightedQuote);
                              }
                            }, 100);
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </Document>
            </div>
            {/* Chat Panel */}
            <div className="right-panel" style={{ width: '50%', height: '100%' }}>
              <div className="chat-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #dee2e6' }}>
                  <h3 style={{ margin: 0 }}>Chat with Gemini</h3>
                  <button 
                    onClick={clearChat}
                    className="btn btn-outline-danger btn-sm"
                    style={{ fontSize: '12px', padding: '4px 8px' }}
                    title="Clear chat history"
                  >
                    <i className="bi bi-trash"></i> Clear Chat
                  </button>
                </div>
                <div className="chat-messages" ref={chatMessagesRef} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
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
                            h1: ({node, ...props}) => <h1 style={{fontSize: '1.5em', fontWeight: 'bold', marginBottom: '0.5em', color: '#2c3e50'}} {...props} />,
                            h2: ({node, ...props}) => <h2 style={{fontSize: '1.3em', fontWeight: 'bold', marginBottom: '0.4em', color: '#34495e'}} {...props} />,
                            h3: ({node, ...props}) => <h3 style={{fontSize: '1.1em', fontWeight: 'bold', marginBottom: '0.3em', color: '#34495e'}} {...props} />,
                            p: ({node, ...props}) => <p style={{marginBottom: '0.8em', lineHeight: '1.6'}} {...props} />,
                            ul: ({node, ...props}) => <ul style={{marginBottom: '0.8em', paddingLeft: '1.5em'}} {...props} />,
                            ol: ({node, ...props}) => <ol style={{marginBottom: '0.8em', paddingLeft: '1.5em'}} {...props} />,
                            li: ({node, ...props}) => <li style={{marginBottom: '0.3em'}} {...props} />,
                            strong: ({node, ...props}) => <strong style={{fontWeight: 'bold', color: '#2c3e50'}} {...props} />,
                            em: ({node, ...props}) => <em style={{fontStyle: 'italic', color: '#7f8c8d'}} {...props} />,
                            code: ({node, ...props}) => <code style={{backgroundColor: '#f8f9fa', padding: '0.2em 0.4em', borderRadius: '3px', fontSize: '0.9em', fontFamily: 'monospace'}} {...props} />,
                            blockquote: ({node, ...props}) => <blockquote style={{borderLeft: '4px solid #3498db', paddingLeft: '1em', marginLeft: '0', fontStyle: 'italic', color: '#7f8c8d'}} {...props} />,
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
                              return <li {...props} style={{ marginBottom: '0.3em' }}>{children}</li>;
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
                <div className="chat-input" style={{ padding: 16, background: '#fff', borderTop: '1px solid #dee2e6' }}>
                  <div className="chat-input-container" style={{ 
                    border: '2px solid #e9ecef', 
                    borderRadius: '8px', 
                    overflow: 'hidden',
                    backgroundColor: '#f8f9fa',
                    width: '100%'
                  }}>
                    {/* First Line - Context Page Range */}
                    {numPages && (
                      <div className="context-line" style={{ 
                        padding: '8px 12px', 
                        borderBottom: '1px solid #e9ecef',
                        backgroundColor: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        <span style={{ color: '#6c757d', fontWeight: '500', minWidth: '80px' }}>Context pages:</span>
                        <div className="d-flex align-items-center gap-1">
                          <input
                            type="text"
                            value={pageRangeInput}
                            onChange={e => handlePageRangeChange(e.target.value)}
                            placeholder="e.g., 5; 7; 11-13; [1-3;5-7]"
                            style={{ 
                              width: '400px', 
                              padding: '4px 6px', 
                              border: '1px solid #ced4da', 
                              borderRadius: '4px',
                              fontSize: '13px',
                              textAlign: 'left',
                              backgroundColor: '#fff'
                            }}
                          />
                                                      <span style={{ color: '#6c757d' }}>of {numPages}</span>
                            {parsedPageRanges.length > 0 && (
                              <span style={{ color: '#28a745', fontSize: '12px', marginLeft: '8px' }}>
                                ({parsedPageRanges.length} pages selected)
                              </span>
                            )}
                          </div>
                          {parsedPageRanges.length > 0 && (
                          <button
                            onClick={() => setPageRange(parsedPageRanges.length > 0 ? [parsedPageRanges[0], parsedPageRanges[parsedPageRanges.length - 1]] : [1, numPages])}
                            className="btn btn-outline-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '2px 6px', marginLeft: '4px' }}
                            title="Reset to parsed pages"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                    
                    {/* Second Line - Message Input */}
                    <div className="message-line" style={{ 
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
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
                          fontSize: '14px',
                          backgroundColor: 'transparent'
                        }}
                      />
                      <button 
                        onClick={handleSendMessage} 
                        disabled={loading || !pdfInfo}
                        className="btn btn-primary btn-sm"
                        style={{ 
                          padding: '6px 12px',
                          fontSize: '13px',
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
  )
}

export default App


