import React, { useState, useCallback } from 'react'
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  Grid,
  Paper,
  LinearProgress,
  Alert,
  Snackbar,
  Tabs,
  Tab,
  IconButton,
  Tooltip
} from '@mui/material'
import Upload from '@mui/icons-material/Upload'
import Visibility from '@mui/icons-material/Visibility'
import Edit from '@mui/icons-material/Edit'
import Download from '@mui/icons-material/Download'
import Settings from '@mui/icons-material/Settings'
import Refresh from '@mui/icons-material/Refresh'
import usePDFStore from './store.js'
import { PDFProcessor } from './utils/pdfProcessor.js'
import PDFViewer from './components/PDFViewer.jsx'
import BulkEditPanel from './components/BulkEditPanel.jsx'
import ExportPanel from './components/ExportPanel.jsx'

function App() {
  const {
    document,
    isProcessing,
    processingProgress,
    setDocument,
    setBlocks,
    setHeadings,
    setParagraphs,
    setSentences,
    setIsProcessing,
    setProcessingProgress,
    reset,
    setTotalPages
  } = usePDFStore()

  const [activeTab, setActiveTab] = useState(0)
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' })

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity })
  }

  const handleFileUpload = useCallback(async (event) => {
    console.log('File upload event triggered:', event)
    const file = event.target.files[0]
    console.log('Selected file:', file)
    
    if (!file) {
      console.log('No file selected')
      return
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      console.log('File is not a PDF:', file.name)
      showSnackbar('Please select a PDF file', 'error')
      return
    }

    console.log('Starting PDF processing...')
    try {
      setIsProcessing(true)
      setProcessingProgress(0)

      // Create PDF processor
      console.log('Creating PDF processor...')
      const processor = new PDFProcessor()
      
      // Load document
      console.log('Loading document...')
      setProcessingProgress(20)
      await processor.loadDocument(file)
      console.log('Document loaded successfully')
      
      // Process document
      console.log('Processing document...')
      setProcessingProgress(40)
      const result = await processor.processDocument()
      console.log('Document processed:', result)
      
      // Update store
      console.log('Updating store...')
      setProcessingProgress(80)
      setDocument(processor.document)
      setTotalPages(processor.document.numPages)
      setBlocks(result.blocks)
      setHeadings(result.headings)
      setParagraphs(result.paragraphs)
      setSentences(result.sentences)
      
      console.log('Store updated with:', {
        document: processor.document,
        totalPages: processor.document.numPages,
        blocks: result.blocks.length,
        headings: result.headings.length,
        paragraphs: result.paragraphs.length,
        sentences: result.sentences.length
      })
      
      setProcessingProgress(100)
      console.log('PDF processing completed successfully')
      showSnackbar(`Successfully processed ${file.name}`, 'success')
      
      // Switch to viewer tab
      setActiveTab(0)
      
    } catch (error) {
      console.error('Error processing PDF:', error)
      showSnackbar(`Error processing PDF: ${error.message}`, 'error')
    } finally {
      setIsProcessing(false)
      setProcessingProgress(0)
    }
  }, [setDocument, setBlocks, setHeadings, setParagraphs, setSentences, setIsProcessing, setProcessingProgress, setTotalPages])

  const handleNewDocument = () => {
    reset()
    setActiveTab(0)
    showSnackbar('Ready for new document', 'info')
  }

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue)
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 0:
        return <PDFViewer />
      case 1:
        return <BulkEditPanel />
      case 2:
        return <ExportPanel />
      default:
        return <PDFViewer />
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            PDF Structure Tool
          </Typography>
          
          {document && (
            <>
              <Tooltip title="New Document">
                <IconButton color="inherit" onClick={handleNewDocument}>
                  <Refresh />
                </IconButton>
              </Tooltip>
            </>
          )}
          
            <input
            accept=".pdf"
            style={{ display: 'none' }}
            id="pdf-upload"
              type="file"
            onChange={handleFileUpload}
          />
          <label htmlFor="pdf-upload">
            <Button
              variant="contained"
              component="span"
              startIcon={<Upload />}
              disabled={isProcessing}
              onClick={() => console.log('Upload button clicked')}
            >
              Upload PDF
            </Button>
          </label>
        </Toolbar>
      </AppBar>

      {/* Processing Progress */}
      {isProcessing && (
        <Box sx={{ width: '100%' }}>
          <LinearProgress 
            variant="determinate" 
            value={processingProgress} 
            sx={{ height: 4 }}
          />
          <Box sx={{ p: 1, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Processing PDF... {Math.round(processingProgress)}%
            </Typography>
          </Box>
        </Box>
      )}

      {/* Main Content */}
      <Container maxWidth="xl" sx={{ flex: 1, py: 2 }}>
        {!document ? (
          // Welcome Screen
          <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            textAlign: 'center'
          }}>
            <Paper sx={{ p: 4, maxWidth: 600 }}>
              <Typography variant="h4" gutterBottom>
                Welcome to PDF Structure Tool
              </Typography>
              <Typography variant="body1" color="text.secondary" paragraph>
                The fastest, smartest, and most intuitive tool for structuring PDFs into clean, 
                sentence-level, markdown-ready documents — with human-in-the-loop precision.
              </Typography>
              
              <Box sx={{ my: 3 }}>
                <Typography variant="h6" gutterBottom>
                  What it does:
                </Typography>
                <ul style={{ textAlign: 'left' }}>
                  <li>Converts messy, unstructured PDFs into clean, structured documents</li>
                  <li>Automatically detects headings, paragraphs, and structure</li>
                  <li>Provides intuitive bulk editing tools</li>
                  <li>Exports to Markdown, JSON, or HTML formats</li>
                </ul>
              </Box>

              <input
                accept=".pdf"
                style={{ display: 'none' }}
                id="welcome-pdf-upload"
                type="file"
                onChange={handleFileUpload}
              />
              <label htmlFor="welcome-pdf-upload">
                <Button
                  variant="contained"
                  size="large"
                  component="span"
                  startIcon={<Upload />}
                  disabled={isProcessing}
                  onClick={() => console.log('Welcome upload button clicked')}
                >
                  Upload Your First PDF
                </Button>
              </label>
            </Paper>
          </Box>
        ) : (
          // Main Application
          <Grid container spacing={2} sx={{ height: '100%' }}>
            {/* Left Panel - PDF Viewer */}
            <Grid item xs={12} md={8} sx={{ height: '100%' }}>
              <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {renderTabContent()}
              </Paper>
            </Grid>

            {/* Right Panel - Tools */}
            <Grid item xs={12} md={4} sx={{ height: '100%' }}>
              <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Tab Navigation */}
                <Tabs 
                  value={activeTab} 
                  onChange={handleTabChange}
                  variant="fullWidth"
                  sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                  <Tab 
                    icon={<Visibility />} 
                    label="View" 
                    iconPosition="start"
                  />
                  <Tab 
                    icon={<Edit />} 
                    label="Edit" 
                    iconPosition="start"
                  />
                  <Tab 
                    icon={<Download />} 
                    label="Export" 
                    iconPosition="start"
                  />
                </Tabs>

                {/* Tab Content */}
                <Box sx={{ flex: 1, overflow: 'hidden' }}>
                  {renderTabContent()}
                </Box>
              </Paper>
            </Grid>
          </Grid>
        )}
      </Container>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default App