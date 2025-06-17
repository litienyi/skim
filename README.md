# Skim - PDF Analysis Tool

A powerful React-based tool for analyzing PDF documents, extracting text blocks, and performing semantic analysis of academic content.

## Features

- PDF file upload and viewing
- Interactive text block selection and ordering
- Sentence boundary detection and management
- Rhetorical function analysis using Google's Gemini AI
- Relevance scoring for each sentence
- Visual feedback for active/inactive blocks
- Custom sentence addition and removal
- Backend text extraction using PyMuPDF

## Prerequisites

- Python 3.8 or higher
- Node.js 16 or higher
- npm or yarn
- Google API key for Gemini AI

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd skim2
```

### 2. Backend Setup

1. Create and activate a Python virtual environment:
```bash
# On macOS/Linux
python3 -m venv venv
source venv/bin/activate

# On Windows
python -m venv venv
.\venv\Scripts\activate
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Set up environment variables:
Create a `.env` file in the backend directory with:
```
GOOGLE_API_KEY=your_google_api_key_here
```

4. Start the Flask backend:
```bash
cd backend
python app.py
```
The backend will run on http://localhost:5001

### 3. Frontend Setup

1. Install Node.js dependencies:
```bash
npm install
# or
yarn install
```

2. Start the development server:
```bash
npm run dev
# or
yarn dev
```
The frontend will run on http://localhost:5173

## Project Structure

```
skim2/
├── backend/
│   ├── app.py           # Flask backend
│   ├── database.py      # Database operations
│   └── uploads/         # PDF storage
├── src/
│   ├── components/      # React components
│   ├── App.jsx         # Main React component
│   └── main.jsx        # React entry point
├── requirements.txt     # Python dependencies
├── package.json        # Node.js dependencies
└── vite.config.js      # Vite configuration
```

## Usage

1. Open http://localhost:5173 in your browser
2. Upload a PDF file using the file input
3. Click on text blocks to activate them (they will be highlighted)
4. Use the sentence starter toggle to mark sentence boundaries
5. Process the text to analyze rhetorical functions
6. View the analysis results with relevance scores
7. Add or remove custom sentences as needed

## API Endpoints

- POST /api/upload: Upload and process PDF
- GET /api/pdf/<filename>: Serve PDF file
- GET /api/blocks/<document_id>: Get text blocks
- GET /api/sentences/<document_id>: Get sentences
- POST /api/process-text: Analyze text with Gemini AI
- POST /api/add-custom-sentence: Add custom sentence
- POST /api/remove-custom-sentence: Remove custom sentence
- POST /api/activate-block: Toggle block activation
- POST /api/toggle-sentence-starter: Toggle sentence starter
- POST /api/reset-sentence-numbers: Reset sentence numbering
- POST /api/reinitialize-db: Reset database

## Development

### Backend Features
- PDF text extraction and block identification
- Sentence boundary detection
- Rhetorical function analysis using Gemini AI
- SQLite database for data persistence
- CORS support for local development

### Frontend Features
- PDF viewer with block selection
- Interactive sentence management
- Rhetorical function visualization
- Relevance score display
- Custom sentence editing

## Troubleshooting

1. If the backend fails to start:
   - Check if port 5001 is available
   - Ensure all Python dependencies are installed
   - Verify Python version is 3.8 or higher
   - Check if GOOGLE_API_KEY is set in .env

2. If the frontend fails to start:
   - Check if port 5173 is available
   - Ensure all Node.js dependencies are installed
   - Clear npm/yarn cache if needed

3. If PDF upload fails:
   - Check file size (should be under 10MB)
   - Verify PDF file is not corrupted
   - Check browser console for errors

4. If text analysis fails:
   - Verify GOOGLE_API_KEY is valid
   - Check if the PDF contains extractable text
   - Ensure blocks are properly activated

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Acknowledgements

This project relies on several open-source packages and tools:

### Backend Dependencies
- Flask: Web framework for Python
- PyMuPDF (fitz): PDF processing and text extraction
- Google Generative AI (gemini): AI-powered text analysis
- SQLite: Database management
- python-dotenv: Environment variable management
- Werkzeug: WSGI utilities

### Frontend Dependencies
- React: UI framework
- Vite: Build tool and development server
- PDF.js: PDF rendering in the browser
- React-PDF: React wrapper for PDF.js

### Development Tools
- Node.js: JavaScript runtime
- npm/yarn: Package managers
- Python: Programming language
- Git: Version control

## Academic Honesty Disclaimer

This project was almost entirely built using Cursor, an AI code assistant. While I have made some modifications and customizations, I do not claim intellectual authorship or ownership of the code beyond what I have actually done. The core architecture, implementation details, and many features were generated with the assistance of Cursor. That said, I have learned a lot about application architecture by observing Cursor at work, and this project could be interpreted as evidence of this learning experience.
