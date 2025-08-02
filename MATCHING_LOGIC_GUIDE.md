# PDF Text Matching and Highlighting Logic Guide

## Overview
This guide teaches an AI agent how to implement fuzzy text matching between Gemini AI responses and PDF content, with visual highlighting in a React-PDF viewer.

## Prerequisites
- React application with react-pdf library
- PDF.js for text extraction
- Fuzzball library for fuzzy string matching
- Google Gemini AI integration

## Core Components

### 1. State Management
```javascript
// Required state variables
const [currentPage, setCurrentPage] = useState(null);
const [highlightedQuote, setHighlightedQuote] = useState(null);
const [highlightedFragmentIndices, setHighlightedFragmentIndices] = useState({});
const [matchQuality, setMatchQuality] = useState({});
const pageTextFragments = useRef({}); // { [pageNum]: [{str, itemIndex}] }
```

### 2. Reference Click Handler
```javascript
function handleReferenceClick(ref) {
  // Always update state to trigger re-render and highlighting
  setCurrentPage(Number(ref.page_index));
  setHighlightedQuote(ref.quote);
  setHighlightRefs([ref]);
  
  // Scroll to the page
  setTimeout(() => {
    if (pageRefs.current[Number(ref.page_index) - 1]) {
      pageRefs.current[Number(ref.page_index) - 1].scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }, 100);
}
```

### 3. Text Fragment Collection
```javascript
// In the Page component's customTextRenderer
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
  
  // Return highlighted text if needed
  if (isHighlighted) {
    return (
      <span className="highlighted-fragment" style={{ backgroundColor: 'yellow' }}>
        {str}
      </span>
    );
  }
  
  // Return plain text
  return str;
}}
```

### 4. Page Render Success Handler
```javascript
onRenderSuccess={() => {
  // Only highlight if this is the current page and we have a quote to highlight
  if (currentPage === pageNum && highlightedQuote) {
    // Use a small delay to ensure fragments are collected
    setTimeout(() => {
      highlightTextInPage(pageNum, highlightedQuote);
    }, 100);
  }
}}
```

### 5. Main Highlighting Function
```javascript
function highlightTextInPage(pageNum, quote) {
  // Get the page text from the fragments
  const fragments = pageTextFragments.current[pageNum];
  
  if (!fragments || fragments.length === 0) {
    return;
  }

  // Join all fragments to get the full page text
  const pageText = fragments.map(f => f.str).join(' ');

  // Find the best match
  const match = findBestMatchInText(quote, pageText);
  
  if (match) {
    // Convert word indices back to fragment indices
    const pageWords = pageText.split(' ');
    let currentWordIndex = 0;
    const matchedFragments = [];
    
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      if (!fragment || !fragment.str) continue;
      
      const fragmentWords = fragment.str.split(' ');
      const fragmentWordCount = fragmentWords.length;
      
      // Check if this fragment contains any of the matched words
      const fragmentStartWord = currentWordIndex;
      const fragmentEndWord = currentWordIndex + fragmentWordCount - 1;
      
      if (fragmentStartWord <= match.end && fragmentEndWord >= match.start) {
        matchedFragments.push(i);
      }
      
      currentWordIndex += fragmentWordCount;
    }
    
    // Set the highlights
    setHighlightedFragmentIndices(prev => ({ 
      ...prev, 
      [pageNum]: new Set(matchedFragments) 
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
      joined: pageText.substring(0, 500) + '...'
    });
  }
}
```

### 6. Fuzzy Matching Function
```javascript
function findBestMatchInText(quote, pageText) {
  if (!quote || !pageText) {
    return null;
  }

  // Normalize both strings (simple approach)
  const normalize = (str) => str.toLowerCase().replace(/\s+/g, ' ').trim();
  const normQuote = normalize(quote);
  const normPageText = normalize(pageText);

  // If exact match exists, return it
  const exactIndex = normPageText.indexOf(normQuote);
  if (exactIndex !== -1) {
    return {
      start: exactIndex,
      end: exactIndex + normQuote.length,
      score: 100,
      type: 'exact'
    };
  }

  // Sliding window approach for fuzzy matching
  const quoteWords = normQuote.split(' ');
  const pageWords = normPageText.split(' ');
  const quoteWordCount = quoteWords.length;

  let bestMatch = null;
  let bestScore = 0;

  // Try different window sizes around the quote length
  const minWindow = Math.max(1, quoteWordCount - 2);
  const maxWindow = Math.min(pageWords.length, quoteWordCount + 2);

  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize++) {
    for (let i = 0; i <= pageWords.length - windowSize; i++) {
      const window = pageWords.slice(i, i + windowSize).join(' ');
      
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
      }
    }
  }

  return bestMatch;
}
```

