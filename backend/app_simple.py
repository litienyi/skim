"""
Simplified Flask Application for SKIM2 - Direct File Access
Allows users to open PDF files directly from their file system using absolute paths.
"""

import os
import logging
import time
import urllib.parse
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, send_file, current_app
from flask_cors import CORS
import fitz  # PyMuPDF
import json
import google.generativeai as genai
from dotenv import load_dotenv, find_dotenv
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import threading

# Load environment variables
dotenv_path = find_dotenv()
load_dotenv(dotenv_path)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure Gemini
api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    logger.error("GOOGLE_API_KEY not found in environment variables. Please set it in a .env file.")
    logger.error("Chat functionality will not work without a valid API key.")
else:
    logger.info("Gemini API key found and configured.")
    
genai.configure(api_key=api_key)
model = genai.GenerativeModel('models/gemini-2.5-flash')

# Define structured response schema for chat
chat_response_schema = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "string",
            "description": "The main answer to the user's question, providing comprehensive analysis and explanation"
        },
        "references": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "page": {
                        "type": "integer",
                        "description": "The page number where the reference was found"
                    },
                    "quote": {
                        "type": "string",
                        "description": "The exact quote or supporting text from the document"
                    },
                    "context": {
                        "type": "string",
                        "description": "Brief context about what this reference supports"
                    }
                },
                "required": ["page", "quote"]
            },
            "description": "List of specific references with page numbers and quotes that support the answer"
        }
    },
    "required": ["answer", "references"]
}

# Flask app setup
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5173", "http://127.0.0.1:5173"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# Import simplified database
from database_simple import (
    init_db, save_document, get_all_documents, get_document_by_id, delete_document,
    save_chat_session, save_chat_message, get_chat_session, delete_chat_session,
    document_exists_by_file_path, get_document_by_file_path, update_document_name, update_document_text,
    get_chat_sessions_for_document
)

# Initialize database
init_db()

def extract_text_from_pdf(file_path):
    """Extract text from PDF using PyMuPDF."""
    try:
        doc = fitz.open(file_path)
        text_content = ""
        pages_data = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text()
            text_content += f"\n--- Page {page_num + 1} ---\n{text}\n"
            
            # Store page data
            pages_data.append({
                'page_number': page_num + 1,
                'text_content': text,
                'words': []
            })
            
            # Extract word-level data for highlighting
            words = page.get_text("words")
            for word in words:
                pages_data[page_num]['words'].append({
                    'text': word[4],
                    'x': word[0],
                    'y': word[1],
                    'width': word[2] - word[0],
                    'height': word[3] - word[1],
                    'page': page_num + 1
                })
        
        doc.close()
        return text_content, pages_data
        
    except Exception as e:
        logger.error(f"Error extracting text from PDF: {e}")
        raise

# =============================================================================
# REQUEST LOGGING MIDDLEWARE
# =============================================================================

@app.before_request
def log_request():
    """Log all incoming requests for debugging."""
    logger.info(f"=== INCOMING REQUEST ===")
    logger.info(f"Method: {request.method}")
    logger.info(f"URL: {request.url}")
    logger.info(f"Path: {request.path}")
    logger.info(f"Headers: {dict(request.headers)}")
    if request.method in ['POST', 'PUT', 'PATCH']:
        try:
            logger.info(f"Body: {request.get_data(as_text=True)}")
        except:
            logger.info("Body: [Could not read]")

# =============================================================================
# FILE BROWSING ENDPOINTS
# =============================================================================

