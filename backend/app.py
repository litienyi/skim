from flask import Flask, request, jsonify, send_file
import os
import logging
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF
import json
import google.generativeai as genai
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import List
from database import (
    init_db, get_db_session, User, Session, Document, Page, Word, Highlight, ChatSession, ChatMessage
)
from datetime import datetime
import pytesseract
from PIL import Image
from flask_openapi3 import OpenAPI, Info, Tag, APIBlueprint
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import jwt
from functools import wraps
import uuid
from flask_cors import CORS
import time
import re

# Load environment variables
load_dotenv()

# Configure logging first
logging.basicConfig(level=logging.DEBUG)
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

# Debug: Log model configuration
logger.info("=== BACKEND MODEL CONFIG DEBUG ===")
logger.info(f"Model name: {model.model_name}")
logger.info(f"Model type: {type(model)}")
logger.info("===================================")

# OpenAPI schema for /api/chat response
# Define OpenAPI schemas for Gemini API
reference_schema = {
    "type": "object",
    "properties": {
        "page": {"type": "integer"},
        "quote": {"type": "string"}
    },
    "required": ["page", "quote"]
}

chat_response_schema = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "references": {
            "type": "array",
            "items": reference_schema
        }
    },
    "required": ["answer", "references"]
}

# Keep Pydantic models for OpenAPI documentation
class Reference(BaseModel):
    page: int = Field(..., description="Page number")
    quote: str = Field(..., description="Quoted phrase from the PDF")

class ChatResponseSchema(BaseModel):
    answer: str = Field(..., description="Markdown answer to the user's question about the PDF")
    references: List[Reference] = Field(..., description="List of references to the PDF")

chat_tag = Tag(name="chat", description="Chat with Gemini about PDF content")

chat_api = APIBlueprint('chat', __name__, url_prefix='/api')

# Remove unused Pydantic models and legacy code
# Only keep Reference and ChatResponseSchema as they are used in OpenAPI schema and chat endpoint
class Reference(BaseModel):
    page: int = Field(..., description="Page number")
    quote: str = Field(..., description="Quoted phrase from the PDF")

class ChatResponseSchema(BaseModel):
    answer: str = Field(..., description="Markdown answer to the user's question about the PDF")
    references: List[Reference] = Field(..., description="List of references to the PDF")

# Remove unused RelevantSentence and ChatResponse classes

# OpenAPI app setup
info = Info(title='PDF Layout Tool API', version='1.0.0')
app = OpenAPI(__name__, info=info)
CORS(app, origins=["http://localhost:5173"], supports_credentials=True)

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Initialize database
init_db()

# Utility: Extract word bounding boxes from an image using pytesseract

def format_complex_page_range(page_batch):
    """
    Format a list of page numbers into a readable range string.
    Examples:
    - [9, 10, 11, 12] -> "9-12"
    - [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] -> "15-31"
    - [96, 97, 98, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157] -> "96-98, 131-157"
    """
    if not page_batch:
        return ""
    
    if len(page_batch) == 1:
        return str(page_batch[0])
    
    # Sort the pages to ensure proper range detection
    sorted_pages = sorted(page_batch)
    ranges = []
    start = sorted_pages[0]
    end = sorted_pages[0]
    
    for i in range(1, len(sorted_pages)):
        if sorted_pages[i] == end + 1:
            # Consecutive page, extend range
            end = sorted_pages[i]
        else:
            # Gap found, save current range and start new one
            if start == end:
                ranges.append(str(start))
            else:
                ranges.append(f"{start}-{end}")
            start = sorted_pages[i]
            end = sorted_pages[i]
    
    # Add the last range
    if start == end:
        ranges.append(str(start))
    else:
        ranges.append(f"{start}-{end}")
    
    return ", ".join(ranges)