### 7. CSS Styling
```css
/* Enhanced highlight styling for PDF text fragments */
.highlighted-fragment {
  background-color: rgba(255, 224, 102, 0.8) !important; /* 80% opacity yellow */
  color: #000 !important; /* Black text */
  border-radius: 2px !important;
  padding: 1px 2px !important;
  box-shadow: none !important;
  opacity: 1 !important;
  visibility: visible !important;
  display: inline !important;
  position: static !important;
  z-index: auto !important;
  text-shadow: none !important;
  font-weight: inherit !important;
  line-height: inherit !important;
  vertical-align: baseline !important;
  margin: 0 !important;
  border: none !important;
}
```

### 8. Page Component Key
```javascript
<Page
  key={currentPage === pageNum && highlightedQuote ? 
    `highlight-${currentPage}-${highlightedQuote}` : 
    `page-${pageNum}`}
  pageNumber={pageNum}
  // ... other props
/>
```

## Step-by-Step Implementation Process

### Step 1: Set up State Variables
1. Add all required state variables to your React component
2. Initialize `pageTextFragments` as a ref to store text fragments

### Step 2: Implement Reference Click Handler
1. Create `handleReferenceClick` function
2. Update current page and highlighted quote state
3. Add scrolling logic to navigate to the page

### Step 3: Set up Text Fragment Collection
1. In the Page component, add `customTextRenderer` prop
2. Collect text fragments in the ref
3. Check if current fragment should be highlighted
4. Return highlighted span or plain text

### Step 4: Add Page Render Success Handler
1. Add `onRenderSuccess` prop to Page component
2. Check if current page matches and quote exists
3. Call highlighting function with delay

### Step 5: Implement Main Highlighting Function
1. Create `highlightTextInPage` function
2. Get fragments for the page
3. Join fragments into page text
4. Call fuzzy matching function
5. Convert word indices to fragment indices
6. Update state with matched fragments

### Step 6: Implement Fuzzy Matching
1. Create `findBestMatchInText` function
2. Normalize input strings
3. Try exact match first
4. Use sliding window approach for fuzzy matching
5. Use fuzzball.ratio for similarity scoring
6. Return best match with score and type

### Step 7: Add CSS Styling
1. Create `.highlighted-fragment` CSS class
2. Set background color, text color, and other properties
3. Use `!important` to override PDF.js styles

### Step 8: Update Page Component Key
1. Add dynamic key to Page component
2. Force re-render when highlighting changes

## Key Concepts

### Text Fragment Collection
- PDF.js extracts text as individual fragments
- Each fragment has position, size, and text content
- Store fragments in ref for each page

### Word-to-Fragment Mapping
- Join all fragments to get full page text
- Split into words for matching
- Map word indices back to fragment indices
- Handle fragments that span multiple words

### Fuzzy Matching Strategy
- Normalize text (lowercase, trim whitespace)
- Try exact match first
- Use sliding window for fuzzy matching
- Score using fuzzball.ratio
- Minimum threshold of 70% similarity

### State Management
- Track current page and highlighted quote
- Store highlighted fragment indices per page
- Store match quality information
- Use refs for fragment storage

### Rendering Logic
- Only highlight fragments on current page
- Apply CSS class and inline styles
- Force page re-render with key changes
- Handle timing with setTimeout

## Debugging Tips

1. **Add console logs** to track fragment collection
2. **Log matching results** to verify fuzzy matching
3. **Check state updates** to ensure highlighting state is set
4. **Verify CSS class application** in browser dev tools
5. **Monitor page re-renders** with key changes

## Common Issues and Solutions

### Issue: No highlighting appears
- **Solution**: Check if `currentPage === pageNum` condition is met
- **Solution**: Verify CSS class is being applied
- **Solution**: Ensure page re-renders with key change

### Issue: Wrong fragments highlighted
- **Solution**: Check word-to-fragment mapping logic
- **Solution**: Verify fragment indices are correct
- **Solution**: Debug fuzzy matching results

### Issue: Multiple pages highlighted
- **Solution**: Add `currentPage === pageNum` check
- **Solution**: Ensure highlighting only applies to target page

### Issue: Timing problems
- **Solution**: Use setTimeout in onRenderSuccess
- **Solution**: Ensure fragments are collected before highlighting

This guide provides the complete implementation for PDF text matching and highlighting functionality. 