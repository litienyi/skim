import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import './App.css'
import { useState, useEffect, memo, useCallback } from 'react'

// Configure the worker to use the local file
pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'

// console.log('=== INITIALIZATION ===')
// console.log('PDF.js version:', pdfjs.version)
// console.log('Worker source:', pdfjs.GlobalWorkerOptions.workerSrc)

const API_URL = 'http://localhost:5001/api'

function BlockOverlay({ blocks, scale, pageNumber }) {
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
      {blocks[pageNumber - 1].map((block) => (
        <div
          key={block.id}
          className="block-box"
          style={{
            position: 'absolute',
            left: `${block.bbox.x0 * scale}px`,
            top: `${block.bbox.y0 * scale}px`,
            width: `${(block.bbox.x1 - block.bbox.x0) * scale}px`,
            height: `${(block.bbox.y1 - block.bbox.y0) * scale}px`,
            border: '2px solid red',
            backgroundColor: block.user_order ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 0, 0, 0.1)',
            pointerEvents: 'auto',
            cursor: 'pointer',
            zIndex: 1001
          }}
          onClick={() => handleBlockClick(pageNumber - 1, block.id - 1)}
          title={`Block ${block.id}: ${block.text}`}
        >
          <span className="block-number">
            {block.user_order ? `#${block.user_order}` : block.id}
          </span>
        </div>
      ))}
    </div>
  );
}

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

  function onDocumentLoadSuccess({ numPages }) {
    // console.log('=== DOCUMENT LOADED SUCCESSFULLY ===');
    // console.log('Number of pages:', numPages);
    setNumPages(numPages);
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

  const handleBlockClick = async (pageIndex, blockIndex) => {
    const block = blocks[pageIndex][blockIndex];
    const isActive = block.user_order !== null;
    console.log('=== HANDLE BLOCK CLICK ===');
    console.log('Initial state:', { pageIndex, blockIndex, isActive, block });

    try {
      // Call the activate-block endpoint
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

      // Update activated texts based on user_order
      const blocksResponse = await fetch(`${API_URL}/blocks/${pdfInfo.document_id}`);
      if (!blocksResponse.ok) {
        throw new Error('Failed to fetch updated blocks');
      }
      const data = await blocksResponse.json();
      console.log('Blocks response:', data);
      setBlocks(data.blocks);
      setWordPositions(data.words);

      // Update activated texts with blocks that have user_order
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
            word_positions: data.words.filter(w => 
              w.page_id === block.page_id && 
              w.block_id === block.block_id
            )
          }))
      );
      console.log('Activated blocks:', activatedBlocks);
      setActivatedTexts(activatedBlocks);

      // Reset sentence numbers
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
      console.log('Updated blocks response:', updatedData);
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
            word_positions: updatedData.words.filter(w => 
              w.page_id === block.page_id && 
              w.block_id === block.block_id
            )
          }))
      );
      console.log('Updated activated blocks:', updatedActivatedBlocks);
      setActivatedTexts(updatedActivatedBlocks);

    } catch (error) {
      console.error('Error handling block click:', error);
    }
  };

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

  const renderBlocks = (pageBlocks, pageIndex) => {
    let lastBlockEnd = 0;
    
    return (
      <>
        {/* Block Overlays */}
        {pageBlocks.map((block, blockIndex) => {
          const blockKey = `${pageIndex}-${blockIndex}`;
          const isActive = block.user_order !== null;
          const activatedBlock = activatedTexts.find(
            item => item.pageIndex === pageIndex && item.blockIndex === block.id
          );

          return (
            <div
              key={`block-${blockKey}`}
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
              onClick={() => handleBlockClick(pageIndex, blockIndex)}
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
                      handleAddMarker(word, pageIndex, blockIndex);
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </>
    );
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

  // Update the renderSentenceMarkers function to use rhetoricalLabels
  const renderSentenceMarkers = useCallback((block, pageIndex, blockIndex) => {
    const activatedBlock = activatedTexts.find(
      item => item.pageIndex === pageIndex && item.blockIndex === block.id
    );
    
    if (!activatedBlock?.word_positions) {
      return null;
    }

    console.log('=== RENDERING SENTENCE MARKERS ===');
    console.log('Current rhetorical labels:', rhetoricalLabels);
    console.log('Number of labels:', Object.keys(rhetoricalLabels).length);

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
        {activatedBlock.word_positions
          .filter(word => word.is_sentence_starter)
          .map((word) => {
            const label = rhetoricalLabels[word.sentence_number];
            console.log(`Rendering marker for sentence ${word.sentence_number}:`, label);
            return (
              <div
                key={`sentence-${word.sentence_number}`}
                className="sentence-marker"
                style={{
                  left: `${word.bbox.x0}px`,
                  top: `${(word.bbox.y0 + word.bbox.y1) / 2 - 8}px`,
                  transform: 'translateX(-13px)'
                }}
              >
                <div className="sentence-marker-circle">
                  {word.sentence_number || '?'}
                </div>
                <div className="sentence-marker-triangle" />
                {label && (
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
                      {label.function} ({label.relevance}%)
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
                      {label.text}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    );
  }, [activatedTexts, pageScale, rhetoricalLabels]);

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

        {file && !loading && !error && (
          <div className="d-flex flex-grow-1" style={{ width: '100%', height: 'calc(100% - 60px)', overflow: 'hidden' }}>
            {/* Left side - PDF Viewer */}
            <div className="pdf-container" style={{ width: '50%', height: '100%', overflowY: 'auto', borderRight: '1px solid #ccc' }}>
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
                  {Array.from(new Array(numPages), (el, index) => (
                    <div key={`page_${index + 1}`} className="page-container position-relative" style={{
                      width: '100%',
                      height: 'auto',
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: '0'
                    }}>
                      <Page 
                        pageNumber={index + 1} 
                        scale={pageScale}
                        onLoadSuccess={(page) => onPageLoadSuccess(page, index)}
                        onLoadError={onPageLoadError}
                        loading={<div className="d-flex justify-content-center p-3"><div className="spinner-border spinner-border-sm" role="status"><span className="visually-hidden">Loading page {index + 1}...</span></div></div>}
                        error={<div className="alert alert-danger m-3">Error loading page {index + 1}!</div>}
                        className="pdf-page"
                        style={{
                          maxWidth: '100%',
                          height: 'auto'
                        }}
                        onRenderSuccess={(page) => {
                          const viewport = page.getViewport({ scale: 1 })
                          setPageScale(viewport.width / page.originalWidth)
                        }}
                      />
                      {blocks && blocks[index] && renderBlocks(blocks[index], index)}
                    </div>
                  ))}
                </div>
              </Document>
            </div>

            {/* Right side - Rhetorical Labels */}
            <div className="rhetorical-labels" style={{ width: '50%', height: '100%', overflowY: 'auto', padding: '20px' }}>
              <h3 className="mb-4">Rhetorical Labels</h3>
              {Object.keys(rhetoricalLabels).length > 0 ? (
                <div className="d-flex flex-column gap-4">
                  {Object.entries(rhetoricalLabels)
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([sentenceNumber, label]) => (
                      <div key={sentenceNumber} className="card">
                        <div className="card-body">
                          <h5 className="card-title">Sentence {sentenceNumber}</h5>
                          <h6 className="card-subtitle mb-2 text-muted">
                            {label.function} ({label.relevance}%)
                          </h6>
                          <p className="card-text">{label.text}</p>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p>No rhetorical labels available. Process the text with Gemini to generate labels.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

