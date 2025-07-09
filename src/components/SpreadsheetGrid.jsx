import React, { useState, useRef, useEffect } from 'react';
import './SpreadsheetGrid.css';

const SpreadsheetGrid = () => {
  const [data, setData] = useState([]);
  const [columnConfigs, setColumnConfigs] = useState([]); // Column configurations: {name, referenceCol, prompt}
  const [selectedCell, setSelectedCell] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null); // For multi-cell selection
  const [selectedCells, setSelectedCells] = useState([]); // For multiple individual cell selection
  const [isSelecting, setIsSelecting] = useState(false); // For drag selection
  const [editingCell, setEditingCell] = useState(null);
  const [editingHeader, setEditingHeader] = useState(null); // For editing column headers
  const [showColumnModal, setShowColumnModal] = useState(false); // For column configuration modal
  const [isLoading, setIsLoading] = useState({});
  const [isProcessing, setIsProcessing] = useState(false); // For batch processing
  const jsonInputRef = useRef(null);
  const gridRef = useRef(null);
  const [showCellModal, setShowCellModal] = useState(false);
  const [cellModalData, setCellModalData] = useState(null); // {rowIndex, colIndex, ...cell}
  const [cellModalValue, setCellModalValue] = useState('');
  const [cellModalIsLoading, setCellModalIsLoading] = useState(false);
  const [newReference, setNewReference] = useState({ quote: '', source: '', context: '', relevance: 100 });
  const [showAddReference, setShowAddReference] = useState(false);

  // Clustering state
  const [showClusteringModal, setShowClusteringModal] = useState(false);
  const [clusteringData, setClusteringData] = useState(null);
  const [clusteringConfig, setClusteringConfig] = useState({
    method: 'kmeans',
    n_clusters: 5,
    eps: 0.3,
    min_samples: 2
  });
  const [isClustering, setIsClustering] = useState(false);
  const [highlightedClusterRows, setHighlightedClusterRows] = useState(new Set());

  // Enhanced clustering state for tabs and multiple analyses
  const [activeTab, setActiveTab] = useState('spreadsheet'); // 'spreadsheet' or 'clustering'
  const [clusteringAnalyses, setClusteringAnalyses] = useState([]); // Array of clustering results
  const [currentAnalysisId, setCurrentAnalysisId] = useState(null);
  const [clusteringTabData, setClusteringTabData] = useState(null); // Data for the clustering tab

  // Resize state
  const [columnWidths, setColumnWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const [isResizing, setIsResizing] = useState(false);
  const [resizeType, setResizeType] = useState(null); // 'column' or 'row'
  const [resizeIndex, setResizeIndex] = useState(null);
  const resizeRef = useRef({ isResizing: false, type: null, index: null });

  // Find/search state
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState([]); // [{rowIndex, colIndex}]
  const [findIndex, setFindIndex] = useState(0);

  // Context menu state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuTarget, setContextMenuTarget] = useState(null); // 'cell' or 'header'
  const [contextMenuCell, setContextMenuCell] = useState(null); // {rowIndex, colIndex}
  const [contextMenuHeader, setContextMenuHeader] = useState(null); // colIndex

  // Clipboard state for copy/paste operations
  const [clipboardData, setClipboardData] = useState(null); // {data: string[][], rows: number, cols: number}

  // Session management state
  const [currentSession, setCurrentSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionDescription, setNewSessionDescription] = useState('');

  // Welcome modal state
  const [showWelcomeModal, setShowWelcomeModal] = useState(true);

  // Loading state
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize with a 100x15 grid (more realistic for a spreadsheet)
  useEffect(() => {
    const rows = 100;
    const cols = 15;
    const initialData = [];
    const initialConfigs = [];
    
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        row.push({
          id: `${String.fromCharCode(65 + j)}${i + 1}`,
          value: '',
          formula: '',
          result: '',
          references: [],
          status: 'empty',
          isCalculating: false
        });
      }
      initialData.push(row);
    }
    
    // Initialize column configurations
    for (let j = 0; j < cols; j++) {
      initialConfigs.push({
        name: String.fromCharCode(65 + j),
        referenceCol: null,
        prompt: ''
      });
    }
    
    console.log('Initializing data with', initialData.length, 'rows and', initialData[0]?.length, 'cols');
    setData(initialData);
    setColumnConfigs(initialConfigs);
    setIsInitialized(true);
  }, []);

  // Handle Ctrl+F at document level to override browser's default find
  useEffect(() => {
    const handleDocumentKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setShowFind(true);
        setTimeout(() => {
          const findInput = document.querySelector('.find-bar-overlay input');
          if (findInput) findInput.focus();
        }, 0);
        return false;
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, []);

  // Load spreadsheet data from JSON
  const handleLoadJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!json.columns || !json.rows) throw new Error('Invalid JSON format');
        setColumnConfigs(json.columns);
        setData(json.rows);
        // Load resize data if available
        if (json.columnWidths) {
          setColumnWidths(json.columnWidths);
        }
        if (json.rowHeights) {
          setRowHeights(json.rowHeights);
        }
      } catch (err) {
        alert('Failed to load JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  };


  const handlePaste = (e) => {
    // If a modal is open and the active element is an input/textarea, let the browser handle it
    if ((showCellModal || showColumnModal) && document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }
    
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    
    if (!pastedText.trim()) return;
    
    // Try to parse as JSON first (for enhanced clipboard data)
    try {
      const jsonData = JSON.parse(pastedText);
      if (jsonData.type === 'skim2_cells' && jsonData.data) {
        // This is enhanced clipboard data with full cell information
        setClipboardData({
          data: jsonData.data.map(row => row.map(cell => cell.value || '')),
          fullData: jsonData.data,
          rows: jsonData.data.length,
          cols: jsonData.data[0]?.length || 0,
          hasFullData: true
        });
        pasteToSelectedArea();
        return;
      }
    } catch (error) {
      // Not JSON data, continue with regular text parsing
    }
    
    // Parse the pasted text into a 2D array
    const lines = pastedText.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;
    
    const clipboardCells = lines.map(line => line.split('\t'));
    
    // Store in internal clipboard (external data, so no full cell data)
    setClipboardData({
      data: clipboardCells,
      rows: clipboardCells.length,
      cols: clipboardCells[0]?.length || 0,
      hasFullData: false // External clipboard data only contains values
    });
    
    // Use the existing paste function
    pasteToSelectedArea();
  };



  const getCellPosition = (cellId) => {
    const col = cellId.match(/[A-Z]+/)[0];
    const row = parseInt(cellId.match(/\d+/)[0]) - 1;
    const colIndex = col.split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
    return [row, colIndex];
  };

  // Selection helper functions
  const isCellInRange = (rowIndex, colIndex, range) => {
    if (!range) return false;
    const { startRow, endRow, startCol, endCol } = range;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    return rowIndex >= minRow && rowIndex <= maxRow && 
           colIndex >= minCol && colIndex <= maxCol;
  };

  const selectAll = () => {
    setSelectedCell(null);
    setSelectedRange({
      startRow: 0,
      endRow: data.length - 1,
      startCol: 0,
      endCol: data[0]?.length - 1
    });
  };

  const selectRow = (rowIndex, e) => {
    const isShiftSelect = e?.shiftKey;
    
    if (isShiftSelect && selectedRange) {
      // Shift+click: extend row selection
      const newRange = {
        startRow: Math.min(selectedRange.startRow, rowIndex),
        endRow: Math.max(selectedRange.endRow, rowIndex),
        startCol: 0,
        endCol: data[0]?.length - 1
      };
      setSelectedRange(newRange);
      setSelectedCell(null);
    } else {
      // Regular click: select single row
      setSelectedCell(null);
      setSelectedRange({
        startRow: rowIndex,
        endRow: rowIndex,
        startCol: 0,
        endCol: data[0]?.length - 1
      });
    }
  };

  const selectColumn = (colIndex, e) => {
    const isShiftSelect = e?.shiftKey;
    
    if (isShiftSelect && selectedRange) {
      // Shift+click: extend column selection
      const newRange = {
        startRow: 0,
        endRow: data.length - 1,
        startCol: Math.min(selectedRange.startCol, colIndex),
        endCol: Math.max(selectedRange.endCol, colIndex)
      };
      setSelectedRange(newRange);
      setSelectedCell(null);
    } else {
      // Regular click: select single column
      setSelectedCell(null);
      setSelectedRange({
        startRow: 0,
        endRow: data.length - 1,
        startCol: colIndex,
        endCol: colIndex
      });
    }
  };

  // Copy selected cells to clipboard
  const copySelectedCells = () => {
    let cellsToCopy = [];
    let fullCellData = []; // Store complete cell objects for internal clipboard
    
    if (selectedCells.length > 0) {
      // Copy multiple individual cells
      // Sort cells by row and column for consistent ordering
      const sortedCells = [...selectedCells].sort((a, b) => {
        if (a.rowIndex !== b.rowIndex) {
          return a.rowIndex - b.rowIndex;
        }
        return a.colIndex - b.colIndex;
      });
      
      // Group cells by row
      const cellsByRow = {};
      const fullCellsByRow = {};
      sortedCells.forEach(cell => {
        if (!cellsByRow[cell.rowIndex]) {
          cellsByRow[cell.rowIndex] = [];
          fullCellsByRow[cell.rowIndex] = [];
        }
        cellsByRow[cell.rowIndex].push(cell);
        fullCellsByRow[cell.rowIndex].push(cell);
      });
      
      // Convert to 2D array format
      Object.keys(cellsByRow).forEach(rowIndex => {
        const rowData = [];
        const fullRowData = [];
        const rowCells = cellsByRow[rowIndex].sort((a, b) => a.colIndex - b.colIndex);
        rowCells.forEach(cell => {
          if (data[cell.rowIndex] && data[cell.rowIndex][cell.colIndex]) {
            rowData.push(data[cell.rowIndex][cell.colIndex].value || '');
            // Store complete cell object for internal clipboard
            fullRowData.push({
              ...data[cell.rowIndex][cell.colIndex],
              id: `${String.fromCharCode(65 + cell.colIndex)}${parseInt(rowIndex) + 1}` // Update ID for new position
            });
          } else {
            rowData.push('');
            fullRowData.push({
              id: `${String.fromCharCode(65 + cell.colIndex)}${parseInt(rowIndex) + 1}`,
              value: '',
              formula: '',
              result: '',
              references: [],
              status: 'empty',
              isCalculating: false
            });
          }
        });
        cellsToCopy.push(rowData);
        fullCellData.push(fullRowData);
      });
    } else if (selectedRange) {
      // Copy range of cells
      const { startRow, endRow, startCol, endCol } = selectedRange;
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);
      
      for (let row = minRow; row <= maxRow; row++) {
        const rowData = [];
        const fullRowData = [];
        for (let col = minCol; col <= maxCol; col++) {
          if (data[row] && data[row][col]) {
            rowData.push(data[row][col].value || '');
            // Store complete cell object for internal clipboard
            fullRowData.push({
              ...data[row][col],
              id: `${String.fromCharCode(65 + col)}${row + 1}` // Update ID for new position
            });
          } else {
            rowData.push('');
            fullRowData.push({
              id: `${String.fromCharCode(65 + col)}${row + 1}`,
              value: '',
              formula: '',
              result: '',
              references: [],
              status: 'empty',
              isCalculating: false
            });
          }
        }
        cellsToCopy.push(rowData);
        fullCellData.push(fullRowData);
      }
    } else if (selectedCell) {
      // Copy single cell
      const { rowIndex, colIndex } = selectedCell;
      if (data[rowIndex] && data[rowIndex][colIndex]) {
        cellsToCopy = [[data[rowIndex][colIndex].value || '']];
        fullCellData = [[{
          ...data[rowIndex][colIndex],
          id: `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}` // Update ID for new position
        }]];
      }
    }
    
    if (cellsToCopy.length > 0) {
      // Convert to clipboard format for external compatibility
      const clipboardText = cellsToCopy.map(row => row.join('\t')).join('\n');
      
      // Create enhanced clipboard data for cross-session compatibility
      const enhancedClipboardData = {
        type: 'skim2_cells',
        data: fullCellData,
        timestamp: new Date().toISOString()
      };
      const enhancedClipboardText = JSON.stringify(enhancedClipboardData);
      
      // Store complete cell data in internal clipboard
      setClipboardData({
        data: cellsToCopy,
        fullData: fullCellData, // Store complete cell objects
        rows: cellsToCopy.length,
        cols: cellsToCopy[0]?.length || 0,
        hasFullData: true // Flag to indicate we have complete cell data
      });
      
      // Copy both formats to system clipboard
      // Try to write both plain text and enhanced data
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([clipboardText], { type: 'text/plain' }),
          'application/json': new Blob([enhancedClipboardText], { type: 'application/json' })
        })
      ]).catch(err => {
        // Fallback to plain text only if ClipboardItem is not supported
        navigator.clipboard.writeText(clipboardText).catch(err2 => {
          console.log('Failed to copy to clipboard:', err2);
        });
      });
    }
  };

  // Paste clipboard data to selected area
  const pasteToSelectedArea = () => {
    if (!clipboardData || !clipboardData.data) return;
    
    let targetRow = 0;
    let targetCol = 0;
    
    if (selectedRange) {
      // Paste to top-left of selected range
      const { startRow, endRow, startCol, endCol } = selectedRange;
      targetRow = Math.min(startRow, endRow);
      targetCol = Math.min(startCol, endCol);
    } else if (selectedCell) {
      // Paste to selected cell
      targetRow = selectedCell.rowIndex;
      targetCol = selectedCell.colIndex;
    } else {
      return; // No selection
    }
    
    const newData = [...data];
    const { data: clipboardCells, fullData: fullCellData, rows: clipRows, cols: clipCols, hasFullData } = clipboardData;
    
    // Ensure grid is large enough
    const maxRowNeeded = targetRow + clipRows - 1;
    const maxColNeeded = targetCol + clipCols - 1;
    const currentRows = newData.length;
    const currentCols = newData[0]?.length || 0;
    
    // Expand rows if needed
    if (maxRowNeeded >= currentRows) {
      for (let i = currentRows; i <= maxRowNeeded; i++) {
        const row = [];
        for (let j = 0; j < Math.max(currentCols, maxColNeeded + 1); j++) {
          row.push({
            id: `${String.fromCharCode(65 + j)}${i + 1}`,
            value: '',
            formula: '',
            result: '',
            references: [],
            status: 'empty',
            isCalculating: false
          });
        }
        newData.push(row);
      }
    }
    
    // Expand columns if needed
    if (maxColNeeded >= currentCols) {
      for (let i = 0; i < newData.length; i++) {
        for (let j = currentCols; j <= maxColNeeded; j++) {
          newData[i].push({
            id: `${String.fromCharCode(65 + j)}${i + 1}`,
            value: '',
            formula: '',
            result: '',
            references: [],
            status: 'empty',
            isCalculating: false
          });
        }
      }
    }
    
    // Paste the data
    for (let row = 0; row < clipRows; row++) {
      for (let col = 0; col < clipCols; col++) {
        const targetRowIndex = targetRow + row;
        const targetColIndex = targetCol + col;
        
        if (newData[targetRowIndex] && newData[targetRowIndex][targetColIndex]) {
          if (hasFullData && fullCellData && fullCellData[row] && fullCellData[row][col]) {
            // Use complete cell data if available (internal clipboard)
            const sourceCell = fullCellData[row][col];
            newData[targetRowIndex][targetColIndex] = {
              ...newData[targetRowIndex][targetColIndex],
              value: sourceCell.value || '',
              formula: sourceCell.formula || '',
              result: sourceCell.result || '',
              references: sourceCell.references || [],
              status: sourceCell.status || (sourceCell.value ? 'filled' : 'empty'),
              isCalculating: sourceCell.isCalculating || false
            };
          } else {
            // Fallback to basic value-only paste (external clipboard)
            newData[targetRowIndex][targetColIndex] = {
              ...newData[targetRowIndex][targetColIndex],
              value: clipboardCells[row][col] || '',
              status: clipboardCells[row][col] ? 'filled' : 'empty'
            };
          }
        }
      }
    }
    
    setData(newData);
  };

  // Delete selected cells
  const deleteSelectedCells = () => {
    if (!selectedRange && !selectedCell && selectedCells.length === 0) return;
    
    const newData = [...data];
    
    if (selectedCells.length > 0) {
      // Delete multiple individual cells
      selectedCells.forEach(cell => {
        const { rowIndex, colIndex } = cell;
        if (newData[rowIndex] && newData[rowIndex][colIndex]) {
          newData[rowIndex][colIndex] = {
            ...newData[rowIndex][colIndex],
            value: '',
            formula: '',
            result: '',
            references: [],
            status: 'empty'
          };
        }
      });
    } else if (selectedRange) {
      // Delete range of cells
      const { startRow, endRow, startCol, endCol } = selectedRange;
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);
      
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (newData[row] && newData[row][col]) {
            newData[row][col] = {
              ...newData[row][col],
              value: '',
              formula: '',
              result: '',
              references: [],
              status: 'empty'
            };
          }
        }
      }
    } else if (selectedCell) {
      // Delete single cell
      const { rowIndex, colIndex } = selectedCell;
      if (newData[rowIndex] && newData[rowIndex][colIndex]) {
        newData[rowIndex][colIndex] = {
          ...newData[rowIndex][colIndex],
          value: '',
          formula: '',
          result: '',
          references: [],
          status: 'empty'
        };
      }
    }
    
    setData(newData);
  };

  const handleCellClick = (rowIndex, colIndex, e) => {
    const isMultiSelect = e.metaKey || e.ctrlKey;
    const isShiftSelect = e.shiftKey;
    

    
    if (isShiftSelect && selectedCell) {
      // Shift+click: select range from current selection to clicked cell
      const startRow = Math.min(selectedCell.rowIndex, rowIndex);
      const endRow = Math.max(selectedCell.rowIndex, rowIndex);
      const startCol = Math.min(selectedCell.colIndex, colIndex);
      const endCol = Math.max(selectedCell.colIndex, colIndex);
      
      setSelectedRange({
        startRow,
        endRow,
        startCol,
        endCol
      });
      setSelectedCell(null);
      setSelectedCells([]);
    } else if (isShiftSelect && selectedRange) {
      // Shift+click with existing range: extend the range
      const newRange = {
        startRow: Math.min(selectedRange.startRow, rowIndex),
        endRow: Math.max(selectedRange.endRow, rowIndex),
        startCol: Math.min(selectedRange.startCol, colIndex),
        endCol: Math.max(selectedRange.endCol, colIndex)
      };
      setSelectedRange(newRange);
      setSelectedCell(null);
      setSelectedCells([]);
    } else if (isMultiSelect) {
      // Ctrl/Cmd+click: add/remove individual cells from selection
      const clickedCell = { rowIndex, colIndex };
      const cellKey = `${rowIndex}-${colIndex}`;
      
      // Check if cell is already selected
      const isAlreadySelected = selectedCells.some(cell => 
        cell.rowIndex === rowIndex && cell.colIndex === colIndex
      );
      
      if (isAlreadySelected) {
        // Remove from selection
        setSelectedCells(selectedCells.filter(cell => 
          !(cell.rowIndex === rowIndex && cell.colIndex === colIndex)
        ));
      } else {
        // Add to selection
        setSelectedCells([...selectedCells, clickedCell]);
      }
      
      // Clear other selection types
      setSelectedCell(null);
      setSelectedRange(null);
    } else {
      // Regular click: single cell selection
      setSelectedCell({ rowIndex, colIndex });
      setSelectedRange(null);
      setSelectedCells([]);
    }
    setEditingCell(null);
  };

  // Open cell modal on double click
  const handleCellDoubleClick = (rowIndex, colIndex) => {
    const cell = data[rowIndex][colIndex];
    setCellModalData({ rowIndex, colIndex, ...cell });
    setCellModalValue(cell.value);
    setShowCellModal(true);
  };

  // Save/overwrite cell value and also references/status from modal
  const handleCellModalSave = () => {
    if (cellModalData) {
      const { rowIndex, colIndex, references } = cellModalData;
      const newData = [...data];
      newData[rowIndex][colIndex] = {
        ...newData[rowIndex][colIndex],
        value: cellModalValue,
        references: references ?? [],
        status: 'filled', // Always set to 'filled' when user saves changes
      };
      setData(newData);
      setShowCellModal(false);
    }
  };

  // Process a specific cell directly (for context menu reprocess)
  const processSpecificCell = async (rowIndex, colIndex) => {
    const config = columnConfigs[colIndex];
    if (!config.prompt || config.referenceCol === null) {
      alert('Column must have a prompt and reference column configured.');
      return;
    }
    const refCol = config.referenceCol;
    const refCell = data[rowIndex][refCol];
    if (!refCell.value.trim()) {
      alert('No data in reference column for this row.');
      return;
    }
    
    // Set loading state for this specific cell
    const loadingData = [...data];
    loadingData[rowIndex][colIndex] = {
      ...loadingData[rowIndex][colIndex],
      isCalculating: true
    };
    setData(loadingData);
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: [{ id: refCell.id, content: refCell.value }],
          question: config.prompt
        })
      });
      if (!response.ok) throw new Error('Analysis failed');
      const result = await response.json();
      const analysis = result.analyses && result.analyses[0];
      if (analysis) {
        const newData = [...data];
        newData[rowIndex][colIndex] = {
          ...newData[rowIndex][colIndex],
          value: analysis.answer || '',
          references: analysis.references || [],
          status: 'calculated',
          isCalculating: false
        };
        setData(newData);
      }
    } catch (e) {
      alert('Error reprocessing cell: ' + e.message);
      // Clear loading state on error
      const errorData = [...data];
      errorData[rowIndex][colIndex] = {
        ...errorData[rowIndex][colIndex],
        status: 'error',
        isCalculating: false
      };
      setData(errorData);
    }
  };

  // Refresh Gemini for this cell only (populate value directly)
  const handleCellModalRefresh = async () => {
    if (!cellModalData) return;
    const { rowIndex, colIndex } = cellModalData;
    const config = columnConfigs[colIndex];
    if (!config.prompt || config.referenceCol === null) {
      alert('Column must have a prompt and reference column configured.');
      return;
    }
    const refCol = config.referenceCol;
    const refCell = data[rowIndex][refCol];
    if (!refCell.value.trim()) {
      alert('No data in reference column for this row.');
      return;
    }
    setCellModalIsLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: [{ id: refCell.id, content: refCell.value }],
          question: config.prompt
        })
      });
      if (!response.ok) throw new Error('Analysis failed');
      const result = await response.json();
      const analysis = result.analyses && result.analyses[0];
      if (analysis) {
        const newData = [...data];
        newData[rowIndex][colIndex] = {
          ...newData[rowIndex][colIndex],
          value: analysis.answer || '',
          references: analysis.references || [],
          status: 'calculated',
          isCalculating: false
        };
        setData(newData);
        setCellModalData({ ...cellModalData, value: analysis.answer || '', references: analysis.references || [], status: 'calculated' });
        setCellModalValue(analysis.answer || '');
      }
    } catch (e) {
      alert('Error refreshing cell: ' + e.message);
    } finally {
      setCellModalIsLoading(false);
    }
  };

  // Drag selection handlers
  const handleMouseDown = (rowIndex, colIndex, e) => {
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Left mouse button only, no modifiers
      setIsSelecting(true);
      setSelectedCell({ rowIndex, colIndex });
      setSelectedRange({
        startRow: rowIndex,
        endRow: rowIndex,
        startCol: colIndex,
        endCol: colIndex
      });
    }
  };

  const handleMouseEnter = (rowIndex, colIndex) => {
    if (isSelecting) {
      setSelectedRange(prev => {
        if (!prev) return null;
        return {
          startRow: prev.startRow,
          endRow: rowIndex,
          startCol: prev.startCol,
          endCol: colIndex
        };
      });
    }
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
  };

  const handleCellChange = (rowIndex, colIndex, value) => {
    const newData = [...data];
    const cell = newData[rowIndex][colIndex];
    
    // Regular value (no formulas allowed in cells)
    cell.value = value;
    cell.formula = '';
    cell.result = '';
    cell.references = [];
    cell.status = value.trim() ? 'filled' : 'empty';
    
    setData(newData);
  };

  // Handle column configuration changes
  const handleColumnConfigChange = (colIndex, config) => {
    const newConfigs = [...columnConfigs];
    newConfigs[colIndex] = { ...newConfigs[colIndex], ...config };
    setColumnConfigs(newConfigs);
  };

  // Open column configuration modal
  const openColumnModal = (colIndex) => {
    setEditingHeader(colIndex);
    setShowColumnModal(true);
  };

  // Process a single column with prompts
  const processSingleColumn = async (colIndex) => {
    if (isProcessing) return;
    
    const config = columnConfigs[colIndex];
    if (!config.prompt.trim() || config.referenceCol === null) {
      alert('Please configure both a prompt and reference column for this column.');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      // Get all non-empty values from the reference column
      const texts = [];
      for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
        const cell = data[rowIndex][config.referenceCol];
        if (cell.value.trim()) {
          texts.push({
            id: cell.id,
            content: cell.value
          });
        }
      }
      
      if (texts.length === 0) {
        alert('No data found in the reference column.');
        return;
      }
      
      // Set loading state for all cells in this column
      const newData = [...data];
      for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
        if (data[rowIndex][colIndex].value.trim()) {
          newData[rowIndex][colIndex] = {
            ...newData[rowIndex][colIndex],
            isCalculating: true
          };
        }
      }
      setData(newData);
      
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            texts: texts,
            question: config.prompt
          })
        });

        if (!response.ok) {
          throw new Error(`Analysis failed for column ${String.fromCharCode(65 + colIndex)}`);
        }

        const result = await response.json();
        
        // Update all cells in this column with results
        const updatedData = [...data];
        if (result.analyses && result.analyses.length > 0) {
          // Create a mapping from text ID to row index for proper result assignment
          const textToRowMap = {};
          for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            const cell = data[rowIndex][config.referenceCol];
            if (cell.value.trim()) {
              textToRowMap[cell.id] = rowIndex;
            }
          }
          
          result.analyses.forEach((analysis, index) => {
            const textId = texts[index]?.id;
            const rowIndex = textToRowMap[textId];
            
            if (rowIndex !== undefined && updatedData[rowIndex] && updatedData[rowIndex][colIndex]) {
              updatedData[rowIndex][colIndex] = {
                ...updatedData[rowIndex][colIndex],
                value: analysis.answer || 'No result',
                references: analysis.references || [],
                status: 'calculated',
                isCalculating: false
              };
            }
          });
        }
        
        setData(updatedData);
        
      } catch (error) {
        console.error(`Error processing column ${String.fromCharCode(65 + colIndex)}:`, error);
        
        // Clear loading state for this column
        const errorData = [...data];
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
          if (data[rowIndex][colIndex].value.trim()) {
            errorData[rowIndex][colIndex] = {
              ...errorData[rowIndex][colIndex],
              status: 'error',
              isCalculating: false
            };
          }
        }
        setData(errorData);
      }
      
    } catch (error) {
      console.error('Column processing error:', error);
      alert('Column processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Batch process all columns with prompts (kept for potential future use)
  const processColumns = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      // Find columns that have prompts and reference columns
      const columnsToProcess = [];
      
      for (let colIndex = 0; colIndex < columnConfigs.length; colIndex++) {
        const config = columnConfigs[colIndex];
        if (!config.prompt.trim() || config.referenceCol === null) continue;
        
        // Get all non-empty values from the reference column
        const texts = [];
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
          const cell = data[rowIndex][config.referenceCol];
          if (cell.value.trim()) {
            texts.push({
              id: cell.id,
              content: cell.value
            });
          }
        }
        
        if (texts.length > 0) {
          columnsToProcess.push({
            colIndex,
            prompt: config.prompt,
            texts
          });
        }
      }
      
      if (columnsToProcess.length === 0) {
        alert('No columns with prompts and data found.');
        return;
      }
      
      // Process each column
      for (const column of columnsToProcess) {
        const { colIndex, prompt, texts } = column;
        
        // Set loading state for all cells in this column
        const newData = [...data];
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
          if (data[rowIndex][colIndex].value.trim()) {
            newData[rowIndex][colIndex] = {
              ...newData[rowIndex][colIndex],
              isCalculating: true
            };
          }
        }
        setData(newData);
        
        try {
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              texts: texts,
              question: prompt
            })
          });

          if (!response.ok) {
            throw new Error(`Analysis failed for column ${String.fromCharCode(65 + colIndex)}`);
          }

          const result = await response.json();
          
          // Update all cells in this column with results
          const updatedData = [...data];
          if (result.analyses && result.analyses.length > 0) {
            // Create a mapping from text ID to row index for proper result assignment
            const textToRowMap = {};
            for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
              const cell = data[rowIndex][config.referenceCol];
              if (cell.value.trim()) {
                textToRowMap[cell.id] = rowIndex;
              }
            }
            
            result.analyses.forEach((analysis, index) => {
              const textId = texts[index]?.id;
              const rowIndex = textToRowMap[textId];
              
              if (rowIndex !== undefined && updatedData[rowIndex] && updatedData[rowIndex][colIndex]) {
                updatedData[rowIndex][colIndex] = {
                  ...updatedData[rowIndex][colIndex],
                  value: analysis.answer || 'No result',
                  references: analysis.references || [],
                  status: 'calculated',
                  isCalculating: false
                };
              }
            });
          }
          
          setData(updatedData);
          
        } catch (error) {
          console.error(`Error processing column ${String.fromCharCode(65 + colIndex)}:`, error);
          
          // Clear loading state for this column
          const errorData = [...data];
          for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            if (data[rowIndex][colIndex].value.trim()) {
              errorData[rowIndex][colIndex] = {
                ...errorData[rowIndex][colIndex],
                status: 'error',
                isCalculating: false
              };
            }
          }
          setData(errorData);
        }
      }
      
    } catch (error) {
      console.error('Batch processing error:', error);
      alert('Batch processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCellKeyDown = (e, rowIndex, colIndex) => {
    // Stop propagation to prevent global handlers from interfering
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditingCell(null);
      
      // Move to next cell
      if (rowIndex < data.length - 1) {
        setSelectedCell({ rowIndex: rowIndex + 1, colIndex });
        setEditingCell({ rowIndex: rowIndex + 1, colIndex });
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setEditingCell(null);
      
      // Move to next column
      if (colIndex < data[0].length - 1) {
        setSelectedCell({ rowIndex, colIndex: colIndex + 1 });
        setEditingCell({ rowIndex, colIndex: colIndex + 1 });
      }
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const handleGlobalKeyDown = (e) => {
    // Don't handle keys when modals are open or if an input/textarea is focused
    if ((showColumnModal || showCellModal) || (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA'))) {
      return;
    }
    
    // Handle global keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'v':
          // Ctrl+V is handled by onPaste event
          break;
        case 'c':
          // Copy selected cells
          e.preventDefault();
          copySelectedCells();
          break;
        case 'x':
          // Cut selected cells (copy then delete)
          e.preventDefault();
          copySelectedCells();
          deleteSelectedCells();
          break;
        case 'a':
          // Select all
          e.preventDefault();
          selectAll();
          break;
        case 'z':
          // Undo functionality could be added here
          break;
        case 'y':
          // Redo functionality could be added here
          break;
        default:
          break;
      }
    } else {
      // Handle arrow key navigation
      if (selectedCell && !editingCell) {
        let newRow = selectedCell.rowIndex;
        let newCol = selectedCell.colIndex;
        
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            newRow = Math.max(0, selectedCell.rowIndex - 1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            newRow = selectedCell.rowIndex + 1;
            // Expand grid if navigating beyond current bounds
            if (newRow >= data.length) {
              const currentRows = data.length;
              const currentCols = data[0]?.length || 0;
              const targetRows = newRow + 10;
              
              let newData = [...data];
              
              // Add new rows
              for (let i = currentRows; i < targetRows; i++) {
                const row = [];
                for (let j = 0; j < currentCols; j++) {
                  row.push({
                    id: `${String.fromCharCode(65 + j)}${i + 1}`,
                    value: '',
                    formula: '',
                    result: '',
                    references: [],
                    status: 'empty',
                    isCalculating: false
                  });
                }
                newData.push(row);
              }
              
              setData(newData);
            }
            newRow = Math.min(data.length - 1, newRow);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            newCol = Math.max(0, selectedCell.colIndex - 1);
            break;
          case 'ArrowRight':
            e.preventDefault();
            newCol = selectedCell.colIndex + 1;
            // Expand grid if navigating beyond current bounds
            if (newCol >= data[0].length) {
              const currentRows = data.length;
              const currentCols = data[0]?.length || 0;
              const targetCols = newCol + 2;
              
              let newData = [...data];
              
              // Expand existing rows with new columns
              for (let i = 0; i < currentRows; i++) {
                for (let j = currentCols; j < targetCols; j++) {
                  newData[i].push({
                    id: `${String.fromCharCode(65 + j)}${i + 1}`,
                    value: '',
                    formula: '',
                    result: '',
                    references: [],
                    status: 'empty',
                    isCalculating: false
                  });
                }
              }
              
              setData(newData);
            }
            newCol = Math.min(data[0].length - 1, newCol);
            break;
          case 'Delete':
          case 'Backspace':
            e.preventDefault();
            deleteSelectedCells();
            break;
          default:
            // If it's a printable character, start editing
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
              setEditingCell(selectedCell);
            }
            break;
        }
        
        if (newRow !== selectedCell.rowIndex || newCol !== selectedCell.colIndex) {
          setSelectedCell({ rowIndex: newRow, colIndex: newCol });
        }
      }
    }
  };

  const handleCellBlur = () => {
    setEditingCell(null);
  };

  const downloadAsJSON = () => {
    // Prepare a serializable version of the data
    const exportData = {
      columns: columnConfigs,
      rows: data.map(row => row.map(cell => ({
        id: cell.id,
        value: cell.value,
        formula: cell.formula,
        result: cell.result,
        references: cell.references,
        status: cell.status
      }))),
      columnWidths: columnWidths,
      rowHeights: rowHeights
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skim2_spreadsheet.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };



  const getColumnHeaders = () => {
    const headers = [];
    const numCols = data[0]?.length || 15; // Default to 15 columns if data is empty
    for (let i = 0; i < numCols; i++) {
      headers.push(String.fromCharCode(65 + i));
    }
    return headers;
  };

  const getDisplayValue = (cell) => {
    // Just show the value (Gemini answer or user-edited)
    return cell.value || '';
  };

  const getCellClassName = (cell, rowIndex, colIndex) => {
    const isSelected = selectedCell?.rowIndex === rowIndex && selectedCell?.colIndex === colIndex;
    const isInRange = isCellInRange(rowIndex, colIndex, selectedRange);
    const isInMultiSelect = selectedCells.some(cell => 
      cell.rowIndex === rowIndex && cell.colIndex === colIndex
    );
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex;
    
    let className = 'cell';
    if (isSelected) className += ' selected';
    if (isInRange) className += ' in-range';
    if (isInMultiSelect) className += ' multi-selected';
    if (isEditing) className += ' editing';
    if (cell.status === 'calculated') className += ' calculated';
    if (cell.status === 'error') className += ' error';
    // Highlight find match
    if (findMatches.length > 0 && findMatches[findIndex]?.rowIndex === rowIndex && findMatches[findIndex]?.colIndex === colIndex) {
      className += ' find-match';
    }
    // Highlight cluster rows
    if (highlightedClusterRows.has(rowIndex)) {
      className += ' cluster-highlighted';
    }
    
    return className;
  };

  const handleAddReference = () => {
    if (!cellModalData) return;
    const { quote, source, context, relevance } = newReference;
    if (!quote.trim()) {
      alert('Quote is required.');
      return;
    }
    const updatedRefs = [
      ...(cellModalData.references || []),
      { quote, source, context, relevance: Number(relevance) || 0 }
    ];
    setCellModalData({ ...cellModalData, references: updatedRefs });
    setNewReference({ quote: '', source: '', context: '', relevance: 100 });
    setShowAddReference(false);
  };

  const handleDeleteReference = (idx) => {
    if (!cellModalData) return;
    const updatedRefs = (cellModalData.references || []).filter((_, i) => i !== idx);
    setCellModalData({ ...cellModalData, references: updatedRefs });
  };

  // Find all matches for the current query
  const updateFindMatches = (query) => {
    if (!query) {
      setFindMatches([]);
      setFindIndex(0);
      return;
    }
    const matches = [];
    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      for (let colIndex = 0; colIndex < data[rowIndex].length; colIndex++) {
        const cell = data[rowIndex][colIndex];
        if ((cell.value || '').toLowerCase().includes(query.toLowerCase())) {
          matches.push({ rowIndex, colIndex });
        }
      }
    }
    setFindMatches(matches);
    setFindIndex(0);
    if (matches.length > 0) {
      setSelectedCell(matches[0]);
      // Scroll to the found cell
      setTimeout(() => {
        const cellId = `${matches[0].rowIndex}-${matches[0].colIndex}`;
        const el = document.getElementById(`cell-${cellId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }, 0);
    }
  };

  // Handle find input change
  const handleFindChange = (e) => {
    setFindQuery(e.target.value);
    updateFindMatches(e.target.value);
  };

  // Go to next/previous match
  const gotoFindMatch = (dir) => {
    if (findMatches.length === 0) return;
    let newIndex = findIndex + dir;
    if (newIndex < 0) newIndex = findMatches.length - 1;
    if (newIndex >= findMatches.length) newIndex = 0;
    setFindIndex(newIndex);
    setSelectedCell(findMatches[newIndex]);
    // Scroll to the found cell
    setTimeout(() => {
      const cellId = `${findMatches[newIndex].rowIndex}-${findMatches[newIndex].colIndex}`;
      const el = document.getElementById(`cell-${cellId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 0);
  };

  // Clear find
  const clearFind = () => {
    setShowFind(false);
    setFindQuery('');
    setFindMatches([]);
    setFindIndex(0);
  };

  // Handle right-click context menu
  const handleContextMenu = (e, target, data = null) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuTarget(target);
    
    if (target === 'cell') {
      setContextMenuCell(data);
    } else if (target === 'header') {
      setContextMenuHeader(data);
    }
    
    setShowContextMenu(true);
  };

  // Close context menu
  const closeContextMenu = () => {
    setShowContextMenu(false);
    setContextMenuTarget(null);
    setContextMenuCell(null);
    setContextMenuHeader(null);
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showContextMenu && !e.target.closest('.context-menu')) {
        closeContextMenu();
      }
    };

    if (showContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [showContextMenu]);

  // Context menu actions
  const handleReprocessCell = () => {
    if (contextMenuCell) {
      const { rowIndex, colIndex } = contextMenuCell;
      // Directly process the specific cell without opening modal
      processSpecificCell(rowIndex, colIndex);
    }
    closeContextMenu();
  };

  const handleEditCell = () => {
    if (contextMenuCell) {
      const { rowIndex, colIndex } = contextMenuCell;
      handleCellDoubleClick(rowIndex, colIndex);
    }
    closeContextMenu();
  };

  const handleEditHeader = () => {
    if (contextMenuHeader !== null) {
      openColumnModal(contextMenuHeader);
    }
    closeContextMenu();
  };

  const handleClustering = () => {
    openClusteringModal();
    closeContextMenu();
  };

  // Clustering functions
  const openClusteringModal = () => {
    // Get selected texts from the current selection
    let textsToCluster = [];
    
    if (selectedCells.length > 0) {
      // Use multiple selected cells
      selectedCells.forEach(cell => {
        const { rowIndex, colIndex } = cell;
        if (data[rowIndex] && data[rowIndex][colIndex] && data[rowIndex][colIndex].value.trim()) {
          textsToCluster.push({
            id: rowIndex * 1000 + colIndex, // Create unique ID
            content: data[rowIndex][colIndex].value
          });
        }
      });
    } else if (selectedRange) {
      // Use range selection
      const { startRow, endRow, startCol, endCol } = selectedRange;
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);
      
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (data[row] && data[row][col] && data[row][col].value.trim()) {
            textsToCluster.push({
              id: row * 1000 + col,
              content: data[row][col].value
            });
          }
        }
      }
    } else if (selectedCell) {
      // Use single selected cell
      const { rowIndex, colIndex } = selectedCell;
      if (data[rowIndex] && data[rowIndex][colIndex] && data[rowIndex][colIndex].value.trim()) {
        textsToCluster.push({
          id: rowIndex * 1000 + colIndex,
          content: data[rowIndex][colIndex].value
        });
      }
    }
    
    if (textsToCluster.length === 0) {
      alert('Please select cells with text content to cluster.');
      return;
    }
    
    if (textsToCluster.length < 2) {
      alert('Please select at least 2 cells with text content to perform clustering.');
      return;
    }
    
    setClusteringData({ texts: textsToCluster });
    setShowClusteringModal(true);
  };

  const performClustering = async () => {
    if (!clusteringData || !clusteringData.texts) {
      alert('No data available for clustering.');
      return;
    }
    
    setIsClustering(true);
    
    try {
      const response = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: clusteringData.texts,
          method: clusteringConfig.method,
          n_clusters: clusteringConfig.n_clusters,
          eps: clusteringConfig.eps,
          min_samples: clusteringConfig.min_samples
        })
      });
      
      if (!response.ok) {
        throw new Error('Clustering failed');
      }
      
      const result = await response.json();
      setClusteringData({ ...clusteringData, clusters: result.clusters, parameters: result.parameters });
      
    } catch (error) {
      alert('Error performing clustering: ' + error.message);
    } finally {
      setIsClustering(false);
    }
  };

  // Enhanced clustering functions
  const performEnhancedClustering = async () => {
    if (!clusteringData || !clusteringData.texts) {
      alert('No data available for clustering.');
      return;
    }
    
    setIsClustering(true);
    
    try {
      const response = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: clusteringData.texts,
          method: clusteringConfig.method,
          n_clusters: clusteringConfig.n_clusters,
          eps: clusteringConfig.eps,
          min_samples: clusteringConfig.min_samples
        })
      });
      
      if (!response.ok) {
        throw new Error('Clustering failed');
      }
      
      const result = await response.json();
      
      // Create new analysis with unique ID
      const analysisId = Date.now().toString();
      const newAnalysis = {
        id: analysisId,
        timestamp: new Date().toISOString(),
        config: { ...clusteringConfig },
        data: { ...clusteringData, clusters: result.clusters, parameters: result.parameters },
        name: `Analysis ${clusteringAnalyses.length + 1} - ${clusteringConfig.method.toUpperCase()}`
      };
      
      // Add to analyses array
      setClusteringAnalyses(prev => [...prev, newAnalysis]);
      setCurrentAnalysisId(analysisId);
      
      // Switch to clustering tab
      setActiveTab('clustering');
      setClusteringTabData(newAnalysis);
      
      // Close modal
      setShowClusteringModal(false);
      
    } catch (error) {
      alert('Error performing clustering: ' + error.message);
    } finally {
      setIsClustering(false);
    }
  };

  const switchToClusteringTab = (analysisId = null) => {
    if (analysisId) {
      const analysis = clusteringAnalyses.find(a => a.id === analysisId);
      if (analysis) {
        setCurrentAnalysisId(analysisId);
        setClusteringTabData(analysis);
      }
    } else if (clusteringAnalyses.length > 0) {
      const latestAnalysis = clusteringAnalyses[clusteringAnalyses.length - 1];
      setCurrentAnalysisId(latestAnalysis.id);
      setClusteringTabData(latestAnalysis);
    }
    setActiveTab('clustering');
  };

  const deleteClusteringAnalysis = (analysisId) => {
    setClusteringAnalyses(prev => prev.filter(a => a.id !== analysisId));
    
    // If we're deleting the current analysis, switch to another one or back to spreadsheet
    if (currentAnalysisId === analysisId) {
      const remainingAnalyses = clusteringAnalyses.filter(a => a.id !== analysisId);
      if (remainingAnalyses.length > 0) {
        const latestAnalysis = remainingAnalyses[remainingAnalyses.length - 1];
        setCurrentAnalysisId(latestAnalysis.id);
        setClusteringTabData(latestAnalysis);
      } else {
        setActiveTab('spreadsheet');
        setCurrentAnalysisId(null);
        setClusteringTabData(null);
      }
    }
  };

  const createNewClusteringAnalysis = () => {
    // Reset clustering data and config
    setClusteringData(null);
    setClusteringConfig({
      method: 'kmeans',
      n_clusters: 5,
      eps: 0.3,
      min_samples: 2
    });
    
    // Open clustering modal
    setShowClusteringModal(true);
  };

  // Resize functions
  const getColumnWidth = (colIndex) => {
    return columnWidths[colIndex] || 140; // Default width
  };

  const getRowHeight = (rowIndex) => {
    return rowHeights[rowIndex] || 36; // Default height
  };

  const handleColumnResizeStart = (e, colIndex) => {
    console.log('Column resize start:', colIndex);
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = getColumnWidth(colIndex);
    
    // Set ref and state
    resizeRef.current = { isResizing: true, type: 'column', index: colIndex };
    setIsResizing(true);
    setResizeType('column');
    setResizeIndex(colIndex);
    
    const handleMouseMove = (e) => {
      if (!resizeRef.current.isResizing) return;
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX); // Minimum width of 50px
      console.log('Column resize move:', colIndex, 'new width:', newWidth);
      setColumnWidths(prev => ({ ...prev, [colIndex]: newWidth }));
    };
    
    const handleMouseUp = () => {
      console.log('Column resize end:', colIndex);
      resizeRef.current = { isResizing: false, type: null, index: null };
      setIsResizing(false);
      setResizeType(null);
      setResizeIndex(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleRowResizeStart = (e, rowIndex) => {
    console.log('Row resize start:', rowIndex);
    e.preventDefault();
    e.stopPropagation();
    
    const startY = e.clientY;
    const startHeight = getRowHeight(rowIndex);
    
    // Set ref and state
    resizeRef.current = { isResizing: true, type: 'row', index: rowIndex };
    setIsResizing(true);
    setResizeType('row');
    setResizeIndex(rowIndex);
    
    const handleMouseMove = (e) => {
      if (!resizeRef.current.isResizing) return;
      const deltaY = e.clientY - startY;
      const newHeight = Math.max(20, startHeight + deltaY); // Minimum height of 20px
      console.log('Row resize move:', rowIndex, 'new height:', newHeight);
      setRowHeights(prev => ({ ...prev, [rowIndex]: newHeight }));
    };
    
    const handleMouseUp = () => {
      console.log('Row resize end:', rowIndex);
      resizeRef.current = { isResizing: false, type: null, index: null };
      setIsResizing(false);
      setResizeType(null);
      setResizeIndex(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Global mouse move handler to prevent text selection during resize
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (resizeRef.current.isResizing) {
        e.preventDefault();
        document.body.style.userSelect = 'none';
        document.body.style.cursor = resizeRef.current.type === 'column' ? 'col-resize' : 'row-resize';
      } else {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, resizeType]);

  // Session management functions
  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const result = await response.json();
        setSessions(result.sessions);
      } else {
        console.error('Failed to load sessions');
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const handleWelcomeNewSession = () => {
    setShowWelcomeModal(false);
    setShowSessionModal(true);
  };

  const handleWelcomeOpenSession = () => {
    setShowWelcomeModal(false);
    setShowSessionList(true);
  };

  const handleWelcomeSkip = () => {
    setShowWelcomeModal(false);
  };

  const createSession = async () => {
    if (!newSessionName.trim()) {
      alert('Session name is required');
      return;
    }

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newSessionName.trim(),
          description: newSessionDescription.trim()
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setCurrentSession(result.session);
        setSessions([result.session, ...sessions]);
        setShowSessionModal(false);
        setShowWelcomeModal(false);
        setNewSessionName('');
        setNewSessionDescription('');
        
        // Auto-save current data to new session
        await saveSessionData(result.session.id);
      } else {
        const error = await response.json();
        alert('Failed to create session: ' + error.error);
      }
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Failed to create session');
    }
  };

  const loadSession = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/load`);
      if (response.ok) {
        const result = await response.json();
        
        // Convert column configs from object to array format
        const configsArray = [];
        for (let i = 0; i < 15; i++) {
          configsArray[i] = result.columnConfigs[i] || {
            name: String.fromCharCode(65 + i),
            referenceCol: null,
            prompt: ''
          };
        }
        
        setData(result.data);
        setColumnConfigs(configsArray);
        
        // Set current session
        const sessionResponse = await fetch(`/api/sessions/${sessionId}`);
        if (sessionResponse.ok) {
          const sessionResult = await sessionResponse.json();
          setCurrentSession(sessionResult.session);
        }
        
        setShowSessionList(false);
        setShowWelcomeModal(false);
      } else {
        const error = await response.json();
        alert('Failed to load session: ' + error.error);
      }
    } catch (error) {
      console.error('Error loading session:', error);
      alert('Failed to load session');
    }
  };

  const saveSessionData = async (sessionId = null) => {
    const targetSessionId = sessionId || currentSession?.id;
    if (!targetSessionId) {
      alert('No session selected');
      return;
    }

    try {
      // Convert column configs from array to object format for backend
      const configsObject = {};
      columnConfigs.forEach((config, index) => {
        if (config) {
          configsObject[index] = config;
        }
      });

      const response = await fetch(`/api/sessions/${targetSessionId}/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: data,
          columnConfigs: configsObject
        }),
      });

      if (response.ok) {
        // Update sessions list to reflect the change
        await loadSessions();
      } else {
        const error = await response.json();
        alert('Failed to save session: ' + error.error);
      }
    } catch (error) {
      console.error('Error saving session:', error);
      alert('Failed to save session');
    }
  };

  const deleteSession = async (sessionId) => {
    if (!confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Remove from sessions list
        setSessions(sessions.filter(s => s.id !== sessionId));
        
        // If this was the current session, clear it
        if (currentSession?.id === sessionId) {
          setCurrentSession(null);
        }
      } else {
        const error = await response.json();
        alert('Failed to delete session: ' + error.error);
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session');
    }
  };

  // Load sessions on component mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Keep welcome modal visible until user takes action
  // The modal will only be hidden by explicit user actions

  // Prevent text selection during resize
  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = resizeType === 'column' ? 'col-resize' : 'row-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, resizeType]);

  return (
    <div 
      className="spreadsheet-container"
      onPaste={handlePaste}
      onKeyDown={handleGlobalKeyDown}
      onMouseUp={handleMouseUp}
      onContextMenu={closeContextMenu}
      tabIndex={0}
    >
      <div className="toolbar">
        <div className="file-upload">
          <input
            type="file"
            accept=".json"
            onChange={handleLoadJSON}
            ref={jsonInputRef}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => jsonInputRef.current?.click()}
            className="toolbar-btn"
          >
            Load JSON
          </button>
          <button onClick={downloadAsJSON} className="toolbar-btn">
            Download JSON
          </button>
        </div>

        <div className="session-management">
          <button 
            onClick={() => setShowSessionModal(true)} 
            className="toolbar-btn"
            style={{ background: '#28a745' }}
          >
            New Session
          </button>
          <button 
            onClick={() => setShowSessionList(true)} 
            className="toolbar-btn"
            style={{ background: '#007bff' }}
          >
            Open Session
          </button>
          {currentSession && (
            <>
              <button 
                onClick={() => saveSessionData()} 
                className="toolbar-btn"
                style={{ background: '#ffc107', color: '#000' }}
              >
                Save Session
              </button>
              <span style={{ margin: '0 10px', color: '#666' }}>
                Current: {currentSession.name}
              </span>
            </>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="tab-navigation">
          <button 
            onClick={() => setActiveTab('spreadsheet')}
            className={`tab-btn ${activeTab === 'spreadsheet' ? 'active' : ''}`}
          >
            Spreadsheet
          </button>
          <button 
            onClick={() => switchToClusteringTab()}
            className={`tab-btn ${activeTab === 'clustering' ? 'active' : ''}`}
            disabled={clusteringAnalyses.length === 0}
          >
            Clustering Analysis
            {clusteringAnalyses.length > 0 && (
              <span className="tab-badge">{clusteringAnalyses.length}</span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'spreadsheet' && (
        <div className="spreadsheet-wrapper" ref={gridRef}>
          {showFind && (
            <div className="find-bar-overlay" style={{ 
              position: 'fixed', 
              top: 10, 
              right: 10, 
              zIndex: 100,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: 8,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <input
                type="text"
                value={findQuery}
                onChange={handleFindChange}
                placeholder="Find..."
                autoFocus
                style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', fontSize: 14, minWidth: 120 }}
              />
              <span style={{ fontSize: 13, color: '#555', whiteSpace: 'nowrap' }}>
                {findMatches.length > 0 ? `${findIndex + 1} of ${findMatches.length}` : 'No matches'}
              </span>
              <button onClick={() => gotoFindMatch(-1)} className="toolbar-btn" disabled={findMatches.length === 0} style={{ padding: '2px 8px' }}>↑</button>
              <button onClick={() => gotoFindMatch(1)} className="toolbar-btn" disabled={findMatches.length === 0} style={{ padding: '2px 8px' }}>↓</button>
              <button onClick={clearFind} className="toolbar-btn" style={{ background: '#6c757d' }}>×</button>
            </div>
          )}
          <div 
            className="spreadsheet-grid"
            tabIndex={0}
            onKeyDown={(e) => {
              // Prevent browser's default Ctrl+F/Cmd+F
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                e.stopPropagation();
                setShowFind(true);
                setTimeout(() => {
                  const findInput = document.querySelector('.find-bar-overlay input');
                  if (findInput) findInput.focus();
                }, 0);
              }
            }}
          >
          {/* Column headers */}
          <div className="header-row">
            <div className="corner-cell" onClick={selectAll} title="Select All (Ctrl+A)"></div>
            {getColumnHeaders().map((header, index) => (
              <div 
                key={header} 
                className="header-cell"
                style={{ width: getColumnWidth(index) }}
                onClick={(e) => selectColumn(index, e)}
                onContextMenu={(e) => handleContextMenu(e, 'header', index)}
                title={`Select Column ${header}`}
              >
                <span className="header-text">{header}</span>
                <button 
                  className="header-config-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    openColumnModal(index);
                  }}
                  title={`Configure Column ${header}`}
                >
                  ⋯
                </button>
                <div 
                  className={`resize-handle ${resizeType === 'column' && resizeIndex === index ? 'resizing' : ''}`}
                  onMouseDown={(e) => handleColumnResizeStart(e, index)}
                />
              </div>
            ))}
          </div>



          {/* Data rows */}
          {!isInitialized ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
              Loading spreadsheet...
            </div>
          ) : (
            data.map((row, rowIndex) => (
            <div key={rowIndex} className="data-row" style={{ height: getRowHeight(rowIndex) }}>
              {/* Row header */}
              <div 
                className="row-header"
                style={{ height: getRowHeight(rowIndex) }}
                onClick={(e) => selectRow(rowIndex, e)}
                title={`Select Row ${rowIndex + 1}`}
              >
                {rowIndex + 1}
                <div 
                  className={`resize-handle ${resizeType === 'row' && resizeIndex === rowIndex ? 'resizing' : ''}`}
                  onMouseDown={(e) => handleRowResizeStart(e, rowIndex)}
                />
              </div>

              {/* Data cells */}
              {row.map((cell, colIndex) => (
                <div
                  key={cell.id}
                  id={`cell-${rowIndex}-${colIndex}`}
                  className={getCellClassName(cell, rowIndex, colIndex)}
                  style={{ 
                    width: getColumnWidth(colIndex),
                    height: getRowHeight(rowIndex)
                  }}
                  onClick={(e) => handleCellClick(rowIndex, colIndex, e)}
                  onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
                  onMouseDown={(e) => {
                    // Only handle mouse down for drag selection (no modifiers)
                    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      handleMouseDown(rowIndex, colIndex, e);
                    }
                  }}
                  onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                  onMouseUp={handleMouseUp}
                  onContextMenu={(e) => handleContextMenu(e, 'cell', { rowIndex, colIndex })}
                >
                  {editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex ? (
                    <input
                      type="text"
                      value={cell.value}
                      onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, colIndex)}
                      onBlur={handleCellBlur}
                      autoFocus
                      className="cell-input"
                    />
                  ) : (
                    <div className="cell-content">
                      {getDisplayValue(cell)}
                      {cell.isCalculating && <div className="loading-spinner"></div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Column Configuration Modal */}
      {showColumnModal && editingHeader !== null && (
        <div className="modal-overlay" onClick={() => setShowColumnModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ zIndex: 1002 }}>
            <div className="modal-header">
              <h3>Column Configuration - {String.fromCharCode(65 + editingHeader)}</h3>
              <button onClick={() => setShowColumnModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="config-section">
                <label>
                  <strong>Column Display Name:</strong>
                  <input
                    type="text"
                    value={columnConfigs[editingHeader]?.name || ''}
                    onChange={(e) => handleColumnConfigChange(editingHeader, { name: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Enter descriptive name for this column..."
                    className="config-input"
                  />
                </label>
              </div>
              <div className="config-section">
                <label>
                  <strong>Source Column for Analysis:</strong>
                  <select
                    value={columnConfigs[editingHeader]?.referenceCol ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      const referenceCol = value === '' ? null : parseInt(value);
                      handleColumnConfigChange(editingHeader, { referenceCol });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="config-input"
                  >
                    <option value="">Choose source column for analysis...</option>
                    {getColumnHeaders().map((header, index) => (
                      <option key={header} value={index}>
                        Column {header} - {columnConfigs[index]?.name || 'Unnamed Column'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="config-section">
                <label>
                  <strong>Analysis Instructions:</strong>
                  <textarea
                    value={columnConfigs[editingHeader]?.prompt || ''}
                    onChange={(e) => handleColumnConfigChange(editingHeader, { prompt: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Enter specific instructions for AI analysis of the source data..."
                    className="config-textarea"
                    rows={4}
                  />
                </label>
              </div>
              <div className="config-actions">
                <button 
                  onClick={() => setShowColumnModal(false)}
                  className="toolbar-btn"
                >
                  Save Settings
                </button>
                <button 
                  onClick={() => processSingleColumn(editingHeader)}
                  className="toolbar-btn refresh-btn"
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Process Column'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cell Modal for editing and refreshing single cell */}
      {showCellModal && cellModalData && (
        <div className="modal-overlay" onClick={() => setShowCellModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ zIndex: 1003, minWidth: 400 }}>
            <div className="modal-header">
              <h3>Edit Cell {cellModalData.id}</h3>
              <button onClick={() => setShowCellModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="config-section">
                <label>
                  <strong>Cell Value:</strong>
                  <textarea
                    value={cellModalValue}
                    onChange={e => setCellModalValue(e.target.value)}
                    className="config-textarea cell-modal-textarea"
                    style={{ minHeight: 60, maxHeight: 300, resize: 'vertical', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    rows={4}
                  />
                </label>
              </div>
              <div className="config-section">
                <label>
                  <strong>Status:</strong> {cellModalData.status}
                </label>
              </div>
              <div className="config-section">
                <label>
                  <strong>References:</strong>
                  {cellModalData.references && cellModalData.references.length > 0 ? (
                    <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none' }}>
                      {cellModalData.references.map((ref, i) => (
                        <li key={i} style={{ marginBottom: 8, fontSize: 13, position: 'relative', background: '#f8f9fa', borderRadius: 4, padding: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span><strong>Quote:</strong> "{ref.quote}"</span>
                            <button onClick={() => handleDeleteReference(i)} style={{ background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: 16, marginLeft: 8 }} title="Delete Reference">×</button>
                          </div>
                          <div><strong>Source:</strong> {ref.source}</div>
                          <div><strong>Context:</strong> {ref.context}</div>
                          <div><strong>Relevance:</strong> {ref.relevance}/100</div>
                        </li>
                      ))}
                    </ul>
                  ) : <span style={{ color: '#aaa' }}>(No references)</span>}
                </label>
                <div style={{ marginTop: 8 }}>
                  {showAddReference ? (
                    <div style={{ background: '#f1f3f4', borderRadius: 4, padding: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        placeholder="Quote*"
                        value={newReference.quote}
                        onChange={e => setNewReference({ ...newReference, quote: e.target.value })}
                        style={{ width: '100%', marginBottom: 4, padding: 4 }}
                      />
                      <input
                        type="text"
                        placeholder="Source"
                        value={newReference.source}
                        onChange={e => setNewReference({ ...newReference, source: e.target.value })}
                        style={{ width: '100%', marginBottom: 4, padding: 4 }}
                      />
                      <input
                        type="text"
                        placeholder="Context"
                        value={newReference.context}
                        onChange={e => setNewReference({ ...newReference, context: e.target.value })}
                        style={{ width: '100%', marginBottom: 4, padding: 4 }}
                      />
                      <input
                        type="number"
                        placeholder="Relevance (1-100)"
                        value={newReference.relevance}
                        min={1}
                        max={100}
                        onChange={e => setNewReference({ ...newReference, relevance: e.target.value })}
                        style={{ width: '100%', marginBottom: 4, padding: 4 }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button onClick={handleAddReference} className="toolbar-btn" style={{ flex: 1 }}>Add</button>
                        <button onClick={() => setShowAddReference(false)} className="toolbar-btn" style={{ flex: 1, background: '#6c757d' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowAddReference(true)} className="toolbar-btn" style={{ marginTop: 4 }}>
                      Add Reference
                    </button>
                  )}
                </div>
              </div>
              <div className="config-actions">
                <button
                  onClick={handleCellModalSave}
                  className="toolbar-btn"
                  disabled={cellModalIsLoading}
                >
                  Save
                </button>
                <button
                  onClick={handleCellModalRefresh}
                  className="toolbar-btn refresh-btn"
                  disabled={cellModalIsLoading}
                >
                  {cellModalIsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clustering Analysis Tab */}
      {activeTab === 'clustering' && (
        <div className="clustering-tab">
          <div className="clustering-tab-header">
            <div className="clustering-tab-title">
              <h2>Clustering Analysis</h2>
              <button 
                onClick={createNewClusteringAnalysis}
                className="toolbar-btn"
                style={{ background: '#28a745', marginLeft: 16 }}
              >
                New Analysis
              </button>
            </div>
            
            {/* Analysis Selector */}
            {clusteringAnalyses.length > 0 && (
              <div className="analysis-selector">
                <label>Current Analysis:</label>
                <select
                  value={currentAnalysisId || ''}
                  onChange={(e) => {
                    const analysisId = e.target.value;
                    if (analysisId) {
                      switchToClusteringTab(analysisId);
                    }
                  }}
                  className="analysis-select"
                >
                  {clusteringAnalyses.map((analysis) => (
                    <option key={analysis.id} value={analysis.id}>
                      {analysis.name} ({new Date(analysis.timestamp).toLocaleString()})
                    </option>
                  ))}
                </select>
                {currentAnalysisId && (
                  <button
                    onClick={() => deleteClusteringAnalysis(currentAnalysisId)}
                    className="delete-analysis-btn"
                    title="Delete this analysis"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Clustering Content */}
          {clusteringTabData ? (
            <div className="clustering-content">
              {/* Analysis Summary */}
              <div className="analysis-summary">
                <div className="summary-card">
                  <h3>Analysis Summary</h3>
                  <div className="summary-grid">
                    <div className="summary-item">
                      <label>Method:</label>
                      <span>{clusteringTabData.config.method.toUpperCase()}</span>
                    </div>
                    {clusteringTabData.config.n_clusters && (
                      <div className="summary-item">
                        <label>Clusters:</label>
                        <span>{clusteringTabData.config.n_clusters}</span>
                      </div>
                    )}
                    {clusteringTabData.config.eps && (
                      <div className="summary-item">
                        <label>Epsilon:</label>
                        <span>{clusteringTabData.config.eps}</span>
                      </div>
                    )}
                    {clusteringTabData.config.min_samples && (
                      <div className="summary-item">
                        <label>Min Samples:</label>
                        <span>{clusteringTabData.config.min_samples}</span>
                      </div>
                    )}
                    <div className="summary-item">
                      <label>Texts Analyzed:</label>
                      <span>{clusteringTabData.data.texts.length}</span>
                    </div>
                    <div className="summary-item">
                      <label>Created:</label>
                      <span>{new Date(clusteringTabData.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dimensions Analysis */}
              {clusteringTabData.data.dimensions && (
                <div className="dimensions-section">
                  <h3>Semantic Dimensions Analysis</h3>
                  <div className="dimensions-grid">
                    {clusteringTabData.data.dimensions.map((dimension, dimIdx) => (
                      <div key={dimIdx} className="dimension-card">
                        <div className={`dimension-header ${dimension.type}`}>
                          <h4>{dimension.name}</h4>
                          {dimension.type === 'pca' && dimension.variance_explained && (
                            <span className="variance-badge">
                              {(dimension.variance_explained * 100).toFixed(1)}% variance
                            </span>
                          )}
                        </div>
                        <div className="dimension-content">
                          {dimension.description && (
                            <p className="dimension-description">{dimension.description}</p>
                          )}
                          {dimension.type === 'pca' && dimension.top_features && dimension.top_features.length > 0 && (
                            <div className="top-features">
                              <strong>Top Features:</strong>
                              <div className="feature-tags">
                                {dimension.top_features.map((feature, featIdx) => (
                                  <span key={featIdx} className="feature-tag">
                                    {feature}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Clusters Analysis */}
              <div className="clusters-section">
                <h3>Clusters Analysis</h3>
                <div className="clusters-grid">
                  {clusteringTabData.data.clusters.map((cluster, clusterIdx) => (
                    <div key={clusterIdx} className="cluster-card">
                      <div className="cluster-header">
                        <h4>Cluster {cluster.cluster_id + 1}</h4>
                        <span className="cluster-size">{cluster.size} items</span>
                      </div>
                      
                      <div className="cluster-content">
                        {/* Semantic Definition */}
                        {cluster.semantic_definition && (
                          <div className="cluster-section">
                            <h5>Semantic Definition</h5>
                            <p className="semantic-definition">{cluster.semantic_definition}</p>
                          </div>
                        )}
                        
                        {/* Key Themes */}
                        {cluster.key_themes && cluster.key_themes.length > 0 && (
                          <div className="cluster-section">
                            <h5>Key Themes</h5>
                            <div className="theme-tags">
                              {cluster.key_themes.map((theme, themeIdx) => (
                                <span key={themeIdx} className="theme-tag">
                                  {theme}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Representative Examples */}
                        {cluster.representative_examples && cluster.representative_examples.length > 0 && (
                          <div className="cluster-section">
                            <h5>Representative Examples</h5>
                            <div className="examples-list">
                              {cluster.representative_examples.map((example, exIdx) => (
                                <div key={exIdx} className="example-item">
                                  "{example}"
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Centroid Text */}
                        <div className="cluster-section">
                          <h5>Centroid Text</h5>
                          <p className="centroid-text">"{cluster.centroid_text}"</p>
                        </div>
                        
                        {/* Cluster Items */}
                        <div className="cluster-section">
                          <h5>Cluster Items ({cluster.items.length})</h5>
                          <div className="cluster-items">
                            {cluster.items.slice(0, 5).map((item, itemIdx) => {
                              const rowIndex = Math.floor(item.text_id / 1000);
                              const colIndex = item.text_id % 1000;
                              const columnName = getColumnHeaders()[colIndex] || `Column ${colIndex}`;
                              
                              return (
                                <div key={itemIdx} className="cluster-item">
                                  <div className="item-header">
                                    <span className="item-location">Row {rowIndex + 1}, {columnName}</span>
                                    <span className="similarity-score">
                                      {(item.similarity_score * 100).toFixed(1)}% similarity
                                    </span>
                                  </div>
                                  <p className="item-content">{item.text}</p>
                                </div>
                              );
                            })}
                            {cluster.items.length > 5 && (
                              <div className="more-items">
                                ... and {cluster.items.length - 5} more items
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="no-analysis">
              <div className="no-analysis-content">
                <h3>No Clustering Analysis Available</h3>
                <p>Create your first clustering analysis to get started.</p>
                <button 
                  onClick={createNewClusteringAnalysis}
                  className="toolbar-btn"
                  style={{ background: '#28a745', marginTop: 16 }}
                >
                  Create New Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Clustering Modal */}
      {showClusteringModal && clusteringData && (
        <div className="modal-overlay" onClick={() => {
          setShowClusteringModal(false);
          setHighlightedClusterRows(new Set()); // Clear highlighting when modal closes
        }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ zIndex: 1004, minWidth: 600, maxWidth: 900 }}>
            <div className="modal-header">
              <h3>Text Clustering Analysis</h3>
              <button onClick={() => {
                setShowClusteringModal(false);
                setHighlightedClusterRows(new Set()); // Clear highlighting when modal closes
              }} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              {!clusteringData.clusters ? (
                // Configuration section
                <div>
                  <div className="config-section">
                    <label>
                      <strong>Selected Texts ({clusteringData.texts.length} items):</strong>
                      <div style={{ 
                        maxHeight: 200, 
                        overflowY: 'auto', 
                        background: '#f8f9fa', 
                        padding: 12, 
                        borderRadius: 4,
                        marginTop: 8,
                        fontSize: 13
                      }}>
                        {clusteringData.texts.map((text, idx) => (
                          <div key={idx} style={{ marginBottom: 8, padding: 8, background: 'white', borderRadius: 4 }}>
                            <strong>Text {idx + 1}:</strong> {text.content.substring(0, 100)}{text.content.length > 100 ? '...' : ''}
                          </div>
                        ))}
                      </div>
                    </label>
                  </div>
                  
                  <div className="config-section">
                    <label>
                      <strong>Clustering Method:</strong>
                      <select
                        value={clusteringConfig.method}
                        onChange={(e) => setClusteringConfig({ ...clusteringConfig, method: e.target.value })}
                        className="config-input"
                        style={{ marginTop: 8 }}
                      >
                        <option value="kmeans">K-Means Clustering</option>
                        <option value="dbscan">DBSCAN Clustering</option>
                      </select>
                    </label>
                  </div>
                  
                  {clusteringConfig.method === 'kmeans' && (
                    <div className="config-section">
                      <label>
                        <strong>Number of Clusters:</strong>
                        <input
                          type="number"
                          value={clusteringConfig.n_clusters}
                          onChange={(e) => setClusteringConfig({ ...clusteringConfig, n_clusters: parseInt(e.target.value) || 5 })}
                          min={2}
                          max={Math.min(10, clusteringData.texts.length)}
                          className="config-input"
                          style={{ marginTop: 8 }}
                        />
                      </label>
                    </div>
                  )}
                  
                  {clusteringConfig.method === 'dbscan' && (
                    <>
                      <div className="config-section">
                        <label>
                          <strong>Epsilon (eps):</strong>
                          <input
                            type="number"
                            step="0.1"
                            value={clusteringConfig.eps}
                            onChange={(e) => setClusteringConfig({ ...clusteringConfig, eps: parseFloat(e.target.value) || 0.3 })}
                            min={0.1}
                            max={1.0}
                            className="config-input"
                            style={{ marginTop: 8 }}
                          />
                          <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
                            Maximum distance between points to be considered neighbors
                          </small>
                        </label>
                      </div>
                      <div className="config-section">
                        <label>
                          <strong>Minimum Samples:</strong>
                          <input
                            type="number"
                            value={clusteringConfig.min_samples}
                            onChange={(e) => setClusteringConfig({ ...clusteringConfig, min_samples: parseInt(e.target.value) || 2 })}
                            min={1}
                            max={clusteringData.texts.length}
                            className="config-input"
                            style={{ marginTop: 8 }}
                          />
                          <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
                            Minimum number of samples in a neighborhood to form a cluster
                          </small>
                        </label>
                      </div>
                    </>
                  )}
                  
                  <div className="config-actions">
                    <button 
                      onClick={performEnhancedClustering}
                      className="toolbar-btn"
                      disabled={isClustering}
                    >
                      {isClustering ? 'Clustering...' : 'Perform Clustering'}
                    </button>
                  </div>
                </div>
              ) : (
                // Results section
                <div>
                  <div className="config-section">
                    <label>
                      <strong>Clustering Results:</strong>
                      <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                        Method: {clusteringData.parameters.method.toUpperCase()}
                        {clusteringData.parameters.n_clusters && ` | Clusters: ${clusteringData.parameters.n_clusters}`}
                        {clusteringData.parameters.eps && ` | Epsilon: ${clusteringData.parameters.eps}`}
                        {clusteringData.parameters.min_samples && ` | Min Samples: ${clusteringData.parameters.min_samples}`}
                        {clusteringData.pca_explained_variance && ` | PCA Variance: ${(clusteringData.pca_explained_variance * 100).toFixed(1)}%`}
                      </div>
                    </label>
                  </div>
                  
                  {/* Dimensions Analysis */}
                  {clusteringData.dimensions && (
                    <div className="config-section">
                      <label>
                        <strong>Semantic Dimensions Analysis:</strong>
                        <div style={{ marginTop: 8 }}>
                          {clusteringData.dimensions.map((dimension, dimIdx) => (
                            <div key={dimIdx} style={{ 
                              marginBottom: 16, 
                              border: '1px solid #dee2e6', 
                              borderRadius: 8, 
                              overflow: 'hidden' 
                            }}>
                              <div style={{ 
                                background: dimension.type === 'original' ? '#28a745' : 
                                          dimension.type === 'pca' ? '#ffc107' : '#007bff', 
                                color: dimension.type === 'pca' ? '#000' : 'white', 
                                padding: '8px 12px',
                                fontSize: 13,
                                fontWeight: 600
                              }}>
                                {dimension.name}
                                {dimension.type === 'pca' && dimension.variance_explained && 
                                  ` (${(dimension.variance_explained * 100).toFixed(1)}% variance)`}
                              </div>
                              <div style={{ padding: 12 }}>
                                <div style={{ marginBottom: 8 }}>
                                  <strong>Type:</strong> {dimension.type.charAt(0).toUpperCase() + dimension.type.slice(1)}
                                </div>
                                <div style={{ marginBottom: 8 }}>
                                  <strong>Description:</strong>
                                  <div style={{ 
                                    background: '#f8f9fa', 
                                    padding: 8, 
                                    borderRadius: 4, 
                                    marginTop: 4,
                                    fontSize: 13
                                  }}>
                                    {dimension.description}
                                  </div>
                                </div>
                                {dimension.type === 'pca' && dimension.top_features && dimension.top_features.length > 0 && (
                                  <div>
                                    <strong>Top Features:</strong>
                                    <div style={{ marginTop: 4 }}>
                                      {dimension.top_features.map((feature, featIdx) => (
                                        <span key={featIdx} style={{ 
                                          display: 'inline-block',
                                          background: '#e9ecef',
                                          padding: '2px 8px',
                                          borderRadius: 12,
                                          fontSize: 12,
                                          margin: '2px 4px 2px 0'
                                        }}>
                                          {feature}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </label>
                    </div>
                  )}
                  
                                                {/* Clusters with Semantic Definitions */}
                              <div className="config-section">
                                <label>
                                  <strong>Clusters with Semantic Definitions:</strong>
                                  <div style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 8 }}>
                                    Hover over clusters to highlight their rows in the spreadsheet
                                  </div>
                      <div style={{ marginTop: 8, maxHeight: 600, overflowY: 'auto' }}>
                        {clusteringData.clusters.map((cluster, clusterIdx) => (
                          <div key={clusterIdx} style={{ 
                            marginBottom: 20, 
                            border: '1px solid #dee2e6', 
                            borderRadius: 8, 
                            overflow: 'hidden',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={() => {
                            // Highlight rows that belong to this cluster
                            const clusterRows = new Set();
                            cluster.items.forEach(item => {
                              const rowIndex = Math.floor(item.text_id / 1000);
                              clusterRows.add(rowIndex);
                            });
                            setHighlightedClusterRows(clusterRows);
                          }}
                          onMouseLeave={() => {
                            // Remove highlighting
                            setHighlightedClusterRows(new Set());
                          }}>
                            <div style={{ 
                              background: '#007bff', 
                              color: 'white', 
                              padding: '12px 16px',
                              fontSize: 14,
                              fontWeight: 600
                            }}>
                              Cluster {cluster.cluster_id + 1} ({cluster.size} items)
                            </div>
                            <div style={{ padding: 16 }}>
                              {/* Semantic Definition */}
                              {cluster.semantic_definition && (
                                <div style={{ marginBottom: 16 }}>
                                  <strong>Semantic Definition:</strong>
                                  <div style={{ 
                                    background: '#e3f2fd', 
                                    padding: 12, 
                                    borderRadius: 6, 
                                    marginTop: 6,
                                    fontSize: 14,
                                    lineHeight: 1.4
                                  }}>
                                    {cluster.semantic_definition}
                                  </div>
                                </div>
                              )}
                              
                              {/* Key Themes */}
                              {cluster.key_themes && cluster.key_themes.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <strong>Key Themes:</strong>
                                  <div style={{ marginTop: 6 }}>
                                    {cluster.key_themes.map((theme, themeIdx) => (
                                      <span key={themeIdx} style={{ 
                                        display: 'inline-block',
                                        background: '#28a745',
                                        color: 'white',
                                        padding: '4px 10px',
                                        borderRadius: 16,
                                        fontSize: 12,
                                        margin: '2px 4px 2px 0'
                                      }}>
                                        {theme}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* Representative Examples */}
                              {cluster.representative_examples && cluster.representative_examples.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <strong>Representative Examples:</strong>
                                  <div style={{ marginTop: 6 }}>
                                    {cluster.representative_examples.map((example, exIdx) => (
                                      <div key={exIdx} style={{ 
                                        background: '#fff3cd', 
                                        padding: 8, 
                                        borderRadius: 4, 
                                        marginBottom: 4,
                                        fontSize: 13,
                                        borderLeft: '3px solid #ffc107'
                                      }}>
                                        "{example}"
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* Row Distribution Summary */}
                              <div style={{ marginBottom: 12 }}>
                                <strong>Row Distribution:</strong>
                                <div style={{ 
                                  background: '#f1f3f4', 
                                  padding: 8, 
                                  borderRadius: 4, 
                                  marginTop: 4,
                                  fontSize: 13
                                }}>
                                  {(() => {
                                    const rowCounts = {};
                                    const colCounts = {};
                                    
                                    cluster.items.forEach(item => {
                                      const rowIndex = Math.floor(item.text_id / 1000);
                                      const colIndex = item.text_id % 1000;
                                      rowCounts[rowIndex] = (rowCounts[rowIndex] || 0) + 1;
                                      colCounts[colIndex] = (colCounts[colIndex] || 0) + 1;
                                    });
                                    
                                    const uniqueRows = Object.keys(rowCounts).length;
                                    const uniqueCols = Object.keys(colCounts).length;
                                    const totalItems = cluster.items.length;
                                    
                                    return (
                                      <div>
                                        <div style={{ marginBottom: 4 }}>
                                          <strong>{uniqueRows} unique rows</strong> with data from <strong>{uniqueCols} columns</strong>
                                        </div>
                                        <div style={{ fontSize: 12, color: '#666' }}>
                                          Row range: {Math.min(...Object.keys(rowCounts).map(Number)) + 1} - {Math.max(...Object.keys(rowCounts).map(Number)) + 1}
                                        </div>
                                        {uniqueCols <= 5 && (
                                          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                                            Columns: {Object.keys(colCounts).map(colIdx => {
                                              const colName = getColumnHeaders()[parseInt(colIdx)] || `Column ${parseInt(colIdx)}`;
                                              return `${colName} (${colCounts[colIdx]})`;
                                            }).join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                              
                              {/* Centroid Text */}
                              <div style={{ marginBottom: 12 }}>
                                <strong>Centroid Text:</strong>
                                <div style={{ 
                                  background: '#f8f9fa', 
                                  padding: 8, 
                                  borderRadius: 4, 
                                  marginTop: 4,
                                  fontStyle: 'italic'
                                }}>
                                  "{cluster.centroid_text}"
                                </div>
                              </div>
                              
                              {/* Cluster Items */}
                              <div>
                                <strong>Cluster Items:</strong>
                                <div style={{ marginTop: 8 }}>
                                  {cluster.items.map((item, itemIdx) => {
                                    // Extract row and column from text_id (format: rowIndex * 1000 + colIndex)
                                    const rowIndex = Math.floor(item.text_id / 1000);
                                    const colIndex = item.text_id % 1000;
                                    const columnName = getColumnHeaders()[colIndex] || `Column ${colIndex}`;
                                    
                                    return (
                                      <div key={itemIdx} style={{ 
                                        marginBottom: 8, 
                                        padding: 12, 
                                        background: '#f8f9fa', 
                                        borderRadius: 4,
                                        borderLeft: '4px solid #007bff',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.background = '#e3f2fd';
                                        e.target.style.transform = 'translateX(2px)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.background = '#f8f9fa';
                                        e.target.style.transform = 'translateX(0)';
                                      }}
                                      onClick={() => {
                                        // Navigate to the specific row in the spreadsheet
                                        const rowIndex = Math.floor(item.text_id / 1000);
                                        const colIndex = item.text_id % 1000;
                                        
                                        // Select the cell
                                        setSelectedCell({ rowIndex, colIndex });
                                        setSelectedRange(null);
                                        setSelectedCells([]);
                                        
                                        // Scroll to the cell
                                        const cellElement = document.getElementById(`cell-${rowIndex}-${colIndex}`);
                                        if (cellElement) {
                                          cellElement.scrollIntoView({ 
                                            behavior: 'smooth', 
                                            block: 'center' 
                                          });
                                        }
                                        
                                        // Close the modal
                                        setShowClusteringModal(false);
                                      }}
                                      title="Click to navigate to this cell in the spreadsheet">
                                        <div style={{ marginBottom: 6 }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: '#495057' }}>
                                              Row {rowIndex + 1}, {columnName}
                                            </div>
                                            <div style={{ fontSize: 11, color: '#6c757d', background: '#e9ecef', padding: '2px 6px', borderRadius: 8 }}>
                                              ID: {item.text_id}
                                            </div>
                                          </div>
                                          <div style={{ fontSize: 12, color: '#666' }}>
                                            Similarity Score: {(item.similarity_score * 100).toFixed(1)}%
                                          </div>
                                        </div>
                                        <div style={{ 
                                          background: 'white', 
                                          padding: 8, 
                                          borderRadius: 4, 
                                          border: '1px solid #dee2e6',
                                          fontSize: 13,
                                          lineHeight: 1.4
                                        }}>
                                          <strong>Content:</strong> {item.text}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </label>
                  </div>
                  
                  <div className="config-actions">
                    <button 
                      onClick={() => setClusteringData({ texts: clusteringData.texts })}
                      className="toolbar-btn"
                    >
                      New Analysis
                    </button>
                    <button 
                      onClick={() => {
                        // Switch to clustering tab to view results
                        switchToClusteringTab();
                        setShowClusteringModal(false);
                        setHighlightedClusterRows(new Set());
                      }}
                      className="toolbar-btn"
                      style={{ background: '#007bff' }}
                    >
                      View in Tab
                    </button>
                    <button 
                      onClick={() => {
                        setShowClusteringModal(false);
                        setHighlightedClusterRows(new Set()); // Clear highlighting when modal closes
                      }}
                      className="toolbar-btn"
                      style={{ background: '#6c757d' }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Context Menu */}
      {showContextMenu && (
        <div 
          className="context-menu"
          style={{
            position: 'fixed',
            top: contextMenuPosition.y,
            left: contextMenuPosition.x,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: 150,
            padding: 4
          }}
        >
          {contextMenuTarget === 'cell' && (
            <>
              <div 
                className="context-menu-item"
                onClick={copySelectedCells}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  borderBottom: '1px solid #eee'
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Copy
              </div>
              <div 
                className="context-menu-item"
                onClick={pasteToSelectedArea}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  borderBottom: '1px solid #eee'
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Paste
              </div>
              <div 
                className="context-menu-item"
                onClick={deleteSelectedCells}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  borderBottom: '1px solid #eee'
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Delete
              </div>
              <div 
                className="context-menu-item"
                onClick={handleReprocessCell}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  borderBottom: '1px solid #eee'
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Reprocess using Gemini
              </div>
              <div 
                className="context-menu-item"
                onClick={handleEditCell}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14,
                  borderBottom: '1px solid #eee'
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Edit
              </div>
              <div 
                className="context-menu-item"
                onClick={handleClustering}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 14
                }}
                onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.background = 'white'}
              >
                Cluster Texts
              </div>
              {clusteringAnalyses.length > 0 && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    switchToClusteringTab();
                    closeContextMenu();
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#007bff'
                  }}
                  onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.background = 'white'}
                >
                  View Clustering Results ({clusteringAnalyses.length})
                </div>
              )}
            </>
          )}
          {contextMenuTarget === 'header' && (
            <div 
              className="context-menu-item"
              onClick={handleEditHeader}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 14
              }}
              onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
              onMouseLeave={(e) => e.target.style.background = 'white'}
            >
              Edit prompt etc
            </div>
          )}
        </div>
      )}

      {/* Session Creation Modal */}
      {showSessionModal && (
        <div className="modal-overlay" onClick={() => setShowSessionModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ zIndex: 1002 }}>
            <div className="modal-header">
              <h3>Create New Session</h3>
              <button onClick={() => setShowSessionModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="config-section">
                <label>
                  <strong>Session Name:</strong>
                  <input
                    type="text"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder="Enter session name..."
                    className="config-input"
                    autoFocus
                  />
                </label>
              </div>
              <div className="config-section">
                <label>
                  <strong>Description (optional):</strong>
                  <textarea
                    value={newSessionDescription}
                    onChange={(e) => setNewSessionDescription(e.target.value)}
                    placeholder="Enter session description..."
                    className="config-textarea"
                    rows={3}
                  />
                </label>
              </div>
              <div className="config-actions">
                <button 
                  onClick={createSession}
                  className="toolbar-btn"
                  disabled={!newSessionName.trim()}
                >
                  Create Session
                </button>
                <button 
                  onClick={() => setShowSessionModal(false)}
                  className="toolbar-btn"
                  style={{ background: '#6c757d' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session List Modal */}
      {showSessionList && (
        <div className="modal-overlay" onClick={() => setShowSessionList(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ zIndex: 1002, maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>Open Session</h3>
              <button onClick={() => setShowSessionList(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              {sessions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                  No sessions found. Create a new session to get started.
                </div>
              ) : (
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {sessions.map((session) => (
                    <div 
                      key={session.id} 
                      style={{
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        padding: 12,
                        marginBottom: 8,
                        background: currentSession?.id === session.id ? '#e3f2fd' : 'white',
                        cursor: 'pointer'
                      }}
                      onClick={() => loadSession(session.id)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                            {session.name}
                            {currentSession?.id === session.id && (
                              <span style={{ marginLeft: 8, fontSize: 12, color: '#007bff' }}>
                                (Current)
                              </span>
                            )}
                          </div>
                          {session.description && (
                            <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
                              {session.description}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#999' }}>
                            Created: {new Date(session.created_at).toLocaleString()}
                          </div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            Updated: {new Date(session.updated_at).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(session.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#dc3545',
                            cursor: 'pointer',
                            fontSize: 16,
                            padding: 4
                          }}
                          title="Delete Session"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="config-actions" style={{ marginTop: 16 }}>
                <button 
                  onClick={() => {
                    setShowSessionList(false);
                    setShowSessionModal(true);
                  }}
                  className="toolbar-btn"
                  style={{ background: '#28a745' }}
                >
                  Create New Session
                </button>
                <button 
                  onClick={() => setShowSessionList(false)}
                  className="toolbar-btn"
                  style={{ background: '#6c757d' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Welcome Modal */}
      {showWelcomeModal && (
        <div className="modal-overlay" onClick={handleWelcomeSkip}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ zIndex: 1002, maxWidth: '400px', padding: '20px' }}>
            <div className="modal-header">
              <h3>Welcome to Skim2!</h3>
              <button onClick={handleWelcomeSkip} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <p>Welcome to Skim2! It's a powerful spreadsheet application that uses AI to analyze data. You can:</p>
              <ul>
                <li>Load existing spreadsheets from JSON files</li>
                <li>Create new spreadsheets with column configurations</li>
                <li>Configure columns to analyze data from other columns</li>
                <li>Edit cell values and refresh their analysis</li>
                <li>Copy, paste, and delete cells</li>
                <li>Manage sessions to save your work</li>
              </ul>
              {sessions.length === 0 ? (
                <>
                  <p>Let's get started! Create your first session to begin working.</p>
                  <div className="config-actions" style={{ display: 'flex', gap: 10, marginTop: 15 }}>
                    <button onClick={handleWelcomeNewSession} className="toolbar-btn" style={{ flex: 1 }}>
                      Create New Session
                    </button>
                    <button onClick={handleWelcomeSkip} className="toolbar-btn" style={{ flex: 1, background: '#6c757d' }}>
                      Skip for Now
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>You have existing sessions. Would you like to create a new session or open an existing one?</p>
                  <div className="config-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 15 }}>
                    <button onClick={handleWelcomeNewSession} className="toolbar-btn">
                      Create New Session
                    </button>
                    <button onClick={handleWelcomeOpenSession} className="toolbar-btn">
                      Open Existing Session
                    </button>
                    <button onClick={handleWelcomeSkip} className="toolbar-btn" style={{ background: '#6c757d' }}>
                      Skip for Now
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpreadsheetGrid; 