@app.route('/api/browse-directory', methods=['POST'])
def browse_directory():
    """Browse files in a directory."""
    logger.info("=== BROWSE DIRECTORY ENDPOINT CALLED ===")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Request URL: {request.url}")
    
    try:
        data = request.get_json()
        logger.info(f"Request data: {data}")
        
        if not data or 'directory_path' not in data:
            logger.error("No directory path provided")
            return jsonify({'error': 'No directory path provided'}), 400
        
        directory_path = data['directory_path']
        logger.info(f"Browsing directory: {directory_path}")
        
        # Validate directory exists
        if not os.path.exists(directory_path):
            logger.error(f"Directory does not exist: {directory_path}")
            return jsonify({'error': 'Directory does not exist'}), 404
        
        if not os.path.isdir(directory_path):
            logger.error(f"Path is not a directory: {directory_path}")
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # List files in directory
        files = []
        try:
            for item in os.listdir(directory_path):
                item_path = os.path.join(directory_path, item)
                if os.path.isfile(item_path) and item.lower().endswith('.pdf'):
                    file_info = {
                        'name': item,
                        'path': item_path,
                        'size': os.path.getsize(item_path),
                        'modified': datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat()
                    }
                    files.append(file_info)
        except PermissionError:
            logger.error(f"Permission denied accessing directory: {directory_path}")
            return jsonify({'error': 'Permission denied accessing directory'}), 403
        
        # Sort files by name
        files.sort(key=lambda x: x['name'].lower())
        
        logger.info(f"Found {len(files)} PDF files in directory")
        
        return jsonify({
            'directory_path': directory_path,
            'files': files,
            'count': len(files)
        }), 200
        
    except Exception as e:
        logger.error(f"Error browsing directory: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': f'Failed to browse directory: {str(e)}'}), 500

# =============================================================================
# FILE UPLOAD ENDPOINTS
# =============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload a PDF file."""
    logger.info("=== UPLOAD FILE ENDPOINT CALLED ===")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request headers: {dict(request.headers)}")
    
    try:
        if 'file' not in request.files:
            logger.error("No file part in request")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error("No file selected")
            return jsonify({'error': 'No file selected'}), 400
        
        logger.info(f"Uploaded file: {file.filename}")
        
        # Check if it's a PDF
        if not file.filename.lower().endswith('.pdf'):
            logger.error(f"File is not a PDF: {file.filename}")
            return jsonify({'error': 'Only PDF files are supported'}), 400
        
        # Create uploads directory if it doesn't exist
        upload_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
        os.makedirs(upload_folder, exist_ok=True)
        
        # Generate a unique filename to avoid conflicts
        import uuid
        unique_filename = f"{uuid.uuid4()}_{file.filename}"
        file_path = os.path.join(upload_folder, unique_filename)
        
        logger.info(f"Saving file to: {file_path}")
        
        # Save the file
        file.save(file_path)
        
        # Get file info
        file_size = os.path.getsize(file_path)
        filename = file.filename
        
        logger.info(f"File saved. Size: {file_size}, Filename: {filename}")
        
        # Check if file already exists in database
        existing_doc = get_document_by_file_path(file_path)
        if existing_doc:
            logger.info(f"PDF already exists in database: {file_path}")
            return jsonify({
                'message': 'PDF already exists in database',
                'file_path': existing_doc['file_path'],
                'filename': existing_doc['filename'],
                'status': 'exists',
                'document': existing_doc
            }), 200
        
        # Extract text from the PDF
        logger.info("Starting text extraction from uploaded PDF...")
        text_content, pages_data = extract_text_from_pdf(file_path)
        logger.info(f"Text extraction completed. Pages: {len(pages_data)}")
        
        # Store document data
        doc_data = {
            'file_path': file_path,
            'filename': filename,
            'text_content': text_content,
            'pages': pages_data,
            'num_pages': len(pages_data),
            'uploaded_at': datetime.utcnow().isoformat(),
            'file_size': file_size
        }
        
        logger.info(f"Document data prepared: {doc_data['filename']}, {doc_data['num_pages']} pages")
        
        # Save to database
        logger.info("Saving uploaded document to database...")
        save_document(doc_data)
        logger.info("Uploaded document saved to database successfully")
        
        response_data = {
            'message': 'PDF uploaded successfully',
            'file_path': file_path,
            'filename': filename,
            'status': 'uploaded',
            'document': doc_data
        }
        logger.info(f"Returning upload success response: {response_data['filename']}")
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': f'Failed to upload file: {str(e)}'}), 500

# =============================================================================
# DIRECT FILE ACCESS ENDPOINTS
# =============================================================================

@app.route('/api/open-file', methods=['POST'])
def open_file():
    """Open a PDF file directly from the file system."""
    logger.info("=== OPEN FILE ENDPOINT CALLED ===")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request body: {request.get_data(as_text=True)}")
    
    try:
        data = request.get_json()
        logger.info(f"Parsed JSON data: {data}")
        if not data or 'file_path' not in data:
            logger.error("No file path provided in request")
            return jsonify({'error': 'No file path provided'}), 400
        
        file_path = data['file_path']
        logger.info(f"Original file_path from request: '{file_path}'")
        
        # Clean up file path - remove any newlines or other problematic characters
        file_path = file_path.replace('\n', '').replace('\r', '').strip()
        logger.info(f"Cleaned file_path: '{file_path}'")
        
        # Validate file path
        logger.info(f"Checking if file exists: {file_path}")
        logger.info(f"File exists: {os.path.exists(file_path)}")
        if not os.path.exists(file_path):
            logger.error(f"File not found on disk: {file_path}")
            return jsonify({'error': 'File not found'}), 404
        
        if not file_path.lower().endswith('.pdf'):
            logger.error(f"File is not a PDF: {file_path}")
            return jsonify({'error': 'Only PDF files are supported'}), 400
        
        # Get file info
        file_size = os.path.getsize(file_path)
        filename = os.path.basename(file_path)
        logger.info(f"File size: {file_size}")
        logger.info(f"Filename: '{filename}'")
        
        # Clean up filename - remove any newlines or other problematic characters
        filename = filename.replace('\n', '').replace('\r', '').strip()
        logger.info(f"Cleaned filename: '{filename}'")
        
        # Check if file already exists in database
        logger.info(f"Checking if file exists in database: {file_path}")
        existing_doc = get_document_by_file_path(file_path)
        logger.info(f"Existing document found: {existing_doc is not None}")
        if existing_doc:
            logger.info(f"PDF already exists in database: {file_path}")
            return jsonify({
                'message': 'PDF already exists in database',
                'file_path': existing_doc['file_path'],
                'filename': existing_doc['filename'],
                'status': 'exists',
                'document': existing_doc
            }), 200
        
        # Extract text from the PDF
        logger.info("Starting text extraction from PDF...")
        text_content, pages_data = extract_text_from_pdf(file_path)
        logger.info(f"Text extraction completed. Pages: {len(pages_data)}")
        
        # Store document data with absolute file path
        doc_data = {
            'file_path': file_path,  # Use absolute path
            'filename': filename,
            'text_content': text_content,
            'pages': pages_data,
            'num_pages': len(pages_data),
            'uploaded_at': datetime.utcnow().isoformat(),
            'file_size': file_size
        }
        logger.info(f"Document data prepared: {doc_data['filename']}, {doc_data['num_pages']} pages")
        
        # Save to database
        logger.info("Saving document to database...")
        save_document(doc_data)
        logger.info("Document saved to database successfully")
        
        logger.info(f"PDF opened successfully: {filename} (Path: {file_path})")
        
        response_data = {
            'message': 'PDF opened successfully',
            'file_path': file_path,
            'filename': filename,
            'status': 'opened',
            'document': doc_data
        }
        logger.info(f"Returning success response: {response_data['filename']}")
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Error opening file: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': f'Failed to open file: {str(e)}'}), 500

@app.route('/api/documents', methods=['GET'])
def get_documents():
    """Get list of opened documents."""
    try:
        documents = get_all_documents()
        return jsonify({'documents': documents}), 200
        
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        return jsonify({'error': 'Failed to get documents'}), 500

@app.route('/api/documents/<path:file_path>', methods=['GET'])
def get_document(file_path):
    """Get document by file path."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        document = get_document_by_file_path(file_path)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        return jsonify(document), 200
    except Exception as e:
        logger.error(f"Error getting document: {e}")
        return jsonify({'error': 'Failed to get document'}), 500

@app.route('/api/documents/<path:file_path>/file', methods=['GET'])
def serve_document_file(file_path):
    """Serve document file."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        logger.info(f"=== SERVE DOCUMENT FILE CALLED ===")
        logger.info(f"Requested file path: {file_path}")
        
        document = get_document_by_file_path(file_path)
        if not document:
            logger.error(f"Document not found in database for path: {file_path}")
            return jsonify({'error': 'Document not found'}), 404
        
        logger.info(f"Document found in database: {document['filename']}")
        
        # Check if file exists on disk
        if os.path.exists(file_path):
            logger.info(f"File exists on disk: {file_path}")
            return send_file(file_path, as_attachment=False)
        else:
            logger.error(f"File not found on disk: {file_path}")
            return jsonify({'error': 'File not found on disk'}), 404
                
    except Exception as e:
        logger.error(f"Error serving document file: {e}")
        return jsonify({'error': 'Failed to serve document file'}), 500

@app.route('/api/documents/<path:file_path>', methods=['DELETE'])
def delete_document_endpoint(file_path):
    """Delete document by file path."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        if delete_document(file_path):
            return jsonify({'message': 'Document deleted successfully'}), 200
        else:
            return jsonify({'error': 'Document not found'}), 404
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        return jsonify({'error': 'Failed to delete document'}), 500

@app.route('/api/documents/<path:file_path>/rename', methods=['PUT'])
def rename_document(file_path):
    """Rename document display name."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        data = request.get_json()
        if not data or 'new_name' not in data:
            return jsonify({'error': 'No new name provided'}), 400
        
        new_name = data['new_name']
        
        if update_document_name(file_path, new_name):
            return jsonify({'message': 'Document renamed successfully'}), 200
        else:
            return jsonify({'error': 'Document not found'}), 404
    except Exception as e:
        logger.error(f"Error renaming document: {e}")
        return jsonify({'error': 'Failed to rename document'}), 500

@app.route('/api/documents/<path:file_path>/extract-text', methods=['POST'])
def extract_text_endpoint(file_path):
    """Re-extract text from PDF."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        document = get_document_by_file_path(file_path)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Extract text from the PDF
        text_content, pages_data = extract_text_from_pdf(file_path)
        
        # Update document in database
        if update_document_text(file_path, text_content, pages_data):
            return jsonify({'message': 'Text extraction completed successfully'}), 200
        else:
            return jsonify({'error': 'Failed to update document'}), 500
            
    except Exception as e:
        logger.error(f"Error extracting text: {e}")
        return jsonify({'error': f'Failed to extract text: {str(e)}'}), 500

@app.route('/api/documents/<path:file_path>/ocr', methods=['POST'])
def process_ocr_endpoint(file_path):
    """Process OCR on PDF."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        # Flask's path parameter strips leading slash, so we need to add it back
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        document = get_document_by_file_path(file_path)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Import the OCR function
        import sys
        import os
        
        # Add the OCR tool directory to Python path
        ocr_tool_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ocr_tool')
        if ocr_tool_path not in sys.path:
            sys.path.insert(0, ocr_tool_path)
        
        try:
            from simple_ocr import make_pdf_searchable
        except ImportError as e:
            logger.error(f"Failed to import OCR module: {e}")
            return jsonify({'error': 'OCR module not available'}), 500
        
        logger.info(f"Starting OCR processing for: {file_path}")
        
        try:
            # Process OCR on the PDF file
            success = make_pdf_searchable(file_path, language='eng')
            
            if success:
                # Re-extract text from the OCR'd PDF
                text_content, pages_data = extract_text_from_pdf(file_path)
                
                # Update document in database with new text
                if update_document_text(file_path, text_content, pages_data):
                    logger.info(f"OCR processing completed successfully for: {file_path}")
                    return jsonify({'message': 'OCR processing completed successfully'}), 200
                else:
                    logger.error(f"Failed to update document text after OCR: {file_path}")
                    return jsonify({'error': 'Failed to update document text'}), 500
            else:
                logger.error(f"OCR processing failed for: {file_path}")
                return jsonify({'error': 'OCR processing failed - the PDF may already be searchable or encrypted'}), 500
                
        except Exception as ocr_error:
            logger.error(f"OCR processing error for {file_path}: {ocr_error}")
            return jsonify({'error': f'OCR processing error: {str(ocr_error)}'}), 500
            
    except Exception as e:
        logger.error(f"Error processing OCR: {e}")
        return jsonify({'error': f'Failed to process OCR: {str(e)}'}), 500

# =============================================================================
# CHAT ENDPOINTS
# =============================================================================

@app.route('/api/chat', methods=['POST'])
def chat():
    """Chat with Gemini about a document."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        message = data.get('message')
        document_id = data.get('document_id')  # This is now the file path
        page_range = data.get('page_range', [1, 1])
        chat_session_id = data.get('chat_session_id')
        
        # Debug logging for API call tracking
        logger.info("=== GEMINI API CALL START ===")
        logger.info(f"Document: {document_id}")
        logger.info(f"Page range: {page_range}")
        logger.info(f"Page range type: {type(page_range)}")
        if isinstance(page_range, dict):
            logger.info(f"Page range keys: {list(page_range.keys())}")
            if 'pages' in page_range:
                logger.info(f"Specific pages count: {len(page_range['pages'])}")
                logger.info(f"First 10 pages: {page_range['pages'][:10]}")
                logger.info(f"Last 10 pages: {page_range['pages'][-10:]}")
        logger.info(f"Message length: {len(message)} characters")
        logger.info(f"Chat session ID: {chat_session_id}")
        
        if not message or not document_id:
            return jsonify({'error': 'Message and document_id are required'}), 400
        
        # Get document
        document = get_document_by_file_path(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Create or get chat session
        if not chat_session_id:
            chat_session_id = str(uuid.uuid4())
            session_data = {
                'id': chat_session_id,
                'document_file_path': document_id,
                'created_at': datetime.utcnow().isoformat()
            }
            save_chat_session(session_data)
        
        # Save user message
        user_message_data = {
            'id': str(uuid.uuid4()),
            'chat_session_id': chat_session_id,
            'role': 'user',
            'content': message,
            'timestamp': datetime.utcnow().isoformat(),
            'page_range': page_range
        }
        save_chat_message(user_message_data)
        
        # Prepare context text based on page range
        if page_range and isinstance(page_range, dict) and page_range.get('type') == 'specific_pages':
            # Handle specific pages list (bracketed input)
            specific_pages = page_range.get('pages', [])
            logger.info(f"Processing specific pages: {len(specific_pages)} pages requested")
            logger.info(f"Specific pages range: {min(specific_pages)}-{max(specific_pages)}")
            if document.get('pages'):
                context_pages = [page for page in document['pages'] if page['page_number'] in specific_pages]
                logger.info(f"Found {len(context_pages)} matching pages in document")
                context_text = "\n".join([f"--- Page {page['page_number']} ---\n{page['text_content']}" for page in context_pages])
                logger.info(f"Context prepared: specific pages {min(specific_pages)}-{max(specific_pages)} ({len(context_pages)} pages, {len(context_text)} characters)")
            else:
                context_text = document['text_content']
                logger.info(f"Context prepared: full document ({len(context_text)} characters)")
        elif page_range and len(page_range) >= 2:
            # Handle regular range
            start_page = max(1, page_range[0])
            end_page = min(document.get('num_pages', 999), page_range[1])
            if document.get('pages'):
                context_pages = [page for page in document['pages'] if start_page <= page['page_number'] <= end_page]
                context_text = "\n".join([f"--- Page {page['page_number']} ---\n{page['text_content']}" for page in context_pages])
                logger.info(f"Context prepared: pages {start_page}-{end_page} ({len(context_pages)} pages, {len(context_text)} characters)")
            else:
                context_text = document['text_content']
                logger.info(f"Context prepared: full document ({len(context_text)} characters)")
        else:
            context_text = document['text_content']
            logger.info(f"Context prepared: full document ({len(context_text)} characters)")
        
        # Prepare prompt for structured response with references
        prompt = f"""You are an expert academic professor explaining to a graduate student. The user uploaded a PDF. Here is the document content:

{context_text}

User question: {message}

For every claim or point in your answer, please provide the exact supporting sentence(s) from the PDF, and reference the page number where you found the information.

Please provide a comprehensive answer with specific references to the source material."""
        
        # Get structured response from Gemini with references
        logger.info("Making Gemini API call...")
        try:
            response = model.generate_content(
                prompt,
                generation_config={
                    "response_mime_type": "application/json",
                    "response_schema": chat_response_schema,
                    "temperature": 0
                }
            )
            
            # Parse the structured response
            try:
                response_json = json.loads(response.text)
                content = response_json.get('answer', '')
                references = response_json.get('references', [])
                
                # Log the structured response summary
                logger.info(f"Gemini API call successful: {len(content)} characters, {len(references)} references")
                
            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")
                logger.error(f"Raw response: {response.text}")
                # Fallback to plain text if JSON parsing fails
                content = response.text
                references = []
                
        except Exception as e:
            logger.error(f"Error generating structured response: {e}")
            # Fallback to simple response
            response = model.generate_content(prompt)
            content = response.text
            references = []
        
        # Save assistant message
        assistant_message_data = {
            'id': str(uuid.uuid4()),
            'chat_session_id': chat_session_id,
            'role': 'assistant',
            'content': content,
            'timestamp': datetime.utcnow().isoformat(),
            'page_range': page_range,
            'references': references
        }
        save_chat_message(assistant_message_data)
        
        logger.info("=== GEMINI API CALL END ===")
        
        return jsonify({
            'message': content,
            'chat_session_id': chat_session_id,
            'references': references
        }), 200
        
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': f'Chat failed: {str(e)}'}), 500

@app.route('/api/chat/sessions/<session_id>', methods=['GET'])
def get_chat_session_endpoint(session_id):
    """Get chat session with messages."""
    try:
        session = get_chat_session(session_id)
        if not session:
            return jsonify({'error': 'Chat session not found'}), 404
        
        return jsonify(session), 200
    except Exception as e:
        logger.error(f"Error getting chat session: {e}")
        return jsonify({'error': 'Failed to get chat session'}), 500

@app.route('/api/chat/sessions/<session_id>', methods=['DELETE'])
def delete_chat_session_endpoint(session_id):
    """Delete chat session."""
    try:
        if delete_chat_session(session_id):
            return jsonify({'message': 'Chat session deleted successfully'}), 200
        else:
            return jsonify({'error': 'Chat session not found'}), 404
    except Exception as e:
        logger.error(f"Error deleting chat session: {e}")
        return jsonify({'error': 'Failed to delete chat session'}), 500

@app.route('/api/documents/<path:file_path>/chat-sessions', methods=['GET'])
def get_chat_sessions_for_document_endpoint(file_path):
    """Get all chat sessions for a document."""
    try:
        # Decode the file path from URL using proper URL decoding
        file_path = urllib.parse.unquote(file_path)
        
        # Add leading slash if not present to match database format
        if not file_path.startswith('/'):
            file_path = '/' + file_path
        
        logger.info(f"=== GET CHAT SESSIONS FOR DOCUMENT ===")
        logger.info(f"Requested file path: {file_path}")
        
        sessions = get_chat_sessions_for_document(file_path)
        logger.info(f"Found {len(sessions)} chat sessions for document")
        
        return jsonify({'chat_sessions': sessions}), 200
    except Exception as e:
        logger.error(f"Error getting chat sessions: {e}")
        return jsonify({'error': 'Failed to get chat sessions'}), 500

# =============================================================================
# HEALTH CHECK
# =============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'gemini_configured': bool(api_key)
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
