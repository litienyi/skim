# 📊 Skim - Excel-like AI Analysis Spreadsheet

A modern React + Flask application that provides a true Excel-like spreadsheet interface for AI-powered text analysis using Google's Gemini AI. Enter formulas like `=ANALYZE(A1, "What is the main topic?")` to analyze your data.

## 🚀 Quick Start

### Option 1: One-Command Setup (Recommended)
```bash
python run.py
```

This will:
- ✅ Check and install dependencies
- ✅ Start the Flask backend server (port 5001)
- ✅ Start the React frontend server (port 5173)
- ✅ Open the application in your browser

### Option 2: Manual Setup

#### Backend Setup
```bash
cd backend
pip install -r requirements.txt
python app.py
```

#### Frontend Setup
```bash
npm install
npm run dev
```

## 🔧 Configuration

### Required: Google Gemini API Key
Create a `.env` file in the project root:
```env
GOOGLE_API_KEY=your_gemini_api_key_here
```

Get your API key from: https://makersuite.google.com/app/apikey

## 📖 How to Use

1. **Load Your Data**
   - Click "📁 Load Data" to upload a text file
   - Data will populate in column A (A1, A2, A3, etc.)
   - Each line becomes one cell in the spreadsheet

2. **Enter Formulas**
   - Click any cell and type a formula like:
     - `=ANALYZE(A1, "What is the main research area?")`
     - `=ANALYZE(A1:A5, "Which universities are mentioned?")`
     - `=ANALYZE(A1:A10, "What are the key achievements?")`

3. **Excel-like Navigation**
   - **Click** to select a cell
   - **Double-click** to edit
   - **Enter** to move down
   - **Tab** to move right
   - **Escape** to cancel editing
   - **Arrow keys** to navigate
   - **Ctrl+V** to paste multi-line data (auto-delimits)
   - **Ctrl+C** to copy cell content
   - **Delete/Backspace** to clear cell

4. **View Results**
   - Formula cells show AI analysis results
   - Click on result cells to see detailed references
   - Export your entire spreadsheet to CSV

## 🎯 Features

### 📊 Excel-like Interface
- **True spreadsheet layout** with A1, B1, C1... cell references
- **Formula support** with `=ANALYZE()` function
- **Excel navigation** (click, double-click, Enter, Tab, Escape, arrow keys)
- **Real-time calculation** with loading indicators
- **Auto-delimiting paste** - paste multi-line data to automatically separate into rows
- **Dynamic grid expansion** - automatically grows to accommodate your data (100+ rows, 15+ columns)

### 🤖 AI-Powered Analysis
- **Batch processing** handles large datasets efficiently
- **Structured output** with answers, references, and summaries
- **Direct quotes** with source context and relevance scores

### 📁 File Management
- **Data loading** into column A (A1, A2, A3...)
- **CSV export** of entire spreadsheet
- **Formula persistence** and error handling

### 🔍 Interactive References
- **Clickable cells** show detailed analysis in modal
- **Quote display** with source and relevance scores
- **Professional modal interface**

## 🛠️ Technical Stack

### Frontend
- **React 18** with modern hooks
- **CSS Grid** for spreadsheet layout
- **Responsive design** with mobile support

### Backend
- **Flask** Python web framework
- **Google Gemini AI** for text analysis
- **Pydantic** for data validation
- **SQLite** for data storage

### AI Integration
- **Structured output** using Pydantic schemas
- **Batch processing** to handle token limits
- **Fallback parsing** for compatibility
- **Comprehensive error handling**

## 📁 Project Structure

```
skim2/
├── run.py                 # One-command startup script
├── test_data.txt          # Sample data for testing
├── .env                   # API key configuration
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AnalysisGrid.jsx    # Main grid component
│   │   │   └── AnalysisGrid.css    # Grid styling
│   │   ├── App.jsx                 # Main app component
│   │   └── App.css                 # App styling
│   └── package.json
└── backend/
    ├── app.py             # Flask application
    ├── database.py        # Database operations
    ├── requirements.txt   # Python dependencies
    └── uploads/           # File upload directory
```

## 🧪 Testing

Use the included `sample_data.txt` file to test the application:

```bash
# Start the application
python run.py

# Open http://localhost:5173
# Load sample_data.txt
# Try these formulas:
# B1: =ANALYZE(A1, "What is the main research area?")
# B2: =ANALYZE(A2, "Which university is mentioned?")
# C1: =ANALYZE(A1:A5, "What are the key achievements?")
```

## 🔧 Development

### Running in Development Mode
```bash
# Terminal 1: Backend
cd backend
python app.py

# Terminal 2: Frontend
npm run dev
```

### API Endpoints
- `GET /` - API status
- `POST /api/analyze` - Analyze text data
- `GET /api/documents` - List documents
- `POST /api/upload` - Upload files

## 🐛 Troubleshooting

### Common Issues

1. **"Missing GOOGLE_API_KEY"**
   - Create a `.env` file with your API key
   - Get key from https://makersuite.google.com/app/apikey

2. **"Backend server failed to start"**
   - Install Python dependencies: `pip install -r backend/requirements.txt`
   - Check Python version (3.8+ required)

3. **"Frontend server failed to start"**
   - Install Node.js dependencies: `npm install`
   - Check Node.js version (16+ required)

4. **"Analysis failed"**
   - Check API key is valid
   - Ensure text file format is correct (one entry per line)
   - Check network connection

### Logs
- Backend logs appear with `[Backend]` prefix
- Frontend logs appear with `[Frontend]` prefix
- Check console for detailed error messages

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review the logs for error messages
- Open an issue on GitHub
