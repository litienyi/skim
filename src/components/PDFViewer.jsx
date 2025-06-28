import React, { useRef, useEffect, useCallback, memo } from 'react'
import { Box, Paper, IconButton, Tooltip } from '@mui/material'
import ZoomIn from '@mui/icons-material/ZoomIn'
import ZoomOut from '@mui/icons-material/ZoomOut'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import * as pdfjsLib from 'pdfjs-dist'
import usePDFStore from '../store.js'
import { PDFProcessor } from '../utils/pdfProcessor.js'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const PDFViewer = memo(() => {
  const containerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const {
    document,
    currentPage,
    totalPages,
    scale,
    blocks,
    selectedBlocks,
    editingMode,
    setCurrentPage,
    setScale,
    toggleBlockSelection,
    clearSelection
  } = usePDFStore()

  const renderPage = useCallback(async () => {
    if (!document || !containerRef.current) return

    try {
      // Cancel any existing render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }

      // Clear the container
      containerRef.current.innerHTML = ''

      const page = await document.getPage(currentPage)
      const viewport = page.getViewport({ scale })
      
      // Create a new canvas for each render
      const canvas = window.document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.border = '1px solid #ddd'
      canvas.style.cursor = editingMode === 'select' ? 'crosshair' : 'default'
      
      // Add click handler to canvas
      canvas.addEventListener('click', (event) => {
        if (editingMode !== 'select') return

        const rect = canvas.getBoundingClientRect()
        const x = (event.clientX - rect.left) / scale
        const y = (event.clientY - rect.top) / scale

        // Find clicked block
        const clickedBlock = blocks.find(block => {
          if (block.pageNum !== currentPage) return false
          
          return x >= block.bbox.x0 && x <= block.bbox.x1 &&
                 y >= block.bbox.y0 && y <= block.bbox.y1
        })

        if (clickedBlock) {
          toggleBlockSelection(clickedBlock.id)
        } else {
          clearSelection()
        }
      })

      // Add canvas to container
      containerRef.current.appendChild(canvas)

      const context = canvas.getContext('2d')
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      }

      // Store the render task so we can cancel it if needed
      renderTaskRef.current = page.render(renderContext)
      await renderTaskRef.current.promise
      renderTaskRef.current = null
      
      console.log(`Page ${currentPage} rendered successfully`)
    } catch (error) {
      if (error.name === 'RenderingCancelled') {
        console.log('Rendering was cancelled')
        return
      }
      console.error('Error rendering page:', error)
    }
  }, [document, currentPage, scale, editingMode, blocks, toggleBlockSelection, clearSelection])

  useEffect(() => {
    renderPage()
    
    // Cleanup function to cancel render task when component unmounts
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [renderPage])

  const handleZoomIn = () => {
    setScale(Math.min(scale * 1.2, 3.0))
  }

  const handleZoomOut = () => {
    setScale(Math.max(scale / 1.2, 0.5))
  }

  const handlePageChange = (direction) => {
    const newPage = currentPage + direction
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
    }
  }

  const getCurrentPageBlocks = () => {
    console.log(`Looking for blocks on page ${currentPage}`)
    console.log(`Total blocks available: ${blocks.length}`)
    console.log(`Sample block page numbers:`, blocks.slice(0, 5).map(b => b.pageNum))
    
    const currentBlocks = blocks.filter(block => block.pageNum === currentPage)
    console.log(`Page ${currentPage} blocks:`, currentBlocks.length, currentBlocks)
    return currentBlocks
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <Paper sx={{ p: 1, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title="Zoom Out">
          <IconButton onClick={handleZoomOut} size="small">
            <ZoomOut />
          </IconButton>
        </Tooltip>
        
        <Box sx={{ mx: 1, minWidth: 60, textAlign: 'center' }}>
          {Math.round(scale * 100)}%
        </Box>
        
        <Tooltip title="Zoom In">
          <IconButton onClick={handleZoomIn} size="small">
            <ZoomIn />
          </IconButton>
        </Tooltip>
        
        <Box sx={{ flex: 1 }} />
        
        <IconButton 
          onClick={() => handlePageChange(-1)} 
          disabled={currentPage <= 1}
          size="small"
        >
          ‹
        </IconButton>
        
        <Box sx={{ mx: 1, minWidth: 80, textAlign: 'center' }}>
          {currentPage} / {totalPages}
        </Box>
        
        <IconButton 
          onClick={() => handlePageChange(1)} 
          disabled={currentPage >= totalPages}
          size="small"
        >
          ›
        </IconButton>
      </Paper>

      {/* PDF Canvas Container */}
      <Paper 
        ref={containerRef}
        sx={{ 
          flex: 1, 
          overflow: 'auto', 
          display: 'flex', 
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        {/* Canvas will be dynamically inserted here */}
        
        {/* Block Overlays */}
        {editingMode === 'select' && getCurrentPageBlocks().map((block) => {
          const isSelected = selectedBlocks.has(block.id)
          
          // Calculate scaled positions
          const left = block.bbox.x0 * scale
          const top = block.bbox.y0 * scale
          const width = (block.bbox.x1 - block.bbox.x0) * scale
          const height = (block.bbox.y1 - block.bbox.y0) * scale
          
          console.log(`Block ${block.id} position:`, { left, top, width, height, scale })
          
          return (
            <Box
              key={block.id}
              sx={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                border: `2px solid ${isSelected ? '#1976d2' : '#ccc'}`,
                backgroundColor: isSelected ? 'rgba(25, 118, 210, 0.1)' : 'rgba(200, 200, 200, 0.1)',
                pointerEvents: 'none',
                zIndex: 1000
              }}
            >
              {/* Block type indicator */}
              <Box
                sx={{
                  position: 'absolute',
                  top: -20,
                  left: 0,
                  backgroundColor: block.type === 'heading' ? '#ff9800' : '#4caf50',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: 1,
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}
              >
                {block.type === 'heading' ? `H${block.level || 1}` : 'P'}
              </Box>
              
              {/* Selection indicator */}
              {isSelected && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: -40,
                    right: 0,
                    backgroundColor: '#1976d2',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: 1,
                    fontSize: '10px'
                  }}
                >
                  ✓
                </Box>
              )}
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
})

PDFViewer.displayName = 'PDFViewer'

export default PDFViewer 