def parse_page_ranges(page_range_input):
    """
    Parse page ranges from semicolon-delimited string with square bracket grouping.
    Examples:
    - "1-50;51-98" -> [[1,2,...,50], [51,52,...,98]]
    - "11-17;18-54;55-95;[96-98;131-157];158-222" -> [[11...17], [18...54], [55...95], [96,97,98,131,132,...,157], [158...222]]
    """
    if not page_range_input:
        return []
    
    batches = []
    
    # First, handle bracket groups by replacing them with placeholders
    bracket_groups = []
    bracket_counter = 0
    
    def replace_brackets(match):
        nonlocal bracket_counter
        bracket_content = match.group(1)
        placeholder = f"__BRACKET_{bracket_counter}__"
        bracket_groups.append((placeholder, bracket_content))
        bracket_counter += 1
        return placeholder
    
    # Replace all bracket groups with placeholders
    processed_input = re.sub(r'\[([^\]]+)\]', replace_brackets, page_range_input)
    
    # Now split by semicolon
    ranges = processed_input.split(';')
    
    for range_str in ranges:
        range_str = range_str.strip()
        
        # Check if this is a bracket placeholder
        bracket_match = re.match(r'__BRACKET_(\d+)__', range_str)
        if bracket_match:
            bracket_index = int(bracket_match.group(1))
            bracket_content = bracket_groups[bracket_index][1]
            
            # Parse the bracket content
            bracket_ranges = bracket_content.split(';')
            combined_pages = []
            
            for bracket_range in bracket_ranges:
                bracket_range = bracket_range.strip()
                if '-' in bracket_range:
                    start, end = bracket_range.split('-')
                    try:
                        start_page = int(start.strip())
                        end_page = int(end.strip())
                        combined_pages.extend(range(start_page, end_page + 1))
                    except ValueError:
                        logger.warning(f"Invalid page range format in brackets: {bracket_range}")
                else:
                    try:
                        single_page = int(bracket_range)
                        combined_pages.append(single_page)
                    except ValueError:
                        logger.warning(f"Invalid page number in brackets: {bracket_range}")
            
            if combined_pages:
                batches.append(combined_pages)
                logger.info(f"Bracket group parsed: {combined_pages}")
        
        # Handle regular ranges
        elif '-' in range_str:
            # Handle double dash case
            if '--' in range_str:
                logger.warning(f"Invalid page range format (double dash): {range_str}")
                continue
                
            start, end = range_str.split('-')
            try:
                start_page = int(start.strip())
                end_page = int(end.strip())
                batch = list(range(start_page, end_page + 1))
                batches.append(batch)
            except ValueError:
                logger.warning(f"Invalid page range format: {range_str}")
        else:
            try:
                single_page = int(range_str)
                batches.append([single_page])
            except ValueError:
                logger.warning(f"Invalid page number: {range_str}")
    
    return batches

def extract_word_boxes(image):
    # Returns a list of dicts: {text, x, y, width, height, confidence}
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    words = []
    n = len(data['text'])
    for i in range(n):
        if data['text'][i].strip() != '':
            words.append({
                'text': data['text'][i],
                'x': data['left'][i],
                'y': data['top'][i],
                'width': data['width'][i],
                'height': data['height'][i],
                'confidence': float(data['conf'][i]) if data['conf'][i] != '-1' else None
            })
    return words

SECRET_KEY = os.getenv('SECRET_KEY', 'dev_secret')

# --- Session Management (per document upload) ---
def get_or_create_session_token(document_id):
    session = get_db_session()
    # Try to find an existing session for this document
    doc_session = session.query(Session).filter_by(document_id=document_id).first()
    if doc_session:
        token = doc_session.session_token
    else:
        token = str(uuid.uuid4())
        doc_session = Session(
            document_id=document_id,
            session_token=token,
            created_at=datetime.now(),
            expires_at=None
        )
        session.add(doc_session)
        session.commit()
    session.close()
    return token

def session_token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': 'Session token is missing!'}), 401
        session = get_db_session()
        doc_session = session.query(Session).filter_by(session_token=token).first()
        if not doc_session:
            session.close()
            return jsonify({'error': 'Session token is invalid!'}), 401
        document_id = doc_session.document_id
        session.close()
        return f(document_id, *args, **kwargs)
    return decorated

