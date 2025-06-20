import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import './App.css'
import { useState, useEffect, memo, useCallback, useMemo, useRef } from 'react'

// Configure the worker to use the local file
pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'

// console.log('=== INITIALIZATION ===')
// console.log('PDF.js version:', pdfjs.version)
// console.log('Worker source:', pdfjs.GlobalWorkerOptions.workerSrc)

const API_URL = 'http://localhost:5001/api'

// Memoized BlockOverlay component to prevent unnecessary re-renders
const BlockOverlay = memo(({ blocks, scale, pageNumber, onBlockClick, activatedTexts, pageScale, rhetoricalLabels }) => {
  if (!blocks || !blocks[pageNumber - 1]) return null;

  return (
    <div 
      className="block-overlay" 
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000
      }}
    >
      {blocks[pageNumber - 1].map((block, blockIndex) => {
        const isActive = block.user_order !== null;
        const activatedBlock = activatedTexts.find(
          item => item.pageIndex === pageNumber - 1 && item.blockIndex === block.id
        );

        return (
          <div
            key={`block-${pageNumber}-${blockIndex}`}
            className="block-overlay"
            style={{
              position: 'absolute',
              left: `${(block.bbox.x0 * pageScale) - 2}px`,
              top: `${(block.bbox.y0 * pageScale) - 2}px`,
              width: `${(block.bbox.x1 - block.bbox.x0) * pageScale + 4}px`,
              height: `${(block.bbox.y1 - block.bbox.y0) * pageScale + 4}px`,
              border: `2px solid ${isActive ? 'green' : 'grey'}`,
              backgroundColor: isActive ? 'rgba(0, 255, 0, 0.1)' : 'rgba(128, 128, 128, 0.2)',
              cursor: 'pointer',
              zIndex: 1001,
              pointerEvents: 'auto'
            }}
            onClick={() => onBlockClick(pageNumber - 1, blockIndex)}
          >
            {isActive && (
              <div className="block-number" style={{
                position: 'absolute',
                top: '-20px',
                left: '0',
                backgroundColor: 'green',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '12px'
              }}>
                {block.user_order}
              </div>
            )}
            
            {/* Word bounding boxes and sentence starter icons */}
            {isActive && activatedBlock && activatedBlock.word_positions && activatedBlock.word_positions.map((word, wordIndex) => {
              const wordLeft = (word.bbox.x0 - block.bbox.x0) * pageScale;
              const wordTop = (word.bbox.y0 - block.bbox.y0) * pageScale;
              const wordWidth = (word.bbox.x1 - word.bbox.x0) * pageScale;
              const wordHeight = (word.bbox.y1 - word.bbox.y0) * pageScale;
              
              return (
                <div
                  key={`word-${wordIndex}`}
                  className="word-hover-area"
                  style={{
                    position: 'absolute',
                    left: `${wordLeft}px`,
                    top: `${wordTop}px`,
                    width: `${wordWidth}px`,
                    height: `${wordHeight}px`,
                    cursor: 'pointer'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle word click for adding markers
                  }}
                >
                  {!word.is_sentence_starter && (
                    <div 
                      className="add-marker"
                      style={{
                        left: '-13px',
                        top: '50%',
                        transform: 'translateY(-50%)'
                      }}
                    >
                      <div className="add-marker-circle">+</div>
                      <div className="add-marker-triangle" />
                    </div>
                  )}
                  {word.is_sentence_starter && (
                    <div
                      className="sentence-marker"
                      style={{
                        left: '-13px',
                        top: '50%',
                        transform: 'translateY(-50%)'
                      }}
                    >
                      <div className="sentence-marker-circle">
                        {word.sentence_number || '?'}
                      </div>
                      <div className="sentence-marker-triangle" />
                      {rhetoricalLabels[word.sentence_number] && (
                        <div className="rhetorical-label" style={{
                          position: 'absolute',
                          left: '20px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          backgroundColor: 'rgba(255, 255, 255, 0.9)',
                          padding: '8px 12px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          zIndex: 1004,
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                            {rhetoricalLabels[word.sentence_number].function} ({rhetoricalLabels[word.sentence_number].relevance}%)
                          </div>
                          <div style={{ 
                            fontSize: '11px', 
                            color: '#666',
                            whiteSpace: 'normal',
                            maxHeight: '60px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {rhetoricalLabels[word.sentence_number].text}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});

// Memoized Page component to prevent unnecessary re-renders
const MemoizedPage = memo(({ pageNumber, scale, onLoadSuccess, onLoadError, onRenderSuccess, blocks, pageIndex, onBlockClick, activatedTexts, pageScale, rhetoricalLabels }) => {
  return (
    <div className="page-container position-relative" style={{
      width: '100%',
      height: 'auto',
      display: 'flex',
      justifyContent: 'center',
      marginBottom: '0'
    }}>
      <div style={{ position: 'relative' }}>
        <Page 
          pageNumber={pageNumber} 
          scale={scale}
          onLoadSuccess={onLoadSuccess}
          onLoadError={onLoadError}
          loading={<div className="d-flex justify-content-center p-3"><div className="spinner-border spinner-border-sm" role="status"><span className="visually-hidden">Loading page {pageNumber}...</span></div></div>}
          error={<div className="alert alert-danger m-3">Error loading page {pageNumber}!</div>}
          className="pdf-page"
          style={{
            maxWidth: '100%',
            height: 'auto'
          }}
          onRenderSuccess={onRenderSuccess}
        />
        {blocks && blocks[pageIndex] && (
          <BlockOverlay 
            blocks={blocks}
            scale={scale}
            pageNumber={pageNumber}
            onBlockClick={onBlockClick}
            activatedTexts={activatedTexts}
            pageScale={pageScale}
            rhetoricalLabels={rhetoricalLabels}
          />
        )}
      </div>
    </div>
  );
});

const SentenceMarkers = memo(({ block, pageIndex, blockIndex, activatedBlock, sentencePositions, pageScale, onAddMarker, onRemoveMarker }) => {
  console.log('=== SENTENCE MARKERS RENDER ===');
  console.log('Activated block:', activatedBlock);
  console.log('Page scale:', pageScale);
  
  if (!activatedBlock || !activatedBlock.word_positions) {
    console.log('No activated block or word positions');
    return null;
  }

  // Get sentence starter words
  const sentenceStarters = activatedBlock.word_positions.filter(
    word => word.is_sentence_starter
  );
  
  console.log('Sentence starters in render:', {
    count: sentenceStarters.length,
    starters: sentenceStarters.map(word => ({
      text: word.text,
      sentence_number: word.sentence_number,
      bbox: word.bbox
    }))
  });

  return (
    <div
      key={`sentence-markers-${pageIndex}-${blockIndex}`}
      className="sentence-markers"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        zIndex: 1003,
        pointerEvents: 'none',
        transform: `scale(${pageScale})`,
        transformOrigin: 'top left'
      }}
    >
      {sentenceStarters.map((word) => {
        console.log(`Rendering sentence marker for word:`, {
          text: word.text,
          sentence_number: word.sentence_number,
          bbox: word.bbox
        });
        
        return (
          <div
            key={`sentence-${word.sentence_number}`}
            className="sentence-marker"
            style={{
              left: `${word.bbox.x0}px`,
              top: `${(word.bbox.y0 + word.bbox.y1) / 2 - 8}px`,
              transform: 'translateX(-15px)'
            }}
          >
            <div className="sentence-marker-circle">
              {word.sentence_number || '?'}
            </div>
            <div className="sentence-marker-triangle" />
          </div>
        );
      })}
    </div>
  );
});

// Add new ChatResponse component for structured visualization
const ChatResponseDisplay = ({ data }) => {
  const { relevant_sentences, overall_relevance_score, explanation, answer } = data;
  
  // Sort sentences by relevance score (highest first)
  const sortedSentences = relevant_sentences ? [...relevant_sentences].sort((a, b) => b.relevance_score - a.relevance_score) : [];

  return (
    <div className="chat-response-structured">
      <div className="response-section">
        <strong>Answer:</strong> {answer}
      </div>
      
      {sortedSentences.length > 0 && (
        <div className="response-section">
          <strong>Relevant Sentences:</strong>
          <div className="sentences-list">
            {sortedSentences.map((sentence, index) => (
              <div key={index} className="sentence-item">
                <div className="sentence-header">
                  <span className="sentence-number">Sentence {sentence.sentence_number}</span>
                  <span className="relevance-score">{sentence.relevance_score}%</span>
                </div>
                <div className="sentence-text">{sentence.text}</div>
                <div className="relevance-bar">
                  <div 
                    className="relevance-fill" 
                    style={{ width: `${sentence.relevance_score}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="response-section">
        <strong>Overall Relevance:</strong> {overall_relevance_score}%
        <div className="overall-relevance-bar">
          <div 
            className="relevance-fill" 
            style={{ width: `${overall_relevance_score}%` }}
          ></div>
        </div>
      </div>
      
      <div className="response-section">
        <strong>Explanation:</strong> {explanation}
      </div>
    </div>
  );
};

// Add new ChatPanel component
const ChatPanel = ({ documentId }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sentenceCount, setSentenceCount] = useState(0);

  // Function to fetch current sentence count
  const fetchSentenceCount = async () => {
    if (!documentId) {
      setSentenceCount(0);
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/sentences/${documentId}`);
      const data = await response.json();
      const count = data.sentences ? data.sentences.length : 0;
      setSentenceCount(count);
    } catch (error) {
      console.error('Error fetching sentence count:', error);
      setSentenceCount(0);
    }
  };

  // Fetch sentence count when documentId changes
  useEffect(() => {
    fetchSentenceCount();
  }, [documentId]);

  // Set up polling to update sentence count every 2 seconds
  useEffect(() => {
    if (!documentId) return;
    
    const interval = setInterval(fetchSentenceCount, 2000);
    return () => clearInterval(interval);
  }, [documentId]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !documentId) return;

    const newMessage = {
      role: 'user',
      content: inputMessage
    };

    setMessages(prev => [...prev, newMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Fetch current sentences before sending to chat
      console.log('=== FETCHING SENTENCES FOR CHAT ===');
      const sentencesResponse = await fetch(`${API_URL}/sentences/${documentId}`);
      const sentencesData = await sentencesResponse.json();
      const sentences = sentencesData.sentences || [];
      
      console.log('Sentences fetched for chat:', sentences);
      console.log('Number of sentences:', sentences.length);

      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: inputMessage,
          sentences: sentences
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${data.error}`,
          isStructured: false
        }]);
      } else {
        // Handle structured response
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data,
          isStructured: true
        }]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, there was an error processing your message.',
        isStructured: false
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Chat with Gemini</h3>
        <small>
          {sentenceCount > 0 
            ? `${sentenceCount} sentence${sentenceCount !== 1 ? 's' : ''} available for context`
            : 'Click blocks to activate them, then mark sentence starters to enable chat'
          }
        </small>
      </div>
      <div className="chat-messages">
        {messages.map((message, index) => (
          <div key={index} className={`chat-message ${message.role}`}>
            {message.isStructured ? (
              <ChatResponseDisplay data={message.content} />
            ) : (
              <div className="message-content">{message.content}</div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="chat-message assistant">
            <div className="message-content">Thinking...</div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Ask a question about the text..."
          disabled={!documentId}
        />
        <button onClick={handleSendMessage} disabled={isLoading || !documentId}>
          Send
        </button>
      </div>
    </div>
  );
};

// Document Browser Component
const DocumentBrowser = ({ onSelectDocument, onClose }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/documents`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await response.json();
      setDocuments(data.documents);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDocument = async (documentId) => {
    if (!window.confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/documents/${documentId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
      
      // Refresh the document list
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document');
    }
  };

  const handleRenameDocument = async (documentId, newName) => {
    try {
      const response = await fetch(`${API_URL}/documents/${documentId}/rename`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ new_name: newName }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to rename document');
      }
      
      setEditingId(null);
      setEditName('');
      fetchDocuments();
    } catch (error) {
      console.error('Error renaming document:', error);
      alert('Failed to rename document');
    }
  };

  const startEditing = (document) => {
    setEditingId(document.id);
    setEditName(document.original_filename);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="document-browser-overlay">
        <div className="document-browser">
          <div className="d-flex justify-content-center p-5">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading documents...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="document-browser-overlay">
      <div className="document-browser">
        <div className="document-browser-header">
          <h3>Document Sessions</h3>
          <button 
            type="button" 
            className="btn-close" 
            onClick={onClose}
            aria-label="Close"
          ></button>
        </div>
        
        {error && (
          <div className="alert alert-danger m-3">{error}</div>
        )}
        
        <div className="document-list">
          {documents.length === 0 ? (
            <div className="text-center p-5 text-muted">
              <p>No documents found. Upload a PDF to get started.</p>
            </div>
          ) : (
            documents.map((document) => (
              <div key={document.id} className="document-item">
                <div className="document-info">
                  {editingId === document.id ? (
                    <div className="edit-form">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="form-control form-control-sm"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleRenameDocument(document.id, editName);
                          }
                        }}
                      />
                      <div className="edit-actions">
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => handleRenameDocument(document.id, editName)}
                        >
                          Save
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={cancelEditing}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="document-details">
                      <h6 className="document-title">{document.original_filename}</h6>
                      <div className="document-meta">
                        <span className="meta-item">
                          <i className="bi bi-file-pdf"></i>
                          {document.page_count} pages
                        </span>
                        <span className="meta-item">
                          <i className="bi bi-check-circle"></i>
                          {document.activated_blocks} activated blocks
                        </span>
                        <span className="meta-item">
                          <i className="bi bi-chat-text"></i>
                          {document.sentence_count} sentences
                        </span>
                        <span className="meta-item">
                          <i className="bi bi-calendar"></i>
                          {formatDate(document.created_at)}
                        </span>
                        {document.file_exists && (
                          <span className="meta-item">
                            <i className="bi bi-hdd"></i>
                            {formatFileSize(document.file_size)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="document-actions">
                  {editingId !== document.id && (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onSelectDocument(document)}
                        disabled={!document.file_exists}
                      >
                        Open
                      </button>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => startEditing(document)}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDeleteDocument(document.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

function App() {
  // console.log('=== APP RENDER ===');
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pdfInfo, setPdfInfo] = useState(null)
  const [blocks, setBlocks] = useState(null)
  const [showBlocks, setShowBlocks] = useState(false)
  const [pageScale, setPageScale] = useState(1)
  const [activatedTexts, setActivatedTexts] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [sentencePositions, setSentencePositions] = useState([])
  const [labelPosition, setLabelPosition] = useState(null)
  const [customMarkers, setCustomMarkers] = useState([])
  const [isReinitializing, setIsReinitializing] = useState(false)
  const [wordPositions, setWordPositions] = useState([])
  const [rhetoricalLabels, setRhetoricalLabels] = useState({})
  const [showDocumentBrowser, setShowDocumentBrowser] = useState(false)
  
  // Performance optimization: Track visible pages for virtualization
  const [visiblePages, setVisiblePages] = useState(new Set([1]))
  const containerRef = useRef(null)
  const pageRefs = useRef({})

  // Log all state changes
  useEffect(() => {
    // console.log('=== STATE UPDATE ===');
    // console.log('numPages:', numPages);
    // console.log('pageNumber:', pageNumber);
    // console.log('file:', file);
    // console.log('loading:', loading);
    // console.log('error:', error);
    // console.log('pdfInfo:', pdfInfo);
    // console.log('blocks:', blocks);
    // console.log('showBlocks:', showBlocks);
    // console.log('pageScale:', pageScale);
    // console.log('activatedTexts:', activatedTexts);
    // console.log('isProcessing:', isProcessing);
    // console.log('sentencePositions:', sentencePositions);
  }, [numPages, pageNumber, file, loading, error, pdfInfo, blocks, showBlocks, pageScale, activatedTexts, isProcessing, sentencePositions]);

  // Intersection Observer for virtualization
  useEffect(() => {
    if (!containerRef.current || !numPages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newVisiblePages = new Set(visiblePages);
        
        entries.forEach((entry) => {
          const pageNumber = parseInt(entry.target.dataset.pageNumber);
          if (entry.isIntersecting) {
            newVisiblePages.add(pageNumber);
          } else {
            newVisiblePages.delete(pageNumber);
          }
        });
        
        setVisiblePages(newVisiblePages);
      },
      {
        root: containerRef.current,
        rootMargin: '100px', // Load pages 100px before they become visible
        threshold: 0.1
      }
    );

    // Observe all page containers
    Object.values(pageRefs.current).forEach(ref => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [numPages, visiblePages]);

  // Memoized function to check if a page should be rendered
  const shouldRenderPage = useCallback((pageNum) => {
    return visiblePages.has(pageNum);
  }, [visiblePages]);

  function onDocumentLoadSuccess({ numPages }) {
    // console.log('=== DOCUMENT LOADED SUCCESSFULLY ===');
    // console.log('Number of pages:', numPages);
    setNumPages(numPages);
    setVisiblePages(new Set([1])); // Start with first page visible
  }

  function onDocumentLoadError(error) {
    console.error('=== DOCUMENT LOAD ERROR ===');
    console.error('Error object:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    setError('Error loading PDF document');
  }

  function onPageLoadSuccess() {
    // console.log('=== PAGE LOADED SUCCESSFULLY ===');
  }

  function onPageLoadError(error) {
    console.error('=== PAGE LOAD ERROR ===');
    console.error('Error object:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    setError('Error loading PDF page');
  }

  async function onFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload file
      const uploadResponse = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      const uploadData = await uploadResponse.json();
      setPdfInfo(uploadData);

      // Get blocks and word positions
      const blocksResponse = await fetch(`${API_URL}/blocks/${uploadData.document_id}`);
      if (!blocksResponse.ok) {
        throw new Error('Failed to fetch blocks and words');
      }
      const data = await blocksResponse.json();
      setBlocks(data.blocks);
      setWordPositions(data.words);
      setShowBlocks(true);  // Enable block overlays

      setFile(file);
      setPageNumber(1);
    } catch (error) {
      console.error('Upload error:', error);
      console.error('Error details:', error);
      setError('Error uploading file');
    } finally {
      setLoading(false);
    }
  }

  // Optimized handleBlockClick with reduced API calls
  const handleBlockClick = useCallback(async (pageIndex, blockIndex) => {
    const block = blocks[pageIndex][blockIndex];
    const isActive = block.user_order !== null;
    console.log('=== HANDLE BLOCK CLICK ===');
    console.log('Initial state:', { pageIndex, blockIndex, isActive, block });

    try {
      // Optimistic update for better UX
      const optimisticBlocks = [...blocks];
      const optimisticActivatedTexts = [...activatedTexts];
      
      if (isActive) {
        // Deactivating - remove user_order
        optimisticBlocks[pageIndex][blockIndex] = {
          ...optimisticBlocks[pageIndex][blockIndex],
          user_order: null
        };
        
        // Remove from activated texts
        const updatedActivatedTexts = optimisticActivatedTexts.filter(
          item => !(item.pageIndex === pageIndex && item.blockIndex === block.id)
        );
        setActivatedTexts(updatedActivatedTexts);
      } else {
        // Activating - add user_order
        const nextOrder = Math.max(0, ...optimisticActivatedTexts.map(item => item.userOrder || 0)) + 1;
        optimisticBlocks[pageIndex][blockIndex] = {
          ...optimisticBlocks[pageIndex][blockIndex],
          user_order: nextOrder
        };
        
        // Add to activated texts
        const newActivatedBlock = {
          pageIndex,
          blockIndex: block.id,
          page_id: block.page_id,
          block_id: block.block_id,
          blockId: `${pageIndex + 1}-${block.id}`,
          text: block.text,
          userOrder: nextOrder,
          word_positions: wordPositions.filter(w => 
            w.page_id === block.page_id && 
            w.block_id === block.block_id
          )
        };
        setActivatedTexts(prev => [...prev, newActivatedBlock]);
      }
      
      setBlocks(optimisticBlocks);

      // Single API call to update block activation
      const response = await fetch(`${API_URL}/activate-block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_id: pdfInfo.document_id,
          page_number: pageIndex + 1,
          block_number: block.id,
          is_activating: !isActive
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update block activation');
      }

      // Only fetch updated data if we need sentence numbers
      if (!isActive) {
        // Reset sentence numbers only when activating new blocks
        const resetResponse = await fetch(`${API_URL}/reset-sentence-numbers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            document_id: pdfInfo.document_id
          })
        });

        if (!resetResponse.ok) {
          throw new Error('Failed to reset sentence numbers');
        }

        // Fetch updated blocks and words after resetting sentence numbers
        const updatedBlocksResponse = await fetch(`${API_URL}/blocks/${pdfInfo.document_id}`);
        if (!updatedBlocksResponse.ok) {
          throw new Error('Failed to fetch updated blocks after reset');
        }
        const updatedData = await updatedBlocksResponse.json();
        
        setBlocks(updatedData.blocks);
        setWordPositions(updatedData.words);

        // Update activated texts with the latest word positions including sentence numbers
        const updatedActivatedBlocks = updatedData.blocks.flatMap((pageBlocks, pageIdx) =>
          pageBlocks
            .filter(block => block.user_order !== null)
            .map(block => ({
              pageIndex: pageIdx,
              blockIndex: block.id,
              page_id: block.page_id,
              block_id: block.block_id,
              blockId: `${pageIdx + 1}-${block.id}`,
              text: block.text,
              userOrder: block.user_order,
              word_positions: updatedData.words.filter(w => 
                w.page_id === block.page_id && 
                w.block_id === block.block_id
              )
            }))
        );
        setActivatedTexts(updatedActivatedBlocks);
      }

    } catch (error) {
      console.error('Error handling block click:', error);
      // Revert optimistic updates on error
      const blocksResponse = await fetch(`${API_URL}/blocks/${pdfInfo.document_id}`);
      if (blocksResponse.ok) {
        const data = await blocksResponse.json();
        setBlocks(data.blocks);
        setWordPositions(data.words);
        
        const activatedBlocks = data.blocks.flatMap((pageBlocks, pageIdx) =>
          pageBlocks
            .filter(block => block.user_order !== null)
            .map(block => ({
              pageIndex: pageIdx,
              blockIndex: block.id,
              page_id: block.page_id,
              block_id: block.block_id,
              blockId: `${pageIdx + 1}-${block.id}`,
              text: block.text,
              userOrder: block.user_order,
              word_positions: data.words.filter(w => 
                w.page_id === block.page_id && 
                w.block_id === block.block_id
              )
            }))
        );
        setActivatedTexts(activatedBlocks);
      }
    }
  }, [blocks, activatedTexts, wordPositions, pdfInfo]);

  // Add useEffect to fetch rhetorical labels when document is loaded
  useEffect(() => {
    const fetchRhetoricalLabels = async () => {
      if (pdfInfo?.document_id) {
        try {
          console.log('=== FETCHING INITIAL LABELS ===');
          const response = await fetch(`${API_URL}/sentences/${pdfInfo.document_id}`);
          const data = await response.json();
          
          console.log('Initial labels data:', data);
          console.log('Number of sentences:', data.sentences?.length);
          
          // Create a map of sentence numbers to their rhetorical functions
          const labelsMap = {};
          data.sentences.forEach(sentence => {
            console.log('Processing initial sentence:', sentence);
            if (sentence.rhetorical_function) {
              console.log(`Adding initial label for sentence ${sentence.sentence_number}:`, {
                function: sentence.rhetorical_function,
                relevance: sentence.relevance,
                text: sentence.text
              });
              labelsMap[sentence.sentence_number] = {
                function: sentence.rhetorical_function,
                relevance: sentence.relevance,
                text: sentence.text
              };
            } else {
              console.log(`No initial rhetorical function for sentence ${sentence.sentence_number}`);
            }
          });
          
          console.log('Initial labels map:', labelsMap);
          console.log('Number of initial labels:', Object.keys(labelsMap).length);
          setRhetoricalLabels(labelsMap);
        } catch (error) {
          console.error('Error fetching rhetorical labels:', error);
        }
      }
    };

    fetchRhetoricalLabels();
  }, [pdfInfo?.document_id]);

  const handleGeminiProcess = async () => {
    if (!activatedTexts.length || !pdfInfo.document_id) return;
    
    try {
        setIsProcessing(true);
        console.log('=== STARTING GEMINI PROCESS ===');
        
        // Send document ID to backend for processing
        const response = await fetch(`${API_URL}/process-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                document_id: pdfInfo.document_id
            })
        });

        if (!response.ok) {
            throw new Error('Failed to process text');
        }

        // Fetch updated rhetorical labels from database
        console.log('=== FETCHING UPDATED LABELS ===');
        const labelsResponse = await fetch(`${API_URL}/sentences/${pdfInfo.document_id}`);
        const labelsData = await labelsResponse.json();
        console.log('Raw labels data:', labelsData);
        console.log('Number of sentences in response:', labelsData.sentences.length);

        // Create a map of sentence numbers to their rhetorical functions
        const newLabels = {};
        labelsData.sentences.forEach(sentence => {
            console.log('Processing sentence:', sentence);
            if (sentence.rhetorical_function) {
                console.log(`Adding label for sentence ${sentence.sentence_number}:`, {
                    function: sentence.rhetorical_function,
                    relevance: sentence.relevance,
                    text: sentence.text
                });
                newLabels[sentence.sentence_number] = {
                    function: sentence.rhetorical_function,
                    relevance: sentence.relevance,
                    text: sentence.text
                };
            } else {
                console.log(`No rhetorical function for sentence ${sentence.sentence_number}`);
            }
        });

        console.log('Final labels map:', newLabels);
        console.log('Number of labels:', Object.keys(newLabels).length);
        setRhetoricalLabels(newLabels);
        
    } catch (error) {
        console.error('Error processing text:', error);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAddMarker = useCallback(async (word, pageIndex, blockIndex) => {
    console.log('handleAddMarker called with:', {
      word,
      pageIndex,
      blockIndex,
      pdfInfo,
      pageNumber
    });

    try {
      // Check if we have all required data
      if (!pdfInfo?.document_id || !pageNumber) {
        console.log('Missing required data:', {
          document_id: pdfInfo?.document_id,
          pageNumber
        });
        return;
      }

      // Get the block from the blocks array
      const block = blocks[pageIndex][blockIndex];
      if (!block) {
        console.log('Block not found:', {
          pageIndex,
          blockIndex,
          blocks
        });
        return;
      }

      console.log('Found block:', block);

      // Get the word number from the activated block's word positions
      const activatedBlock = activatedTexts.find(
        item => item.pageIndex === pageIndex && item.blockIndex === block.id
      );
      
      console.log('Found activated block:', activatedBlock);
      console.log('Current sentence starters:', activatedBlock?.word_positions?.filter(w => w.is_sentence_starter));
      
      if (!activatedBlock?.word_positions) {
        console.log('No word positions found in activated block');
        return;
      }

      const wordIndex = activatedBlock.word_positions.findIndex(w => 
        w.bbox.x0 === word.bbox.x0 && 
        w.bbox.y0 === word.bbox.y0 && 
        w.bbox.x1 === word.bbox.x1 && 
        w.bbox.y1 === word.bbox.y1
      );

      console.log('Found word index:', wordIndex);
      console.log('Word positions:', activatedBlock.word_positions);
      console.log('Target word:', word);

      if (wordIndex === -1) {
        console.log('Word not found in activated block');
        return;
      }

      const requestBody = {
        document_id: pdfInfo.document_id,
        page_id: block.page_id,
        block_id: block.block_id,
        word_number: wordIndex + 1
      };

      console.log('Sending request to backend:', requestBody);

      const response = await fetch(`${API_URL}/toggle-sentence-starter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend error response:', errorText);
        throw new Error(`Failed to toggle sentence starter: ${errorText}`);
      }

      const data = await response.json();
      console.log('Backend response:', data);

      if (!data.words || data.words.length === 0) {
        console.error('Backend returned empty words array');
        return;
      }

      // Update activated texts with the new word data
      setActivatedTexts(prev => {
        console.log('Previous activated texts:', prev);
        const updated = prev.map(item => {
          // Find matching words for this block from the backend response
          const blockWords = data.words.filter(w => 
            w.page_id === item.page_id && 
            w.block_id === item.block_id
          );
          
          if (blockWords.length > 0) {
            const updatedWordPositions = item.word_positions.map(w => {
              const updatedWord = blockWords.find(uw => uw.word_number === w.word_number);
              if (updatedWord) {
                const newWord = {
                  ...w,
                  is_sentence_starter: updatedWord.is_sentence_starter,
                  sentence_number: updatedWord.sentence_number
                };
                console.log('Updated word:', {
                  old: w,
                  new: newWord
                });
                return newWord;
              }
              return w;
            });
            console.log('Updated word positions for block:', {
              page_id: item.page_id,
              block_id: item.block_id,
              updatedWordPositions
            });
            return {
              ...item,
              word_positions: updatedWordPositions
            };
          }
          return item;
        });
        console.log('Updated activated texts:', updated);
        return updated;
      });

    } catch (error) {
      console.error('Error in handleAddMarker:', error);
      setError(`Failed to toggle sentence starter: ${error.message}`);
    }
  }, [pdfInfo, pageNumber, blocks, activatedTexts]);

  const handleRemoveMarker = (markerKey) => {
    setCustomMarkers(prev => {
      const newMarkers = { ...prev };
      delete newMarkers[markerKey];
      return newMarkers;
    });
  };

  const handleReinitializeDatabase = async () => {
    if (!window.confirm('Are you sure you want to reinitialize the database? This will delete all existing data.')) {
      return;
    }
    
    setIsReinitializing(true);
    try {
      const response = await fetch('http://localhost:5001/api/reinitialize-db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to reinitialize database');
      }
      
      const data = await response.json();
      alert('Database reinitialized successfully');
      // Refresh the page to clear any cached data
      window.location.reload();
    } catch (error) {
      // console.error('Error reinitializing database:', error);
      alert('Failed to reinitialize database: ' + error.message);
    } finally {
      setIsReinitializing(false);
    }
  };

  const handleSelectDocument = async (document) => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch the PDF file
      const pdfResponse = await fetch(`${API_URL}/pdf/${document.filename}`);
      if (!pdfResponse.ok) {
        throw new Error('Failed to fetch PDF file');
      }
      
      const pdfBlob = await pdfResponse.blob();
      const pdfFile = new File([pdfBlob], document.original_filename, { type: 'application/pdf' });
      
      // Set the file and document info
      setFile(pdfFile);
      setPdfInfo({
        document_id: document.id,
        filename: document.filename,
        original_filename: document.original_filename
      });
      
      // Get blocks and word positions
      const blocksResponse = await fetch(`${API_URL}/blocks/${document.id}`);
      if (!blocksResponse.ok) {
        throw new Error('Failed to fetch blocks and words');
      }
      const data = await blocksResponse.json();
      setBlocks(data.blocks);
      setWordPositions(data.words);
      setShowBlocks(true);
      
      // Reset other state
      setPageNumber(1);
      setActivatedTexts([]);
      setRhetoricalLabels({});
      
      // Close the document browser
      setShowDocumentBrowser(false);
      
    } catch (error) {
      console.error('Error loading document:', error);
      setError('Error loading document: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="root" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div className="App d-flex flex-column vh-100" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <div className="menu-bar p-2 bg-light border-bottom d-flex align-items-center gap-3" style={{ width: '100%' }}>
          <div className="d-flex align-items-center gap-3">
            <input
              type="file"
              onChange={onFileChange}
              accept=".pdf"
              className="form-control"
              disabled={loading}
              style={{ width: 'auto' }}
            />
            <button 
              onClick={() => setShowDocumentBrowser(true)}
              className="btn btn-outline-primary"
              disabled={loading}
            >
              Open Session
            </button>
            {file && (
              <button 
                onClick={handleGeminiProcess}
                disabled={isProcessing || activatedTexts.length === 0}
                className="btn btn-primary"
              >
                {isProcessing ? 'Processing...' : 'Process with Gemini'}
              </button>
            )}
          </div>
          {loading && (
            <div className="d-flex align-items-center">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <span className="ms-2">Uploading and processing PDF...</span>
            </div>
          )}
          {error && (
            <div className="alert alert-danger mb-0 py-1">{error}</div>
          )}
          {numPages && (
            <div className="d-flex align-items-center text-muted small">
              <span>Pages: {visiblePages.size}/{numPages} visible</span>
            </div>
          )}
          <button 
            onClick={handleReinitializeDatabase}
            disabled={isReinitializing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isReinitializing ? 'not-allowed' : 'pointer',
              opacity: isReinitializing ? 0.7 : 1,
            }}
          >
            {isReinitializing ? 'Reinitializing...' : 'Reinitialize Database'}
          </button>
        </div>

        {showDocumentBrowser && (
          <DocumentBrowser 
            onSelectDocument={handleSelectDocument}
            onClose={() => setShowDocumentBrowser(false)}
          />
        )}

        {file && !loading && !error && (
          <div className="main-content">
            {/* Left side - PDF Viewer */}
            <div className="pdf-container" ref={containerRef}>
              <Document 
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={<div className="d-flex justify-content-center p-5"><div className="spinner-border" role="status"><span className="visually-hidden">Loading PDF...</span></div></div>}
                error={<div className="alert alert-danger m-3">Error loading PDF!</div>}
                style={{ width: '100%', height: '100%' }}
              >
                <div className="pdf-pages-container" style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: '100%',
                  height: '100%'
                }}>
                  {Array.from(new Array(numPages), (el, index) => {
                    const pageNum = index + 1;
                    const isVisible = shouldRenderPage(pageNum);
                    
                    return (
                      <div 
                        key={`page_${pageNum}`} 
                        ref={(ref) => {
                          pageRefs.current[pageNum] = ref;
                        }}
                        data-page-number={pageNum}
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'flex',
                          justifyContent: 'center',
                          marginBottom: '0',
                          minHeight: isVisible ? 'auto' : '800px' // Placeholder height for non-visible pages
                        }}
                      >
                        {isVisible ? (
                          <MemoizedPage 
                            pageNumber={pageNum}
                            scale={pageScale}
                            onLoadSuccess={(page) => onPageLoadSuccess(page, index)}
                            onLoadError={onPageLoadError}
                            onRenderSuccess={(page) => {
                              // Use the page's viewport to get the actual rendered dimensions
                              const viewport = page.getViewport({ scale: 1 });
                              const pageElement = page.canvas.parentElement;
                              const actualWidth = pageElement.offsetWidth;
                              setPageScale(actualWidth / viewport.width);
                            }}
                            blocks={blocks}
                            pageIndex={index}
                            onBlockClick={handleBlockClick}
                            activatedTexts={activatedTexts}
                            pageScale={pageScale}
                            rhetoricalLabels={rhetoricalLabels}
                          />
                        ) : (
                          <div 
                            style={{
                              width: '100%',
                              height: '800px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#f8f9fa',
                              border: '1px solid #dee2e6',
                              borderRadius: '4px'
                            }}
                          >
                            <div className="text-muted">
                              Page {pageNum} - Scroll to load
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Document>
            </div>

            {/* Right side - Chat Panel */}
            <div className="right-panel">
              <ChatPanel documentId={pdfInfo?.document_id} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

