// Test code for multiple page range API calls
// This simulates the frontend logic without making real API calls

// Mock API response function
function mockGeminiAPI(pageRange, message) {
  return new Promise((resolve) => {
    // Simulate API delay
    setTimeout(() => {
      const mockResponse = {
        message: `This is a mock response for pages ${pageRange[0]}-${pageRange[1]}. The user asked: "${message}". This response contains information from the specified page range.`,
        references: [
          {
            quote: `Sample quote from page ${pageRange[0]}`,
            page: pageRange[0]
          },
          {
            quote: `Another quote from page ${pageRange[1]}`,
            page: pageRange[1]
          }
        ],
        chat_session_id: `session_${Date.now()}_${Math.random()}`
      };
      resolve(mockResponse);
    }, Math.random() * 1000 + 500); // Random delay between 500-1500ms
  });
}

// Parse page ranges into actual ranges
function parsePageRanges(value, numPages = 300) {
  const ranges = [];
  
  console.log('=== PAGE RANGE PARSING ===');
  console.log('Input value:', value);
  
  // Check if the entire input is wrapped in square brackets
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
    // Extract content inside brackets
    const bracketContent = trimmedValue.slice(1, -1);
    console.log('Bracket content:', bracketContent);
    
    // Parse the content inside brackets as individual page numbers
    const parts = bracketContent.split(/[;,]/).map(part => part.trim()).filter(part => part);
    console.log('Parts inside brackets:', parts);
    
    const pageNumbers = [];
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(num => parseInt(num.trim()));
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            if (i >= 1 && i <= numPages) {
              pageNumbers.push(i);
            }
          }
        }
      } else {
        const page = parseInt(part);
        if (!isNaN(page) && page >= 1 && page <= numPages) {
          pageNumbers.push(page);
        }
      }
    }
    
    // Remove duplicates and sort
    const uniquePages = [...new Set(pageNumbers)].sort((a, b) => a - b);
    console.log('Pages inside brackets:', uniquePages);
    
          if (uniquePages.length > 0) {
        // For bracketed content, we need to send the exact pages
        // We'll create a special format that the backend can handle
        ranges.push({ type: 'specific_pages', pages: uniquePages });
      }
    
  } else {
    // Regular parsing (no brackets)
    const parts = trimmedValue.split(/[;,]/).map(part => part.trim()).filter(part => part);
    console.log('Parsed parts:', parts);
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(num => parseInt(num.trim()));
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          ranges.push([start, end]);
        }
      } else {
        const page = parseInt(part);
        if (!isNaN(page) && page >= 1 && page <= numPages) {
          ranges.push([page, page]);
        }
      }
    }
  }
  
  console.log('Parsed ranges:', ranges);
  console.log('=== END PAGE RANGE PARSING ===');
  return ranges;
}

// Simulate the handleSendMessage function
async function simulateMultipleAPICalls(pageRangeInput, userMessage) {
  console.log('=== SIMULATION START ===');
  console.log('User message:', userMessage);
  console.log('Page range input:', pageRangeInput);
  
  // Parse page ranges into actual ranges
  const pageRanges = parsePageRanges(pageRangeInput);
  
  if (pageRanges.length === 0) {
    console.log('No valid page ranges found');
    return;
  }
  
  console.log(`Making ${pageRanges.length} API calls in sequence...`);
  
  // Make multiple API calls in sequence and display each response immediately
  let chatSessionId = null;
  const individualResponses = [];
  
  for (let i = 0; i < pageRanges.length; i++) {
    const range = pageRanges[i];
    console.log(`API call ${i + 1}/${pageRanges.length}: pages ${range[0]}-${range[1]}`);
    
    try {
      const startTime = Date.now();
      const response = await mockGeminiAPI(range, userMessage);
      const endTime = Date.now();
      
      individualResponses.push({
        range: range,
        response: response,
        duration: endTime - startTime
      });
      
      // Update chat session ID for subsequent calls
      if (response.chat_session_id) {
        chatSessionId = response.chat_session_id;
      }
      
      console.log(`API call ${i + 1} successful:`, {
        messageLength: response.message?.length || 0,
        referencesCount: response.references?.length || 0,
        duration: `${endTime - startTime}ms`
      });
      
      // Simulate displaying this response immediately in UI
      console.log(`📱 UI Update ${i + 1}: Response for pages ${range[0]}-${range[1]} displayed`);
      
    } catch (error) {
      console.error(`API call ${i + 1} failed:`, error);
      throw error;
    }
  }
  
  console.log('All API calls completed:', {
    totalCalls: pageRanges.length,
    individualResponses: individualResponses.length,
    chatSessionId: chatSessionId
  });
  
  console.log('=== INDIVIDUAL RESPONSES ===');
  individualResponses.forEach((item, index) => {
    console.log(`Response ${index + 1} (pages ${item.range[0]}-${item.range[1]}):`, {
      messageLength: item.response.message?.length || 0,
      referencesCount: item.response.references?.length || 0,
      duration: `${item.duration}ms`
    });
  });
  console.log('=== SIMULATION END ===');
  
  return {
    individualResponses: individualResponses,
    chatSessionId: chatSessionId,
    totalCalls: pageRanges.length
  };
}