# Update upload_file to generate and return a session token
@app.route('/api/upload', methods=['POST'])
def upload_file():
    session = get_db_session()
    try:
        logger.debug("=== UPLOAD REQUEST ===")
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        if file and file.filename.endswith('.pdf'):
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            unique_filename = f"{timestamp}_{filename}"
            input_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(input_path)

            doc = fitz.open(input_path)
            num_pages = doc.page_count
            extracted_text = []
            ocr_pages = []

            # Create Document ORM entry
            document = Document(
                filename=unique_filename,
                original_filename=file.filename,
                created_at=datetime.now(),
                num_pages=num_pages,
                ocr_status='pending',
                meta={}
            )
            session.add(document)
            session.commit()

            for i in range(num_pages):
                page = doc.load_page(i)
                text = page.get_text()
                if not text.strip():
                    # Run OCR if no text found
                    pix = page.get_pixmap()
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    ocr_text = pytesseract.image_to_string(img)
                    text = ocr_text
                    ocr_pages.append(i+1)
                extracted_text.append(text)

                # Save page ORM entry
                page_orm = Page(
                    document_id=document.id,
                    page_number=i+1,
                    ocr_text=text,
                    created_at=datetime.now()
                )
                session.add(page_orm)
                session.commit()

                # Extract and save word bounding boxes
                pix = page.get_pixmap()
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                word_boxes = extract_word_boxes(img)
                for idx, word in enumerate(word_boxes):
                    word_orm = Word(
                        page_id=page_orm.id,
                        word_index=idx,
                        text=word['text'],
                        x=word['x'],
                        y=word['y'],
                        width=word['width'],
                        height=word['height'],
                        confidence=word['confidence'],
                        created_at=datetime.now()
                    )
                    session.add(word_orm)
                session.commit()
            doc.close()
            # Save extracted text to a .json file for later retrieval
            text_path = input_path + '.json'
            with open(text_path, 'w') as f:
                json.dump({"pages": extracted_text}, f)
            document.ocr_status = 'done'
            session.commit()
            # Generate and return a session token for this document
            session_token = get_or_create_session_token(document.id)
            return jsonify({
                'document_id': document.id,
                'filename': unique_filename,
                'num_pages': num_pages,
                'ocr_pages': ocr_pages,
                'session_token': session_token
            })
        else:
            return jsonify({'error': 'Invalid file type'}), 400
    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

