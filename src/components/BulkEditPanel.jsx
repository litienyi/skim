import React, { useState, useMemo } from 'react'
import {
  Box,
  Paper,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Tooltip
} from '@mui/material'
import Delete from '@mui/icons-material/Delete'
import ContentCopy from '@mui/icons-material/ContentCopy'
import Preview from '@mui/icons-material/Preview'
import usePDFStore from '../store.js'

const BulkEditPanel = () => {
  const {
    blocks,
    selectedBlocks,
    clearSelection,
    applyBulkEdit,
    setEditingMode
  } = usePDFStore()

  const [editType, setEditType] = useState('heading')
  const [headingLevel, setHeadingLevel] = useState(1)
  const [customText, setCustomText] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const selectedBlocksData = useMemo(() => {
    return blocks.filter(block => selectedBlocks.has(block.id))
  }, [blocks, selectedBlocks])

  const handleApplyEdit = () => {
    if (selectedBlocksData.length === 0) return

    const operation = {
      type: editType,
      ...(editType === 'heading' && { level: headingLevel }),
      ...(editType === 'custom' && { text: customText })
    }

    applyBulkEdit(operation)
    clearSelection()
  }

  const handleFindSimilar = () => {
    if (selectedBlocksData.length === 0) return

    // Use the first selected block as pattern
    const pattern = selectedBlocksData[0]
    const similarBlocks = findSimilarBlocks(pattern, blocks)
    
    // Select similar blocks
    similarBlocks.forEach(({ block }) => {
      if (!selectedBlocks.has(block.id)) {
        // This would need to be implemented in the store
        console.log('Similar block found:', block.id)
      }
    })
  }

  const findSimilarBlocks = (pattern, allBlocks) => {
    const matches = []
    
    allBlocks.forEach(block => {
      if (selectedBlocks.has(block.id)) return // Skip already selected
      
      let score = 0
      
      // Font size similarity
      if (Math.abs(block.fontSize - pattern.fontSize) < 2) {
        score += 0.3
      }
      
      // Text length similarity
      const lengthDiff = Math.abs(block.text.length - pattern.text.length)
      const maxLength = Math.max(block.text.length, pattern.text.length)
      if (maxLength > 0) {
        score += 0.3 * (1 - lengthDiff / maxLength)
      }
      
      // Position similarity (same vertical position)
      const posDiff = Math.abs(block.bbox.y0 - pattern.bbox.y0)
      if (posDiff < 50) {
        score += 0.4
      }
      
      if (score > 0.6) {
        matches.push({ block, score })
      }
    })
    
    return matches.sort((a, b) => b.score - a.score)
  }

  const getPreviewContent = () => {
    if (!showPreview || selectedBlocksData.length === 0) return ''

    let preview = ''
    selectedBlocksData.forEach(block => {
      if (editType === 'heading') {
        const level = '#'.repeat(Math.min(headingLevel, 6))
        preview += `${level} ${block.text}\n\n`
      } else if (editType === 'paragraph') {
        preview += `${block.text}\n\n`
      } else if (editType === 'custom') {
        preview += `${customText}\n\n`
      }
    })

    return preview.trim()
  }

  const copyToClipboard = () => {
    const preview = getPreviewContent()
    navigator.clipboard.writeText(preview)
  }

  if (selectedBlocksData.length === 0) {
    return (
      <Paper sx={{ p: 2, height: '100%' }}>
        <Typography variant="h6" gutterBottom>
          Bulk Edit
        </Typography>
        <Alert severity="info">
          Select blocks in the PDF viewer to enable bulk editing
        </Alert>
        <Button
          variant="outlined"
          onClick={() => setEditingMode('select')}
          sx={{ mt: 2 }}
        >
          Start Selecting
        </Button>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Bulk Edit ({selectedBlocksData.length} blocks selected)
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={clearSelection}
          sx={{ mr: 1 }}
        >
          Clear Selection
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={handleFindSimilar}
        >
          Find Similar
        </Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* Edit Type Selection */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Edit Type</InputLabel>
        <Select
          value={editType}
          onChange={(e) => setEditType(e.target.value)}
          label="Edit Type"
        >
          <MenuItem value="heading">Convert to Heading</MenuItem>
          <MenuItem value="paragraph">Convert to Paragraph</MenuItem>
          <MenuItem value="custom">Custom Text</MenuItem>
        </Select>
      </FormControl>

      {/* Heading Level */}
      {editType === 'heading' && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Heading Level</InputLabel>
          <Select
            value={headingLevel}
            onChange={(e) => setHeadingLevel(e.target.value)}
            label="Heading Level"
          >
            <MenuItem value={1}>H1</MenuItem>
            <MenuItem value={2}>H2</MenuItem>
            <MenuItem value={3}>H3</MenuItem>
            <MenuItem value={4}>H4</MenuItem>
            <MenuItem value={5}>H5</MenuItem>
            <MenuItem value={6}>H6</MenuItem>
          </Select>
        </FormControl>
      )}

      {/* Custom Text */}
      {editType === 'custom' && (
        <TextField
          fullWidth
          label="Custom Text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />
      )}

      {/* Selected Blocks List */}
      <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Selected Blocks:
        </Typography>
        <List dense>
          {selectedBlocksData.map((block) => (
            <ListItem key={block.id} sx={{ py: 0.5 }}>
              <ListItemText
                primary={block.text.substring(0, 50) + (block.text.length > 50 ? '...' : '')}
                secondary={`Page ${block.pageNum} • ${block.type} • ${Math.round(block.fontSize)}px`}
              />
              <ListItemSecondaryAction>
                <Chip
                  label={block.type === 'heading' ? `H${block.level || 1}` : 'P'}
                  size="small"
                  color={block.type === 'heading' ? 'warning' : 'success'}
                />
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      </Box>

      {/* Preview Section */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Button
            size="small"
            onClick={() => setShowPreview(!showPreview)}
            startIcon={<Preview />}
          >
            {showPreview ? 'Hide' : 'Show'} Preview
          </Button>
          {showPreview && (
            <Tooltip title="Copy to clipboard">
              <IconButton size="small" onClick={copyToClipboard}>
                <ContentCopy />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        
        {showPreview && (
          <Paper
            variant="outlined"
            sx={{
              p: 1,
              maxHeight: 200,
              overflow: 'auto',
              backgroundColor: '#f5f5f5',
              fontFamily: 'monospace',
              fontSize: '12px',
              whiteSpace: 'pre-wrap'
            }}
          >
            {getPreviewContent()}
          </Paper>
        )}
      </Box>

      {/* Apply Button */}
      <Button
        variant="contained"
        onClick={handleApplyEdit}
        disabled={editType === 'custom' && !customText.trim()}
        fullWidth
      >
        Apply to {selectedBlocksData.length} Block{selectedBlocksData.length !== 1 ? 's' : ''}
      </Button>
    </Paper>
  )
}

export default BulkEditPanel 