// Test cases
async function runTests() {
  console.log('🧪 RUNNING TESTS FOR MULTIPLE PAGE RANGES 🧪\n');
  
  const testCases = [
    {
      name: "Single range",
      input: "65-113",
      message: "What is the main topic?"
    },
    {
      name: "Multiple ranges with semicolons",
      input: "65-113;114-135;136-152",
      message: "Summarize the key points"
    },
    {
      name: "Multiple ranges with commas",
      input: "153-171,172-196,197-219",
      message: "What are the main findings?"
    },
    {
      name: "Mixed single pages and ranges",
      input: "220-234;235;236-259;260-270",
      message: "Explain the methodology"
    },
    {
      name: "Bracketed ranges - single API call",
      input: "[1-3;7-9]",
      message: "Analyze the bracketed content"
    },
    {
      name: "Bracketed ranges with commas",
      input: "[65-113,114-135,136-152]",
      message: "Summarize bracketed sections"
    },
    {
      name: "Bracketed mixed content",
      input: "[1-5;10;15-20;25]",
      message: "Explain the methodology"
    },
    {
      name: "Bracketed single pages only",
      input: "[5;7;9]",
      message: "Analyze these specific pages"
    },
    {
      name: "Your original test case",
      input: "65-113;114-135;136-152;153-171;172-196;197-219;220-234;235-259;260-270",
      message: "Provide a comprehensive analysis of the document"
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📋 TEST: ${testCase.name}`);
    console.log('='.repeat(50));
    
    try {
      const result = await simulateMultipleAPICalls(testCase.input, testCase.message);
      console.log(`✅ Test passed: ${result.totalCalls} API calls made, ${result.individualResponses.length} individual responses displayed`);
    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
    }
    
    console.log('='.repeat(50));
  }
}

// Performance test
async function performanceTest() {
  console.log('\n⚡ PERFORMANCE TEST ⚡');
  console.log('Testing with your original input...');
  
  const startTime = Date.now();
  const result = await simulateMultipleAPICalls(
    "65-113;114-135;136-152;153-171;172-196;197-219;220-234;235-259;260-270",
    "Provide a comprehensive analysis"
  );
  const endTime = Date.now();
  
  console.log(`\n📊 PERFORMANCE RESULTS:`);
  console.log(`Total time: ${endTime - startTime}ms`);
  console.log(`API calls made: ${result.totalCalls}`);
  console.log(`Average time per call: ${Math.round((endTime - startTime) / result.totalCalls)}ms`);
  console.log(`Individual responses displayed: ${result.individualResponses.length}`);
  console.log(`Total references across all responses: ${result.individualResponses.reduce((sum, item) => sum + (item.response.references?.length || 0), 0)}`);
}

// Run the tests
if (typeof window === 'undefined') {
  // Node.js environment
  runTests().then(() => {
    return performanceTest();
  }).catch(console.error);
} else {
  // Browser environment
  console.log('Run runTests() to execute the tests');
  console.log('Run performanceTest() to test performance');
  
  // Make functions available globally for browser testing
  window.runTests = runTests;
  window.performanceTest = performanceTest;
  window.simulateMultipleAPICalls = simulateMultipleAPICalls;
}
