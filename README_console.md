# Gemini Structured Output Console

## Overview
This console interface demonstrates Gemini's structured output capabilities using `response_schema` for robust JSON generation. It processes multiple academic texts and extracts structured information with direct quotes and relevance scores.

## Key Features
- ✅ **Structured Output**: Uses Gemini's `response_schema` parameter (recommended approach)
- ✅ **Batch Processing**: Handles large datasets by processing in batches
- ✅ **File Input**: Load texts from file (one entry per line) or manual input
- ✅ **Direct Quotes**: Extracts exact quotes with source attribution
- ✅ **Relevance Scoring**: Assigns relevance scores (1-100) to each reference
- ✅ **1:1 Mapping**: One analysis per input text

## Schema Design
```python
class Reference(BaseModel):
    quote: str
    source: str  
    context: str
    relevance: int

class TextAnalysis(BaseModel):
    text_id: int
    answer: str
    references: List[Reference]
    summary: str

class AnalysisResponse(BaseModel):
    analyses: List[TextAnalysis]
```

## Usage
```bash
python console_final_structured_output.py
```

## Input Options
1. **File Input**: Load from text file (one entry per line)
2. **Manual Input**: Enter texts manually

## Example Output
```json
{
  "analyses": [
    {
      "text_id": 1,
      "answer": "Scholar's books include...",
      "references": [
        {
          "quote": "Exact quote from text",
          "source": "TEXT #1",
          "context": "Context for the quote",
          "relevance": 95
        }
      ],
      "summary": "Brief summary of analysis"
    }
  ]
}
```

## Key Insights
- **Descriptive field names** work better than abstract ones (`answer` vs `a`)
- **No schema instructions in prompt** (follows official Gemini docs)
- **Batch processing** prevents token limit issues
- **Fallback mechanisms** handle edge cases

## Requirements
- Python 3.7+
- `google-generativeai`
- `pydantic`
- `python-dotenv`
- Google API key in `backend/.env`

## Best Practices
1. Use descriptive field names in schema
2. Keep prompts natural language (no schema instructions)
3. Process large datasets in batches
4. Include fallback error handling 