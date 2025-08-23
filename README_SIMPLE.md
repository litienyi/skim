# SKIM2 - Simplified Version (No Authentication)

A simplified version of SKIM2 that runs locally without user authentication. Perfect for personal use on your computer.

## Features

- 📄 **PDF Upload & Analysis**: Upload PDF files and extract text content (text-based PDFs only)
- 🤖 **AI Chat**: Chat with Gemini AI about your PDF content
- 💬 **Chat Persistence**: Chat messages are automatically saved and restored when reopening documents
- 🎯 **Page-Specific Context**: Focus AI responses on specific pages
- 🔍 **Enhanced Text Highlighting**: Click on references to navigate to pages and highlight quoted text with visual feedback
- 💾 **Local Storage**: All data stored locally in SQLite database
- 🚀 **No Authentication**: Start using immediately without login

## Quick Start

### Prerequisites

- Python 3.8 or higher
- Node.js 16 or higher
- Google Gemini API key

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd skim2
   ```

2. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env and add your GOOGLE_API_KEY
   ```

3. **Run the simplified version**
   ```bash
   ./run_simple.sh
   ```

   This script will:
   - Create a Python virtual environment
   - Install dependencies
   - Initialize the database
   - Start the backend server

4. **Start the frontend** (in a new terminal)
   ```bash
   npm install
   npm run dev
   ```

5. **Open your browser**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:5001

## Usage

1. **Upload a PDF**: Drag and drop or click to upload a PDF file
2. **Chat with AI**: Ask questions about the PDF content
3. **Set Page Context**: Specify page ranges to focus AI responses
4. **Highlight Text**: Click on AI responses to highlight relevant text in the PDF
5. **Manage Documents**: View, delete, and switch between uploaded documents

## Database

The simplified version uses a local SQLite database (`skim2_local.db`) with the following structure:

- **documents**: Stores PDF metadata and extracted text
- **chat_sessions**: Links chat conversations to documents
- **chat_messages**: Stores individual chat messages

All data is stored locally on your computer - no external database required.

## Chat Persistence

Chat messages are automatically saved and persist between sessions:

1. **Automatic Saving**: Every chat message is automatically saved to the database
2. **Session Management**: Each document can have multiple chat sessions
3. **Auto-Restore**: When you reopen a document, the most recent chat session is automatically loaded
4. **Fresh Start**: Uploading a new document starts a new chat session
5. **Clear Chat**: Use the "Clear Chat" button to permanently delete the current chat session from both frontend and backend

This ensures your conversations are never lost and you can continue where you left off, or start fresh when needed.

## Enhanced Reference Functionality

The app provides powerful reference navigation and highlighting:

1. **Page Navigation**: Click on "Page X" links to instantly navigate to specific pages
2. **Quote Highlighting**: Click on quoted text to search and highlight it in the PDF
3. **Visual Feedback**: 
   - Loading indicators show when searching for quotes
   - Enhanced animations make highlighted text more visible
   - Page borders flash to indicate successful navigation
4. **Smart Search**: Uses both exact and fuzzy matching to find text
5. **Precise Positioning**: Automatically scrolls to the exact location of quoted text

This makes it easy to verify AI responses and explore the source material in detail.

## File Structure

```
skim2/
├── backend/
│   ├── app_simple.py          # Simplified Flask backend
│   ├── database_simple.py     # Simplified database models
│   ├── init_simple_db.py      # Database initialization
│   └── uploads/               # PDF file storage
├── src/
│   ├── App_simple.jsx         # Simplified React frontend
│   └── main.jsx               # Updated to use simplified app
├── run_simple.sh              # Startup script
└── README_SIMPLE.md           # This file
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/upload` - Upload PDF file
- `GET /api/documents` - List all documents
- `GET /api/documents/{id}` - Get document details
- `GET /api/documents/{id}/file` - Download PDF file
- `DELETE /api/documents/{id}` - Delete document
- `POST /api/chat` - Send chat message
- `GET /api/chat/sessions/{id}` - Get chat session
- `DELETE /api/chat/sessions/{id}` - Delete chat session
- `GET /api/documents/{id}/chat-sessions` - Get chat sessions for document

## Configuration

Edit the `.env` file to configure:

```env
GOOGLE_API_KEY=your_gemini_api_key_here
FLASK_ENV=development
DEBUG=True
```

## Troubleshooting

### Common Issues

1. **"GOOGLE_API_KEY not found"**
   - Make sure you have a valid Google Gemini API key in your `.env` file

2. **"Database error"**
   - Run `python backend/init_simple_db.py` to reset the database

3. **"Port already in use"**
   - Change the port in `app_simple.py` or kill the process using the port

4. **"Module not found"**
   - Make sure you're in the virtual environment: `source backend/venv/bin/activate`

### Reset Everything

To completely reset the application:

```bash
# Remove database
rm backend/skim2_local.db

# Remove uploaded files
rm -rf backend/uploads/*

# Reinitialize database
python backend/init_simple_db.py
```

## Security Notes

- This simplified version has **no authentication** - anyone with access to your computer can use it
- All data is stored locally - no data is sent to external servers (except for AI API calls)
- PDF files are stored in the `backend/uploads/` directory
- Database is stored as `backend/skim2_local.db`

## Differences from Full Version

- ❌ No user authentication
- ❌ No multi-user support
- ❌ No rate limiting
- ❌ No security headers
- ✅ Simpler setup
- ✅ Local-only storage
- ✅ Faster startup
- ✅ Easier debugging

Perfect for personal use and development!
