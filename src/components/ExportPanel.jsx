import React, { useState, useMemo, useCallback } from 'react'
import {
  Box,
  Paper,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
  Alert,
  Divider
} from '@mui/material'
import ContentCopy from '@mui/icons-material/ContentCopy'
import Download from '@mui/icons-material/Download'
import Code from '@mui/icons-material/Code'
import Description from '@mui/icons-material/Description'
import Html from '@mui/icons-material/Html'
import ReactMarkdown from 'react-markdown'
import usePDFStore from '../store.js'

const ExportPanel = () => {
  const { blocks, exportFormat, setExportFormat } = usePDFStore()
  const [showPreview, setShowPreview] = useState(true)

  const exportContent = useMemo(() => {
    if (blocks.length === 0) return ''

    switch (exportFormat) {
      case 'markdown':
        return exportToMarkdown()
      case 'json':
        return exportToJSON()
      case 'html':
        return exportToHTML()
      default:
        return ''
    }
  }, [blocks, exportFormat, exportToMarkdown, exportToJSON, exportToHTML])

  const exportToMarkdown = useCallback(() => {
    let markdown = ''
    
    blocks.forEach(block => {
      if (block.type === 'heading') {
        const level = '#'.repeat(Math.min(block.level || 1, 6))
        markdown += `${level} ${block.text}\n\n`
      } else {
        markdown += `${block.text}\n\n`
      }
    })
    
    return markdown.trim()
  }, [blocks])

  const exportToJSON = useCallback(() => {
    const structuredData = {
      metadata: {
        totalBlocks: blocks.length,
        headings: blocks.filter(b => b.type === 'heading').length,
        paragraphs: blocks.filter(b => b.type === 'paragraph').length,
        exportDate: new Date().toISOString()
      },
      blocks: blocks.map(block => ({
        id: block.id,
        type: block.type,
        text: block.text,
        pageNum: block.pageNum,
        fontSize: block.fontSize,
        fontFamily: block.fontFamily,
        bbox: block.bbox,
        ...(block.type === 'heading' && { level: block.level })
      }))
    }
    
    return JSON.stringify(structuredData, null, 2)
  }, [blocks])

  const exportToHTML = useCallback(() => {
    let html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    html += '  <meta charset="UTF-8">\n'
    html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    html += '  <title>Exported Document</title>\n'
    html += '  <style>\n'
    html += '    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }\n'
    html += '    h1, h2, h3, h4, h5, h6 { color: #333; margin-top: 1.5em; margin-bottom: 0.5em; }\n'
    html += '    p { margin-bottom: 1em; }\n'
    html += '    .metadata { background: #f5f5f5; padding: 10px; border-radius: 5px; margin-bottom: 20px; font-size: 0.9em; }\n'
    html += '  </style>\n'
    html += '</head>\n<body>\n'
    
    // Add metadata
    html += '  <div class="metadata">\n'
    html += `    <strong>Exported:</strong> ${new Date().toLocaleString()}<br>\n`
    html += `    <strong>Total Blocks:</strong> ${blocks.length}<br>\n`
    html += `    <strong>Headings:</strong> ${blocks.filter(b => b.type === 'heading').length}<br>\n`
    html += `    <strong>Paragraphs:</strong> ${blocks.filter(b => b.type === 'paragraph').length}\n`
    html += '  </div>\n'
    
    // Add content
    blocks.forEach(block => {
      if (block.type === 'heading') {
        const tag = `h${Math.min(block.level || 1, 6)}`
        html += `  <${tag}>${block.text}</${tag}>\n`
      } else {
        html += `  <p>${block.text}</p>\n`
      }
    })
    
    html += '</body>\n</html>'
    return html
  }, [blocks])

  const copyToClipboard = () => {
    navigator.clipboard.writeText(exportContent)
  }

  const downloadFile = () => {
    const blob = new Blob([exportContent], { 
      type: exportFormat === 'json' ? 'application/json' : 
            exportFormat === 'html' ? 'text/html' : 'text/markdown' 
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `document.${exportFormat === 'json' ? 'json' : exportFormat}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (blocks.length === 0) {
    return (
      <Paper sx={{ p: 2, height: '100%' }}>
        <Typography variant="h6" gutterBottom>
          Export
        </Typography>
        <Alert severity="info">
          Load a PDF document to enable export functionality
        </Alert>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Export Document
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Export Format:
        </Typography>
        <ToggleButtonGroup
          value={exportFormat}
          exclusive
          onChange={(e, newFormat) => newFormat && setExportFormat(newFormat)}
          size="small"
        >
          <ToggleButton value="markdown">
            <Tooltip title="Markdown">
              <Description />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="json">
            <Tooltip title="JSON">
              <Code />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="html">
            <Tooltip title="HTML">
              <Html />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          startIcon={<ContentCopy />}
          onClick={copyToClipboard}
          size="small"
        >
          Copy
        </Button>
        <Button
          variant="contained"
          startIcon={<Download />}
          onClick={downloadFile}
          size="small"
        >
          Download
        </Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* Preview Section */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2">
            Preview ({exportFormat.toUpperCase()})
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? 'Hide' : 'Show'} Preview
          </Button>
        </Box>
        
        {showPreview && (
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 2,
              backgroundColor: exportFormat === 'json' ? '#f5f5f5' : 'white',
              fontFamily: exportFormat === 'json' ? 'monospace' : 'inherit',
              fontSize: exportFormat === 'json' ? '12px' : 'inherit'
            }}
          >
            {exportFormat === 'markdown' ? (
              <ReactMarkdown>{exportContent}</ReactMarkdown>
            ) : exportFormat === 'json' ? (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{exportContent}</pre>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: exportContent }} />
            )}
          </Paper>
        )}
      </Box>

      {/* Statistics */}
      <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          {blocks.length} total blocks • {' '}
          {blocks.filter(b => b.type === 'heading').length} headings • {' '}
          {blocks.filter(b => b.type === 'paragraph').length} paragraphs
        </Typography>
      </Box>
    </Paper>
  )
}

export default ExportPanel 