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
  const [lastPageRange, setLastPageRange] = useState([1, 1])
  const pageRefs = useRef([])
  
  // Enhanced highlighting state management
  const [currentPage, setCurrentPage] = useState(null)
  const [highlightedQuote, setHighlightedQuote] = useState(null)
  const [highlightedFragmentIndices, setHighlightedFragmentIndices] = useState({})
  const [textLayerReady, setTextLayerReady] = useState({})
  const [highlightWarning, setHighlightWarning] = useState(null)
  const [lastHighlightCall, setLastHighlightCall] = useState(null)
  
  // Enhanced state for match quality and debugging
  const [matchQuality, setMatchQuality] = useState({})
  const pageTextFragments = useRef({})

  // New state for PDF.js search functionality
  const [pdfDocument, setPdfDocument] = useState(null)

  // Landing modal state management
  const [showLandingModal, setShowLandingModal] = useState(true)
  const [existingDocuments, setExistingDocuments] = useState([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  
  // Upload folder state
  const [workingDirConfig, setWorkingDirConfig] = useState(null)
  
  // Working directory PDFs state
  const [showWorkingDirPDFs, setShowWorkingDirPDFs] = useState(false)
  const [workingDirPDFs, setWorkingDirPDFs] = useState([])
  const [scanningWorkingDir, setScanningWorkingDir] = useState(false)
  
  // Enhanced page range state for multiple ranges
  const [pageRangeInput, setPageRangeInput] = useState('')
  const [parsedPageRanges, setParsedPageRanges] = useState([])
  
  // Chat session management
  const [currentChatSessionId, setCurrentChatSessionId] = useState(null)
  const [clearingChat, setClearingChat] = useState(false)
  const [processingReference, setProcessingReference] = useState(null)

  // Load existing documents on component mount
  useEffect(() => {
    loadExistingDocuments()
    loadUploadFolderConfig()
  }, [])

  // Load existing documents
  async function loadExistingDocuments() {
    try {
      setLoadingDocuments(true)
      const response = await fetch(`${API_URL}/documents`)
      if (response.ok) {
        const data = await response.json()
        setExistingDocuments(data.documents || [])
      } else {
        console.error('Failed to load existing documents')
      }
    } catch (error) {
      console.error('Error loading existing documents:', error)
    } finally {
      setLoadingDocuments(false)
    }
  }

  // Load upload folder configuration
  async function loadUploadFolderConfig() {
    try {
      // Since we only have one upload folder, we can set it directly
      setWorkingDirConfig({
        current_working_directory: '/uploads',
        default_upload_folder: '/uploads',
        is_default: true
      })
    } catch (error) {
      console.error('Error loading upload folder config:', error)
    }
  }

  // Handle file selection
  function handleFileSelect(event) {
    const selectedFile = event.target.files[0]
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile)
      setError(null)
    } else if (selectedFile) {
      setError('Please select a valid PDF file')
      setFile(null)
    }
  }

  // Handle file upload
  async function handleFileUpload() {
    if (!file) return
    
    try {
      setLoading(true)
      setError(null)
      
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Upload failed: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Load the uploaded document
      await loadExistingDocument(data.file_path)
      
      // Close modal and clear file
      setShowLandingModal(false)
      setFile(null)
      
      // Reload documents list
      await loadExistingDocuments()
      
      // Show success message
      setError(null)
      
    } catch (error) {
      console.error('Error uploading file:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Load existing document
  async function loadExistingDocument(filePath) {
    try {
      setLoading(true)
      setError(null)
      
      // Get document info
      const response = await fetch(`${API_URL}/documents/${encodeURIComponent(filePath)}`)
      if (!response.ok) {
        throw new Error(`Failed to load document: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Check if this is an uploaded file
      if (data.is_uploaded === 1) {
        // For uploaded files, we can't show the PDF but we can still chat about it
        setPdfInfo({
          ...data,
          file_path: filePath,
          is_uploaded: true,
          url: null
        })
        
        // Show a message that the PDF can't be viewed but text is available
        setError('This file was uploaded and processed. The PDF cannot be viewed, but you can chat about the extracted text.')
        
        // Load most recent chat session
        await loadMostRecentChatSession(filePath)
        
        setLoading(false)
        return
      }
      
      // For working directory files, get the PDF file
      const pdfResponse = await fetch(`${API_URL}/documents/${encodeURIComponent(filePath)}/file`)
      if (!pdfResponse.ok) {
        throw new Error(`Failed to load PDF file: ${pdfResponse.statusText}`)
      }
      
      const pdfBlob = await pdfResponse.blob()
      const pdfUrl = URL.createObjectURL(pdfBlob)
      
      // Set PDF info
      setPdfInfo({
        ...data,
        file_path: filePath,
        url: pdfUrl,
        is_uploaded: false
      })
      
      // Load most recent chat session
      await loadMostRecentChatSession(filePath)
      
      setLoading(false)
    } catch (error) {
      console.error('Error loading existing document:', error)
      setError(error.message)
      setLoading(false)
    }
  }

  // Load most recent chat session
  async function loadMostRecentChatSession(filePath) {
    try {
      const response = await fetch(`${API_URL}/chat/sessions/${encodeURIComponent(filePath)}`)
      if (!response.ok) {
        throw new Error(`Failed to load chat sessions: ${response.statusText}`)
      }
      
      const data = await response.json()
      const sessions = data.sessions || []
      
      if (sessions.length > 0) {
        // Load the most recent session
        const mostRecentSession = sessions[0]
        await loadChatSession(mostRecentSession.id)
      } else {
        // Create a new chat session
        await createNewChatSession(filePath)
      }
    } catch (error) {
      console.error('Error loading chat sessions:', error)
      // Create a new chat session if loading fails
      await createNewChatSession(filePath)
    }
  }

  // Create new chat session
  async function createNewChatSession(filePath) {
    try {
      const response = await fetch(`${API_URL}/chat/sessions/${encodeURIComponent(filePath)}`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        throw new Error(`Failed to create chat session: ${response.statusText}`)
      }
      
      const data = await response.json()
      setCurrentChatSessionId(data.session_id)
      setChatMessages([])
      
      console.log('New chat session created:', data.session_id)
    } catch (error) {
      console.error('Error creating chat session:', error)
      setError(error.message)
    }
  }

  // Load chat session
  async function loadChatSession(sessionId) {
    try {
      const response = await fetch(`${API_URL}/chat/sessions/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        setCurrentChatSessionId(sessionId)
        setChatMessages(data.messages || [])
      }
    } catch (error) {
      console.error('Error loading chat session:', error)
    }
  }

  // Document load success handler
  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages)
    setPageRange([1, Math.min(numPages, 10)])
  }

  // Document load error handler
  function onDocumentLoadError(error) {
    console.error('Error loading document:', error)
    setError('Failed to load PDF document')
  }

  // Page load success handler
  function onPageLoadSuccess(page, pageNumber) {
    pageRefs.current[pageNumber] = page
  }

  // Text layer success handler
  function onTextLayerSuccess(textLayer, pageNumber) {
    setTextLayerReady(prev => ({ ...prev, [pageNumber]: true }))
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
          document_file_path: pdfInfo.file_path,
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
    if (!window.confirm('Are you sure you want to clear this chat? This action cannot be undone.')) {
      return
    }
    
    try {
      setClearingChat(true)
      
      if (currentChatSessionId) {
        const response = await fetch(`${API_URL}/chat/sessions/${currentChatSessionId}`, {
          method: 'DELETE'
        })
        
        if (response.ok) {
          setCurrentChatSessionId(null)
          setChatMessages([])
        }
      } else {
        setChatMessages([])
      }
    } catch (error) {
      console.error('Error clearing chat:', error)
      setError('Failed to clear chat')
    } finally {
      setClearingChat(false)
    }
  }

  // Upload folder PDF scanning functions
  async function scanUploadFolderPDFs() {
    try {
      setScanningWorkingDir(true)
      const response = await fetch(`${API_URL}/files/scan`, {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        setWorkingDirPDFs(data.pdf_files || [])
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to scan upload folder')
      }
    } catch (error) {
      console.error('Error scanning upload folder:', error)
      setError(error.message)
    } finally {
      setScanningWorkingDir(false)
    }
  }

  function openUploadFolderPDFsModal() {
    setShowWorkingDirPDFs(true)
    scanUploadFolderPDFs()
  }

  function closeUploadFolderPDFsModal() {
    setShowWorkingDirPDFs(false)
    setWorkingDirPDFs([])
  }

  async function openPDFFromUploadFolder(filePath, filename) {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`${API_URL}/files/open-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_path: filePath,
          filename: filename
        })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Failed to open PDF: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Get PDF file
      const pdfResponse = await fetch(`${API_URL}/files/serve-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_path: filePath
        })
      })
      
      if (!pdfResponse.ok) {
        throw new Error(`Failed to load PDF file: ${pdfResponse.statusText}`)
      }
      
      const pdfBlob = await pdfResponse.blob()
      const pdfUrl = URL.createObjectURL(pdfBlob)
      
      // Set PDF info
      setPdfInfo({
        ...data,
        file_path: filePath,
        url: pdfUrl
      })
      
      // Load most recent chat session
      await loadMostRecentChatSession(filePath)
      
      setLoading(false)
      setShowWorkingDirPDFs(false)
    } catch (error) {
      console.error('Error opening PDF from upload folder:', error)
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="header" style={{ 
        backgroundColor: '#ffffff', 
        borderBottom: '1px solid #dee2e6', 
        padding: '8px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#2d3748' }}>SKIM2</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={openUploadFolderPDFsModal}
            className="btn btn-outline-success btn-sm"
            style={{ fontSize: '12px' }}
          >
            <i className="bi bi-folder2-open me-1"></i>
            Browse Uploaded PDFs
          </button>
        </div>
      </div>

      {/* Landing Modal */}
      {showLandingModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Welcome to SKIM2</h5>
                <button type="button" className="btn-close" onClick={() => setShowLandingModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="row">
                  {/* Open File Section */}
                  <div className="col-md-6">
                    <div className="card h-100">
                      <div className="card-header">
                        <h6 className="mb-0">
                          <i className="bi bi-file-earmark-pdf me-2"></i>
                          Open PDF File
                        </h6>
                      </div>
                      <div className="card-body d-flex flex-column">
                        <p className="text-muted small mb-3">
                          Upload a new PDF file to start analyzing and chatting about it.
                        </p>
                        
                        {/* File Upload */}
                        <div className="mb-3">
                          <input
                            type="file"
                            accept=".pdf"
                            onChange={handleFileSelect}
                            className="form-control"
                            id="fileInput"
                          />
                        </div>
                        
                        <button
                          onClick={handleFileUpload}
                          disabled={!file || loading}
                          className="btn btn-primary mt-auto"
                        >
                          {loading ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2"></span>
                              Processing...
                            </>
                          ) : (
                            <>
                              <i className="bi bi-upload me-2"></i>
                              Upload & Process
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Recently Opened Files */}
                  <div className="col-md-6">
                    <div className="card h-100">
                      <div className="card-header d-flex justify-content-between align-items-center">
                        <h6 className="mb-0">
                          <i className="bi bi-clock-history me-2"></i>
                          Recently Opened
                        </h6>
                        <button
                          onClick={openWorkingDirPDFsModal}
                          className="btn btn-outline-primary btn-sm"
                          title="Browse PDFs from working directory"
                        >
                          <i className="bi bi-folder2-open me-1"></i>
                          Browse PDFs
                        </button>
                      </div>
                      <div className="card-body">
                        {loadingDocuments ? (
                          <div className="text-center py-3">
                            <div className="spinner-border spinner-border-sm me-2"></div>
                            Loading documents...
                          </div>
                        ) : existingDocuments.length > 0 ? (
                          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {existingDocuments.slice(0, 5).map(doc => (
                              <div
                                key={doc.file_path}
                                className="border rounded p-3 mb-2 cursor-pointer"
                                style={{
                                  transition: 'all 0.2s',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={e => e.target.style.backgroundColor = '#f8f9fa'}
                                onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                                onClick={() => {
                                  loadExistingDocument(doc.file_path)
                                  setShowLandingModal(false)
                                }}
                              >
                                <h6 className="mb-1 text-truncate" title={doc.filename}>
                                  {doc.filename}
                                </h6>
                                <p className="text-muted small mb-1">
                                  {doc.num_pages} pages • {(doc.file_size / 1024 / 1024).toFixed(2)} MB
                                </p>
                                <p className="text-muted small mb-0">
                                  {new Date(doc.uploaded_at).toLocaleDateString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-3 text-muted">
                            <i className="bi bi-inbox display-4"></i>
                            <p className="mt-2">No documents yet</p>
                            <p className="small">Upload your first PDF to get started</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Working Directory Info */}
                <div className="mt-3 p-3 bg-light rounded">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <h6 className="mb-1">Working Directory</h6>
                      <p className="text-muted small mb-0">
                        Current: <code>{workingDirConfig?.current || 'backend/uploads'}</code>
                      </p>
                    </div>
                    <button
                      onClick={openWorkingDirModal}
                      className="btn btn-outline-secondary btn-sm"
                    >
                      <i className="bi bi-gear me-1"></i>
                      Change
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Folder PDFs Modal */}
      {showWorkingDirPDFs && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">PDFs in Upload Folder</h5>
                <button type="button" className="btn-close" onClick={closeUploadFolderPDFsModal}></button>
              </div>
              <div className="modal-body">
                {scanningWorkingDir ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Scanning...</span>
                    </div>
                    <p className="mt-2">Scanning directory...</p>
                  </div>
                ) : workingDirPDFs.length > 0 ? (
                  <div className="row">
                    {workingDirPDFs.map((pdfFile, index) => (
                      <div key={index} className="col-md-6 mb-3">
                        <div className="card">
                          <div className="card-body">
                            <h6 className="card-title text-truncate" title={pdfFile.filename}>
                              {pdfFile.filename}
                            </h6>
                            <p className="card-text small text-muted">
                              {pdfFile.file_size_mb} MB
                            </p>
                            <button
                              onClick={() => openPDFFromUploadFolder(pdfFile.file_path, pdfFile.filename)}
                              className="btn btn-primary btn-sm"
                              disabled={loading}
                            >
                              {loading ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-1"></span>
                                  Opening...
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-file-earmark-text me-1"></i>
                                  Open PDF
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <i className="bi bi-folder-x" style={{ fontSize: '48px', color: '#a0aec0', marginBottom: '16px' }}></i>
                    <p style={{ color: '#718096', marginBottom: '20px' }}>No PDF files found</p>
                    <p style={{ color: '#a0aec0', fontSize: '14px' }}>
                      No PDF files were found in the upload folder.
                    </p>
                    <button
                      onClick={scanUploadFolderPDFs}
                      className="btn btn-outline-primary btn-sm"
                      style={{ fontSize: '12px' }}
                    >
                      <i className="bi bi-arrow-clockwise me-1"></i>
                      Scan Again
                    </button>
                  </div>
                )}

                {/* Instructions */}
                <div className="alert alert-light mt-4" style={{ fontSize: '13px' }}>
                  <h6 style={{ marginBottom: '8px' }}>Instructions:</h6>
                  <ul className="mb-0" style={{ paddingLeft: '20px' }}>
                    <li>Click "Open PDF" to open any PDF file from the upload folder</li>
                    <li>Files will be added to your document library if not already present</li>
                    <li>You can use all features (chat, OCR, etc.) with opened PDFs</li>
                    <li>These are files that have been uploaded to the system</li>
                  </ul>
                </div>
              </div>
            </div>
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
              {/* PDF Viewer Header */}
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
                </div>
              )}

              {/* PDF Content */}
              <div style={{ 
                padding: '30px 20px',
                paddingTop: file && !loading ? '120px' : '30px',
                flex: 1,
                overflow: 'auto'
              }}>
                {error && (
                  <div className="alert alert-danger" style={{ marginBottom: '20px' }}>
                    <strong>Error:</strong> {error}
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
                
                {file && !loading && !pdfInfo?.is_uploaded && (
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
                      return (
                        <div 
                          key={pageNum} 
                          style={{ 
                            marginBottom: pageNum < numPages ? '20px' : '0',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center'
                          }}
                        >
                          <div style={{
                            background: '#f8f9fa',
                            color: '#495057',
                            padding: '4px 12px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: '500',
                            marginBottom: '10px',
                            border: '1px solid #dee2e6'
                          }}>
                            Page {pageNum}
                          </div>
                          
                          <Page
                            key={`page_${pageNum}`}
                            pageNumber={pageNum}
                            width={pdfViewerRef.current?.clientWidth || 800}
                            onLoadSuccess={(page) => onPageLoadSuccess(page, pageNum)}
                            onRenderTextLayerSuccess={(textLayer) => onTextLayerSuccess(textLayer, pageNum)}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                          />
                        </div>
                      )
                    })}
                  </Document>
                )}

                {pdfInfo?.is_uploaded && (
                  <div className="uploaded-file-message">
                    <div className="text-center py-5">
                      <i className="bi bi-file-earmark-text display-1 text-muted"></i>
                      <h5 className="mt-3">Uploaded File</h5>
                      <p className="text-muted">
                        This file was uploaded and processed. The PDF cannot be viewed, but you can chat about the extracted text below.
                      </p>
                      <p className="text-muted small">
                        {pdfInfo.num_pages} pages • {(pdfInfo.file_size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
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
                        maxWidth: '80%',
                        flexDirection: message.role === 'user' ? 'row-reverse' : 'row'
                      }}>
                        <div style={{
                          backgroundColor: message.role === 'user' ? '#007bff' : '#f8f9fa',
                          color: message.role === 'user' ? 'white' : '#212529',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          fontSize: '12px'
                        }}>
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
                              fontSize: '12px', 
                              color: message.role === 'user' ? 'rgba(255,255,255,0.8)' : '#6c757d', 
                              marginTop: '8px',
                              fontStyle: 'italic'
                            }}>
                              Pages {message.page_range[0]}-{message.page_range[1]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {/* Chat Input */}
              <div className="chat-input" style={{ padding: '15px', borderTop: '1px solid #dee2e6', flexShrink: 0 }}>
                <div className="mb-2">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="Page range (e.g., 1-5, 10, 15-20)"
                    value={pageRangeInput}
                    onChange={(e) => setPageRangeInput(e.target.value)}
                    style={{ fontSize: '12px' }}
                  />
                </div>
                <div className="d-flex gap-2">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Ask a question about your PDF..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                    disabled={!pdfInfo}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || !pdfInfo}
                    className="btn btn-primary"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
