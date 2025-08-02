# PDF Text Highlighting Logic Guide

## Overview

This document explains the text highlighting functionality implemented in the React PDF viewer application. The system uses fuzzy string matching to highlight quoted text from chat responses within the PDF document, even when the exact text doesn't match due to formatting differences, OCR artifacts, or text extraction variations.

## Architecture Components

### 1. State Management

The highlighting system uses several React state variables to manage the highlighting process:

```javascript
// Core highlighting state
const [highlightedQuote, setHighlightedQuote] = useState(null)
const [currentPage, setCurrentPage] = useState(null)
const [highlightedFragmentIndices, setHighlightedFragmentIndices] = useState({})
const [textLayerReady, setTextLayerReady] = useState({})

// Debug and warning states
const [highlightWarning, setHighlightWarning] = useState(null)
const [lastHighlightCall, setLastHighlightCall] = useState(null)

// Text fragment storage (useRef to avoid re-renders)
const pageTextFragments = useRef({}) // { [pageNum]: [{str, itemIdx}] }
```

### 2. Text Fragment Collection

The system collects text fragments from the PDF using the `customTextRenderer` prop on the `Page` component:

```javascript
customTextRenderer={({ str, itemIndex }) => {
  // Collect fragments for the current page
  if (!pageTextFragments.current[pageNum]) {
    pageTextFragments.current[pageNum] = []
  }
  pageTextFragments.current[pageNum][itemIndex] = { str, itemIndex }
  
  // Highlight if this fragment is in the best fuzzy match
  if (highlightedFragmentIndices[pageNum] && 
      highlightedFragmentIndices[pageNum].has(itemIndex)) {
    return `<span class="highlighted-fragment">${str}</span>`
  }
  return str
}}
```

### 3. Fuzzy Matching Algorithm

The core highlighting logic uses a sliding window approach with fuzzy string matching:

```javascript
function runFuzzyHighlight(pageNum, quote) {
  const fragments = pageTextFragments.current[pageNum]
  if (!fragments || fragments.length === 0) {
    // Handle case where no fragments are available
    return
  }
  
  // Normalize text for comparison
  const normalize = str => str
    .replace(/[""'':,;\-]/g, '')  // Remove punctuation and quotes
    .replace(/[^\w\s]/g, '')      // Remove special characters
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .toLowerCase()
    .trim()
  
  const normQuote = normalize(quote)
  const quoteWordCount = normQuote.split(' ').length
  
  // Normalize all fragments
  const normFragments = fragments.map(f => normalize(f.str))
  
  // Sliding window search
  let bestScore = -1
  let bestIndices = null
  
  for (let windowSize = Math.max(quoteWordCount - 2, 3); 
       windowSize <= quoteWordCount + 2; 
       windowSize++) {
    for (let i = 0; i <= normFragments.length - windowSize; i++) {
      const window = normFragments.slice(i, i + windowSize).join(' ')
      const score = fuzz.ratio(window, normQuote)
      
      if (score > bestScore) {
        bestScore = score
        bestIndices = Array.from({length: windowSize}, (_, k) => i + k)
      }
    }
  }
  
  // Apply highlighting
  if (bestIndices && bestScore > 0) {
    setHighlightedFragmentIndices(prev => ({ 
      ...prev, 
      [pageNum]: new Set(bestIndices) 
    }))
  }
}
```

## How to Replicate This Functionality

### Step 1: Install Dependencies

```bash
npm install react-pdf fuzzball
```

### Step 2: Set Up PDF Worker

```javascript
import { Document, Page, pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
```

### Step 3: Implement State Management

```javascript
import { useState, useRef, useEffect } from 'react'

function PDFViewer() {
  const [currentPage, setCurrentPage] = useState(null)
  const [highlightedQuote, setHighlightedQuote] = useState(null)
  const [highlightedFragmentIndices, setHighlightedFragmentIndices] = useState({})
  const [textLayerReady, setTextLayerReady] = useState({})
  const pageTextFragments = useRef({})
  
  // ... rest of implementation
}
```

### Step 4: Create the Highlighting Function

```javascript
import * as fuzz from 'fuzzball'

function runFuzzyHighlight(pageNum, quote) {
  const fragments = pageTextFragments.current[pageNum]
  if (!fragments || fragments.length === 0) {
    console.warn('No fragments found for page', pageNum)
    return
  }
  
  // Normalize text
  const normalize = str => str
    .replace(/[""'':,;\-]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
  
  const normQuote = normalize(quote)
  const quoteWordCount = normQuote.split(' ').length
  const normFragments = fragments.map(f => normalize(f.str))
  
  // Find best match using sliding window
  let bestScore = -1
  let bestIndices = null
  
  for (let windowSize = Math.max(quoteWordCount - 2, 3); 
       windowSize <= quoteWordCount + 2; 
       windowSize++) {
    for (let i = 0; i <= normFragments.length - windowSize; i++) {
      const window = normFragments.slice(i, i + windowSize).join(' ')
      const score = fuzz.ratio(window, normQuote)
      
      if (score > bestScore) {
        bestScore = score
        bestIndices = Array.from({length: windowSize}, (_, k) => i + k)
      }
    }
  }
  
  // Apply highlighting
  if (bestIndices && bestScore > 0) {
    setHighlightedFragmentIndices(prev => ({ 
      ...prev, 
      [pageNum]: new Set(bestIndices) 
    }))
  }
}
```