@app.route('/api/pdf/<filename>', methods=['GET', 'OPTIONS'])
def get_pdf(filename):
    if request.method == 'OPTIONS':
        # Handle preflight request
        response = jsonify({})
        response.headers['Access-Control-Allow-Origin'] = 'http://localhost:5173'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range, If-Range'
        return response
    
    logger.debug("=== GET PDF REQUEST ===")
    logger.debug(f"Requested filename: {filename}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
        logger.debug(f"Serving file from: {filepath}")
        
        # Check if file exists
        if not os.path.exists(filepath):
            logger.error(f"File not found: {filepath}")
            return jsonify({'error': 'File not found'}), 404
        
        # Handle Range requests properly
        file_size = os.path.getsize(filepath)
        range_header = request.headers.get('Range')
        
        if range_header:
            # Parse range header (e.g., "bytes=0-1023")
            try:
                range_str = range_header.replace('bytes=', '')
                start, end = range_str.split('-')
                start = int(start) if start else 0
                end = int(end) if end else file_size - 1
                
                # Validate range
                if start >= file_size or end >= file_size or start > end:
                    return jsonify({'error': 'Invalid range'}), 416
                
                # Read the requested range
                with open(filepath, 'rb') as f:
                    f.seek(start)
                    data = f.read(end - start + 1)
                
                response = app.response_class(data, 206, mimetype='application/pdf')
                response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
                response.headers['Content-Length'] = str(len(data))
                response.headers['Accept-Ranges'] = 'bytes'
            except Exception as e:
                logger.error(f"Error parsing range: {str(e)}")
                return jsonify({'error': 'Invalid range format'}), 400
        else:
            # Full file request
            response = send_file(filepath, mimetype='application/pdf')
        
        # Add CORS headers
        response.headers['Access-Control-Allow-Origin'] = 'http://localhost:5173'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range, If-Range'
        response.headers['Accept-Ranges'] = 'bytes'
        
        return response
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': str(e)}), 404

@chat_api.post('/chat', tags=[chat_tag], responses={200: ChatResponseSchema})
def chat():
    """Chat with Gemini about the PDF content."""
    try:
        data = request.get_json()
        document_id = int(data.get('document_id')) if data.get('document_id') else None
        message = data.get('message')
        page_range_input = data.get('page_range')  # Can be string like "1-50;51-98" or array
        
        # Debug: Log incoming request
        logger.info("=== BACKEND CHAT REQUEST DEBUG ===")
        logger.info(f"Document ID: {document_id}")
        logger.info(f"User Message: {message}")
        logger.info(f"Page Range Input: {page_range_input}")
        logger.info(f"Page Range Type: {type(page_range_input)}")
        logger.info("==================================")
        
        if not document_id or not message:
            return jsonify({'error': 'Missing document_id or message'}), 400
        
        # Get document from database to find the filename
        session = get_db_session()
        document = session.query(Document).get(document_id)
        if not document:
            session.close()
            return jsonify({'error': 'Document not found'}), 404
        
        # Load extracted text using the document filename
        text_path = os.path.join(app.config['UPLOAD_FOLDER'], document.filename + '.json')
        if not os.path.exists(text_path):
            session.close()
            return jsonify({'error': 'Document text not found'}), 404
        
        with open(text_path, 'r') as f:
            doc_data = json.load(f)
        
        session.close()
        pages = doc_data['pages']
        
        # Debug: Log document info
        logger.info("=== BACKEND DOCUMENT DEBUG ===")
        logger.info(f"Document Filename: {document.filename}")
        logger.info(f"Total Pages in Document: {len(pages)}")
        logger.info(f"Available Pages: 1-{len(pages)}")
        logger.info("===============================")
        
        # Parse page ranges for batching
        if isinstance(page_range_input, str):
            # Handle semicolon-delimited string format with square bracket grouping
            batches = parse_page_ranges(page_range_input)
            logger.info(f"Parsed batches: {batches}")
        else:
            # No page range specified - use all pages as single batch
            batches = [list(range(1, len(pages) + 1))]
            logger.info(f"No page range specified, using all pages: {batches}")
        
        # Process each batch
        all_responses = []
        for batch_index, page_batch in enumerate(batches):
            logger.info(f"=== PROCESSING BATCH {batch_index + 1}/{len(batches)} ===")
            logger.info(f"Pages in batch: {page_batch}")
            
            # Add sleep between API calls (except for the first one)
            if batch_index > 0:
                logger.info(f"Sleeping 10 seconds before batch {batch_index + 1} to avoid rate limits...")
                time.sleep(10)
            
            # Extract text for this batch
            selected_text = ''
            for page_num in page_batch:
                if 1 <= page_num <= len(pages):
                    page_text = pages[page_num - 1]
                    selected_text += f'===START OF PAGE {page_num}===\n{page_text}\n===END OF PAGE {page_num}===\n'
                    logger.info(f"Added page {page_num} to batch context")
                else:
                    logger.warning(f"Page {page_num} is out of range (max: {len(pages)})")
            
            # Generate proper page range display for complex ranges
            page_range_display = format_complex_page_range(page_batch)
            
            # Compose prompt for this batch
            prompt = f"""
You are an expert academic professor explaining to a graduate student. The user uploaded a PDF. Here is the text from pages {page_range_display}.
Each page is marked with '===START OF PAGE X===' and '===END OF PAGE X==='.
{selected_text}
User question: {message}

For every claim or point in your answer, please provide the exact supporting sentence(s) from the PDF, and reference the page number X as shown in the marker.
"""
            
            # Debug: Log the prompt for this batch
            logger.info(f"=== BATCH {batch_index + 1} PROMPT DEBUG ===")
            logger.info(f"Prompt Length: {len(prompt)} characters")
            logger.info(f"Pages: {page_range_display}")
            logger.info("=====================================")
            
            try:
                response = model.generate_content(
                    prompt,
                    generation_config={
                        "response_mime_type": "application/json",
                        "response_schema": chat_response_schema,
                        "temperature": 0
                    }
                )
                logger.info(f"=== BATCH {batch_index + 1} SUCCESS ===")
                logger.info(f"Response Length: {len(response.text)} characters")
                
                # Parse the response
                try:
                    response_json = json.loads(response.text)
                    all_responses.append({
                        'batch': batch_index + 1,
                        'pages': page_range_display,
                        'response': response_json
                    })
                except Exception as e:
                    logger.warning(f"Failed to parse JSON for batch {batch_index + 1}: {str(e)}")
                    # Use fallback parsing
                    all_responses.append({
                        'batch': batch_index + 1,
                        'pages': page_range_display,
                        'response': {'answer': response.text, 'references': []}
                    })
                    
            except Exception as batch_error:
                logger.error(f"=== BATCH {batch_index + 1} ERROR ===")
                logger.error(f"Error: {str(batch_error)}")
                all_responses.append({
                    'batch': batch_index + 1,
                    'pages': page_range_display,
                    'response': {'answer': f'Error processing batch {batch_index + 1}: {str(batch_error)}', 'references': []}
                })
        
        # Return all batch responses
        logger.info(f"=== BATCHING COMPLETE ===")
        logger.info(f"Total batches processed: {len(all_responses)}")
        return jsonify({'batches': all_responses})
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return jsonify({'error': str(e)}), 500

app.register_api(chat_api)

# Refactor highlights and chat endpoints to use session_token and document_id
@app.route('/api/highlights', methods=['POST'])
@session_token_required
def create_highlight(document_id):
    session = get_db_session()
    data = request.get_json()
    page_id = data.get('page_id')
    word_ids = data.get('word_ids')
    color = data.get('color', '#ffe066')
    highlight = Highlight(
        document_id=document_id,
        page_id=page_id,
        word_ids=word_ids,
        color=color,
        created_at=datetime.now()
    )
    session.add(highlight)
    session.commit()
    session.close()
    return jsonify({'message': 'Highlight created'})

@app.route('/api/highlights', methods=['GET'])
@session_token_required
def get_highlights(document_id):
    session = get_db_session()
    page_id = request.args.get('page_id')
    q = session.query(Highlight).filter_by(document_id=document_id)
    if page_id:
        q = q.filter_by(page_id=page_id)
    highlights = q.all()
    session.close()
    return jsonify({'highlights': [
        {'id': h.id, 'document_id': h.document_id, 'page_id': h.page_id, 'word_ids': h.word_ids, 'color': h.color, 'created_at': h.created_at.isoformat()} for h in highlights
    ]})

@app.route('/api/chat_sessions', methods=['POST'])
def create_chat_session():
    session = get_db_session()
    data = request.get_json()
    document_id = data.get('document_id')
    
    if not document_id:
        return jsonify({'error': 'document_id is required'}), 400
    
    chat_session = ChatSession(
        document_id=document_id,
        created_at=datetime.now()
    )
    session.add(chat_session)
    session.commit()
    session_id = chat_session.id
    session.close()
    return jsonify({'id': session_id, 'message': 'Chat session created'})

@app.route('/api/chat_sessions', methods=['GET'])
def get_chat_sessions():
    session = get_db_session()
    document_id = request.args.get('document_id')
    
    if not document_id:
        return jsonify({'error': 'document_id is required'}), 400
    
    chat_sessions = session.query(ChatSession).filter_by(document_id=document_id).order_by(ChatSession.created_at.desc()).all()
    session.close()
    return jsonify([
        {'id': cs.id, 'document_id': cs.document_id, 'created_at': cs.created_at.isoformat()} for cs in chat_sessions
    ])

@app.route('/api/chat_messages', methods=['POST'])
def create_chat_message():
    session = get_db_session()
    data = request.get_json()
    chat_session_id = data.get('chat_session_id')
    sender = data.get('sender')
    message = data.get('message')
    reference_word_ids = data.get('reference_word_ids')
    reference_page = data.get('reference_page')
    reference_quote = data.get('reference_quote')
    page_range = data.get('page_range')
    references = data.get('references')
    
    if not chat_session_id or not sender or not message:
        return jsonify({'error': 'chat_session_id, sender, and message are required'}), 400
    
    chat_message = ChatMessage(
        chat_session_id=chat_session_id,
        sender=sender,
        message=message,
        created_at=datetime.now(),
        reference_word_ids=reference_word_ids,
        reference_page=reference_page,
        reference_quote=reference_quote,
        page_range=page_range,
        references=references
    )
    session.add(chat_message)
    session.commit()
    session.close()
    return jsonify({'message': 'Chat message created'})

@app.route('/api/chat_messages', methods=['GET'])
def get_chat_messages():
    session = get_db_session()
    chat_session_id = request.args.get('chat_session_id')
    
    if not chat_session_id:
        return jsonify({'error': 'chat_session_id is required'}), 400
    
    q = session.query(ChatMessage)
    q = q.filter_by(chat_session_id=chat_session_id)
    messages = q.order_by(ChatMessage.created_at).all()
    session.close()
    return jsonify([
        {'id': m.id, 'chat_session_id': m.chat_session_id, 'sender': m.sender, 'message': m.message, 'created_at': m.created_at.isoformat(), 'reference_word_ids': m.reference_word_ids, 'reference_page': m.reference_page, 'reference_quote': m.reference_quote, 'page_range': m.page_range, 'references': m.references} for m in messages
    ])

@app.route('/api/documents', methods=['GET'])
def list_documents():
    """List all uploaded documents with their metadata."""
    try:
        session = get_db_session()
        documents = session.query(Document).order_by(Document.created_at.desc()).all()
        
        for doc in documents:
            # Check if file exists
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], doc.filename)
            file_exists = os.path.exists(file_path)
            
            doc.file_exists = file_exists
            doc.file_size = os.path.getsize(file_path) if file_exists else 0
        
        session.close()
        return jsonify([doc.to_dict() for doc in documents])
        
    except Exception as e:
        logger.error(f"Error listing documents: {e}")
        return jsonify({'error': 'Failed to list documents'}), 500

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def get_document(document_id):
    """Get detailed information about a specific document."""
    try:
        session = get_db_session()
        document = session.query(Document).get(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Get additional stats
        page_count = session.query(Page).filter_by(document_id=document_id).count()
        
        activated_blocks = session.query(Highlight).filter_by(document_id=document_id).count()
        
        # Count words by joining with pages
        sentence_count = session.query(Word).join(Page).filter(Page.document_id == document_id).count()
        
        # Check if file exists
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], document.filename)
        file_exists = os.path.exists(file_path)
        
        document_info = {
            'document_id': document.id,
            'filename': document.filename,
            'original_filename': document.original_filename,
            'created_at': document.created_at.isoformat() if document.created_at else None,
            'num_pages': document.num_pages,
            'page_count': page_count,
            'activated_blocks': activated_blocks,
            'sentence_count': sentence_count,
            'file_exists': file_exists,
            'file_size': os.path.getsize(file_path) if file_exists else 0
        }
        
        session.close()
        return jsonify(document_info)
        
    except Exception as e:
        logger.error(f"Error getting document: {e}")
        return jsonify({'error': 'Failed to get document'}), 500

@app.route('/api/documents/<int:document_id>', methods=['DELETE'])
def delete_document(document_id):
    """Delete a document and all its associated data."""
    try:
        session = get_db_session()
        document = session.query(Document).get(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        filename = document.filename
        
        # Delete from database (cascade will handle related records)
        session.delete(document)
        
        # Delete file from filesystem
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        session.commit()
        session.close()
        
        return jsonify({'message': 'Document deleted successfully'})
        
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        return jsonify({'error': 'Failed to delete document'}), 500

@app.route('/api/documents/<int:document_id>/rename', methods=['PUT'])
def rename_document(document_id):
    """Rename a document's display name."""
    try:
        data = request.get_json()
        new_name = data.get('new_name')
        
        if not new_name or not new_name.strip():
            return jsonify({'error': 'New name is required'}), 400
        
        session = get_db_session()
        document = session.query(Document).get(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Update the original_filename (display name)
        document.original_filename = new_name.strip()
        session.commit()
        session.close()
        
        return jsonify({'message': 'Document renamed successfully'})
        
    except Exception as e:
        logger.error(f"Error renaming document: {e}")
        return jsonify({'error': 'Failed to rename document'}), 500

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=True, port=5001) 