### Step 5: Implement PDF Rendering with Text Collection

```javascript
function PDFViewer() {
  // ... state management
  
  return (
    <Document file={pdfFile}>
      {Array.from(new Array(numPages), (el, index) => {
        const pageNum = index + 1
        
        return (
          <Page
            key={pageNum}
            pageNumber={pageNum}
            customTextRenderer={({ str, itemIndex }) => {
              // Collect text fragments
              if (!pageTextFragments.current[pageNum]) {
                pageTextFragments.current[pageNum] = []
              }
              pageTextFragments.current[pageNum][itemIndex] = { str, itemIndex }
              
              // Apply highlighting
              if (highlightedFragmentIndices[pageNum] && 
                  highlightedFragmentIndices[pageNum].has(itemIndex)) {
                return `<span class="highlighted-fragment">${str}</span>`
              }
              return str
            }}
            onRenderSuccess={() => {
              setTextLayerReady(prev => ({ ...prev, [pageNum]: true }))
              
              // Run highlighting after text is ready
              if (currentPage === pageNum && highlightedQuote) {
                setTimeout(() => {
                  runFuzzyHighlight(pageNum, highlightedQuote)
                }, 0)
              }
            }}
          />
        )
      })}
    </Document>
  )
}
```

### Step 6: Add CSS for Highlighting

```css
.highlighted-fragment {
  background-color: yellow;
  color: black;
}
```

### Step 7: Trigger Highlighting

```javascript
function handleReferenceClick(reference) {
  setCurrentPage(Number(reference.page))
  setHighlightedQuote(reference.quote)
  
  // Scroll to the page
  setTimeout(() => {
    const pageElement = document.querySelector(`[data-page="${reference.page}"]`)
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, 100)
}
```

## Key Features

### 1. Text Normalization
- Removes punctuation, quotes, and special characters
- Normalizes whitespace
- Converts to lowercase for case-insensitive matching

### 2. Sliding Window Algorithm
- Tries different window sizes around the expected quote length
- Uses fuzzy string matching to find the best match
- Handles OCR artifacts and formatting differences

### 3. Fragment-Based Highlighting
- Works with individual text fragments from PDF.js
- Maintains precise positioning within the document
- Supports multi-word phrases and sentences

### 4. Performance Optimizations
- Uses `useRef` for fragment storage to avoid unnecessary re-renders
- Only runs highlighting when text layer is ready
- Debounces highlighting calls with `setTimeout`

## Debugging Features

The system includes several debugging features:

1. **Highlight Warning**: Shows when no match is found
2. **Last Highlight Call**: Displays when highlighting was triggered
3. **Console Logging**: Detailed logs for debugging matching issues

## Common Issues and Solutions

### Issue: No highlights appearing
**Solution**: Check that `textLayerReady` is true for the target page and that fragments are being collected properly.

### Issue: Wrong text highlighted
**Solution**: Adjust the normalization function or fuzzy matching threshold. Consider using different fuzzy matching algorithms from the `fuzzball` library.

### Issue: Performance problems with large documents
**Solution**: Implement pagination or virtual scrolling to limit the number of pages rendered simultaneously.

## Alternative Approaches

### 1. Exact String Matching
For cases where exact matches are expected, replace fuzzy matching with simple string search:

```javascript
function exactHighlight(pageNum, quote) {
  const fragments = pageTextFragments.current[pageNum]
  const indices = []
  
  fragments.forEach((fragment, index) => {
    if (fragment.str.includes(quote)) {
      indices.push(index)
    }
  })
  
  setHighlightedFragmentIndices(prev => ({ 
    ...prev, 
    [pageNum]: new Set(indices) 
  }))
}
```

### 2. Regular Expression Matching
For more complex patterns:

```javascript
function regexHighlight(pageNum, pattern) {
  const fragments = pageTextFragments.current[pageNum]
  const regex = new RegExp(pattern, 'gi')
  const indices = []
  
  fragments.forEach((fragment, index) => {
    if (regex.test(fragment.str)) {
      indices.push(index)
    }
  })
  
  setHighlightedFragmentIndices(prev => ({ 
    ...prev, 
    [pageNum]: new Set(indices) 
  }))
}
```

## Conclusion

This highlighting system provides robust text matching capabilities for PDF documents, handling the challenges of OCR artifacts, formatting differences, and text extraction variations. The fuzzy matching approach ensures that quoted text can be highlighted even when it doesn't exactly match the extracted text from the PDF.

The modular design makes it easy to adapt for different use cases, whether you need exact matching, fuzzy matching, or custom matching algorithms. 