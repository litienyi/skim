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
    init_db, get_db_session, User, Document, Page, Word, Highlight, ChatSession, ChatMessage
)
from datetime import datetime, timedelta
from PIL import Image
from flask_openapi3 import OpenAPI, Info, Tag, APIBlueprint
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from functools import wraps
from flask_cors import CORS
import re

# Load environment variables
load_dotenv()

# Configure logging first
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# JWT Configuration
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
if not JWT_SECRET_KEY:
    raise ValueError("JWT_SECRET_KEY environment variable is required")
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

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

# Authentication decorators
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(" ")[1]  # Bearer <token>
            except IndexError:
                return jsonify({'error': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
        
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            session = get_db_session()
            current_user = session.query(User).filter_by(id=payload['user_id']).first()
            session.close()
            
            if not current_user:
                return jsonify({'error': 'User not found'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(current_user, *args, **kwargs)
    return decorated

def document_owner_required(f):
    @wraps(f)
    def decorated(current_user, document_id, *args, **kwargs):
        session = get_db_session()
        document = session.query(Document).filter_by(
            id=document_id, 
            user_id=current_user.id
        ).first()
        session.close()
        
        if not document:
            return jsonify({'error': 'Document not found or access denied'}), 404
        
        return f(current_user, document, *args, **kwargs)
    return decorated

# JWT token generation
def generate_token(user_id):
    """Generate a JWT token for a user."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

def get_current_user_from_token():
    """Get current user from JWT token without using decorator."""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        # Extract token from "Bearer <token>"
        token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload['user_id']
        
        # Get user from database
        session = get_db_session()
        user = session.query(User).filter_by(id=user_id).first()
        session.close()
        
        return user
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception as e:
        logger.error(f"Token validation error: {str(e)}")
        return None

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
    # This function is no longer needed since we're not using OCR
    # PyMuPDF handles text extraction more efficiently
    return []

SECRET_KEY = os.getenv('SECRET_KEY')
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is required")

# Authentication endpoints
@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        
        if not username or not email or not password:
            return jsonify({'error': 'Username, email, and password are required'}), 400
        
        session = get_db_session()
        
        # Check if user already exists
        existing_user = session.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()
        
        if existing_user:
            session.close()
            return jsonify({'error': 'Username or email already exists'}), 409
        
        # Create new user
        password_hash = generate_password_hash(password)
        new_user = User(
            username=username,
            email=email,
            password_hash=password_hash
        )
        
        session.add(new_user)
        session.commit()
        
        # Generate token
        token = generate_token(new_user.id)
        
        session.close()
        
        return jsonify({
            'message': 'User registered successfully',
            'token': token,
            'user': {
                'id': new_user.id,
                'username': new_user.username,
                'email': new_user.email
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error registering user: {e}")
        return jsonify({'error': 'Failed to register user'}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login user and return JWT token."""
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({'error': 'Username and password are required'}), 400
        
        session = get_db_session()
        user = session.query(User).filter_by(username=username).first()
        session.close()
        
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({'error': 'Invalid username or password'}), 401
        
        # Generate token
        token = generate_token(user.id)
        
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            }
        })
        
    except Exception as e:
        logger.error(f"Error logging in: {e}")
        return jsonify({'error': 'Failed to login'}), 500

@app.route('/api/auth/me', methods=['GET'])
@token_required
def get_current_user(current_user):
    """Get current user information."""
    return jsonify({
        'id': current_user.id,
        'username': current_user.username,
        'email': current_user.email
    })

# Update upload endpoint to require authentication
@app.route('/api/upload', methods=['POST'])
@token_required
def upload_file(current_user):
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

            # Create Document ORM entry with user_id
            document = Document(
                filename=unique_filename,
                original_filename=file.filename,
                user_id=current_user.id,  # Associate with current user
                created_at=datetime.now(),
                num_pages=num_pages,
                meta={}
            )
            session.add(document)
            session.commit()

            for i in range(num_pages):
                page = doc.load_page(i)
                text = page.get_text()
                extracted_text.append(text)

                # Save page ORM entry
                page_orm = Page(
                    document_id=document.id,
                    page_number=i+1,
                    text_content=text,
                    created_at=datetime.now()
                )
                session.add(page_orm)
                session.commit()

                # Extract and save word bounding boxes using PyMuPDF
                words = page.get_text("words")
                for idx, word in enumerate(words):
                    word_orm = Word(
                        page_id=page_orm.id,
                        word_index=idx,
                        text=word[4],  # text content
                        x=word[0],      # x coordinate
                        y=word[1],      # y coordinate
                        width=word[2],   # width
                        height=word[3],  # height
                        confidence=1.0,  # PyMuPDF doesn't provide confidence, assume 1.0
                        created_at=datetime.now()
                    )
                    session.add(word_orm)
                session.commit()
            doc.close()
            # Save extracted text to a .json file for later retrieval
            text_path = input_path + '.json'
            with open(text_path, 'w') as f:
                json.dump({"pages": extracted_text}, f)
            
            # Get document info before closing session
            document_id = document.id
            filename = document.filename
            original_filename = document.original_filename
            
            session.close()
            
            return jsonify({
                'message': 'File uploaded successfully',
                'document_id': document_id,
                'filename': filename,
                'original_filename': original_filename,
                'num_pages': num_pages
            })
        else:
            session.close()
            return jsonify({'error': 'Invalid file type. Only PDF files are allowed.'}), 400
    except Exception as e:
        session.close()
        logger.error(f"Error uploading file: {e}")
        return jsonify({'error': 'Failed to upload file'}), 500

# Update PDF serving to require authentication and ownership
@app.route('/api/pdf/<filename>', methods=['GET', 'OPTIONS'])
def get_pdf(filename):
    if request.method == 'OPTIONS':
        # Handle preflight request without authentication
        response = jsonify({})
        response.headers['Access-Control-Allow-Origin'] = 'http://localhost:5173'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS, HEAD'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range, If-Range, Authorization'
        return response
    
    # For actual requests, require authentication
    try:
        current_user = get_current_user_from_token()
        if not current_user:
            return jsonify({'error': 'Authentication required'}), 401
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        return jsonify({'error': 'Authentication failed'}), 401
    
    logger.debug("=== GET PDF REQUEST ===")
    logger.debug(f"Requested filename: {filename}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    logger.debug(f"User ID: {current_user.id}")
    
    try:
        # Verify user owns this document
        session = get_db_session()
        document = session.query(Document).filter_by(
            filename=filename,
            user_id=current_user.id
        ).first()
        session.close()
        
        if not document:
            logger.error(f"Document not found or access denied for user {current_user.id}, filename: {filename}")
            return jsonify({'error': 'Document not found or access denied'}), 404
        
        filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
        logger.debug(f"Serving file from: {filepath}")
        
        # Check if file exists
        if not os.path.exists(filepath):
            logger.error(f"File not found: {filepath}")
            # Check if there are similar files in the uploads directory
            upload_dir = os.listdir(UPLOAD_FOLDER)
            similar_files = [f for f in upload_dir if f.endswith('.pdf') and filename.split('_', 1)[1] in f]
            if similar_files:
                logger.warning(f"Found similar files: {similar_files}")
                logger.warning(f"Database record points to non-existent file: {filename}")
                logger.warning(f"Consider updating database record to point to existing file")
            return jsonify({'error': 'File not found'}), 404
        
        # Handle HEAD requests (for testing accessibility)
        if request.method == 'HEAD':
            response = jsonify({})
            response.headers['Content-Type'] = 'application/pdf'
            response.headers['Content-Length'] = str(os.path.getsize(filepath))
            response.headers['Access-Control-Allow-Origin'] = 'http://localhost:5173'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS, HEAD'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range, If-Range, Authorization'
            return response
        
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
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS, HEAD'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range, If-Range, Authorization'
        response.headers['Accept-Ranges'] = 'bytes'
        
        logger.debug(f"Successfully serving PDF: {filename}")
        return response
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Utility endpoint to fix database records pointing to missing files
@app.route('/api/admin/fix-missing-files', methods=['POST'])
def fix_missing_files():
    """Utility endpoint to fix database records that point to missing files."""
    try:
        session = get_db_session()
        documents = session.query(Document).all()
        fixed_count = 0
        
        for doc in documents:
            filepath = os.path.join(UPLOAD_FOLDER, secure_filename(doc.filename))
            if not os.path.exists(filepath):
                # Look for similar files
                upload_dir = os.listdir(UPLOAD_FOLDER)
                similar_files = [f for f in upload_dir if f.endswith('.pdf') and doc.filename.split('_', 1)[1] in f]
                
                if similar_files:
                    # Use the first similar file found
                    new_filename = similar_files[0]
                    logger.info(f"Fixing document {doc.document_id}: {doc.filename} -> {new_filename}")
                    doc.filename = new_filename
                    fixed_count += 1
                else:
                    logger.warning(f"No similar file found for document {doc.document_id}: {doc.filename}")
        
        session.commit()
        session.close()
        
        return jsonify({
            'message': f'Fixed {fixed_count} database records',
            'fixed_count': fixed_count
        })
    except Exception as e:
        logger.error(f"Error fixing missing files: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Update chat endpoint to require authentication
@chat_api.post('/chat', tags=[chat_tag], responses={200: ChatResponseSchema})
@token_required
def chat(current_user):
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
        
        # Get document from database and verify ownership
        session = get_db_session()
        document = session.query(Document).filter_by(
            id=document_id,
            user_id=current_user.id
        ).first()
        if not document:
            session.close()
            return jsonify({'error': 'Document not found or access denied'}), 404
        
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
@app.route('/api/highlights/<int:document_id>', methods=['POST'])
@token_required
@document_owner_required
def create_highlight(current_user, document):
    session = get_db_session()
    data = request.get_json()
    page_id = data.get('page_id')
    word_ids = data.get('word_ids')
    color = data.get('color', '#ffe066')
    highlight = Highlight(
        document_id=document.id,
        page_id=page_id,
        word_ids=word_ids,
        color=color,
        created_at=datetime.now()
    )
    session.add(highlight)
    session.commit()
    session.close()
    return jsonify({'message': 'Highlight created'})

@app.route('/api/highlights/<int:document_id>', methods=['GET'])
@token_required
@document_owner_required
def get_highlights(current_user, document):
    session = get_db_session()
    page_id = request.args.get('page_id')
    q = session.query(Highlight).filter_by(document_id=document.id)
    if page_id:
        q = q.filter_by(page_id=page_id)
    highlights = q.all()
    session.close()
    return jsonify({'highlights': [
        {'id': h.id, 'document_id': h.document_id, 'page_id': h.page_id, 'word_ids': h.word_ids, 'color': h.color, 'created_at': h.created_at.isoformat()} for h in highlights
    ]})

# Update chat sessions endpoints to require authentication
@app.route('/api/chat_sessions', methods=['POST'])
@token_required
def create_chat_session(current_user):
    """Create a new chat session."""
    try:
        data = request.get_json()
        document_id = data.get('document_id')
        
        if not document_id:
            return jsonify({'error': 'Document ID is required'}), 400
        
        session = get_db_session()
        
        # Verify user owns the document
        document = session.query(Document).filter_by(
            id=document_id,
            user_id=current_user.id
        ).first()
        
        if not document:
            session.close()
            return jsonify({'error': 'Document not found or access denied'}), 404
        
        chat_session = ChatSession(
            user_id=current_user.id,
            document_id=document_id
        )
        
        session.add(chat_session)
        session.commit()
        session.close()
        
        return jsonify({
            'message': 'Chat session created successfully',
            'chat_session_id': chat_session.id
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating chat session: {e}")
        return jsonify({'error': 'Failed to create chat session'}), 500

@app.route('/api/chat_sessions', methods=['GET'])
@token_required
def get_chat_sessions(current_user):
    """Get all chat sessions for the current user."""
    try:
        session = get_db_session()
        chat_sessions = session.query(ChatSession).filter_by(user_id=current_user.id).all()
        
        sessions_data = []
        for cs in chat_sessions:
            sessions_data.append({
                'id': cs.id,
                'document_id': cs.document_id,
                'created_at': cs.created_at.isoformat() if cs.created_at else None
            })
        
        session.close()
        return jsonify(sessions_data)
        
    except Exception as e:
        logger.error(f"Error getting chat sessions: {e}")
        return jsonify({'error': 'Failed to get chat sessions'}), 500

# Update chat messages endpoints to require authentication
@app.route('/api/chat_messages', methods=['POST'])
@token_required
def create_chat_message(current_user):
    """Create a new chat message."""
    try:
        data = request.get_json()
        chat_session_id = data.get('chat_session_id')
        message = data.get('message')
        sender = data.get('sender', 'user')
        reference_word_ids = data.get('reference_word_ids', [])
        reference_page = data.get('reference_page')
        reference_quote = data.get('reference_quote')
        page_range = data.get('page_range', [])
        references = data.get('references', [])
        
        if not chat_session_id or not message:
            return jsonify({'error': 'Chat session ID and message are required'}), 400
        
        session = get_db_session()
        
        # Verify user owns the chat session
        chat_session = session.query(ChatSession).filter_by(
            id=chat_session_id,
            user_id=current_user.id
        ).first()
        
        if not chat_session:
            session.close()
            return jsonify({'error': 'Chat session not found or access denied'}), 404
        
        chat_message = ChatMessage(
            chat_session_id=chat_session_id,
            sender=sender,
            message=message,
            reference_word_ids=reference_word_ids,
            reference_page=reference_page,
            reference_quote=reference_quote,
            page_range=page_range,
            references=references
        )
        
        session.add(chat_message)
        session.commit()
        
        # Get the ID before closing the session
        chat_message_id = chat_message.id
        session.close()
        
        return jsonify({
            'message': 'Chat message created successfully',
            'chat_message_id': chat_message_id
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating chat message: {e}")
        return jsonify({'error': 'Failed to create chat message'}), 500

@app.route('/api/chat_messages', methods=['GET'])
@token_required
def get_chat_messages(current_user):
    """Get chat messages for a specific chat session."""
    try:
        chat_session_id = request.args.get('chat_session_id')
        
        if not chat_session_id:
            return jsonify({'error': 'Chat session ID is required'}), 400
        
        session = get_db_session()
        
        # Verify user owns the chat session
        chat_session = session.query(ChatSession).filter_by(
            id=chat_session_id,
            user_id=current_user.id
        ).first()
        
        if not chat_session:
            session.close()
            return jsonify({'error': 'Chat session not found or access denied'}), 404
        
        messages = session.query(ChatMessage).filter_by(chat_session_id=chat_session_id).all()
        
        messages_data = []
        for msg in messages:
            messages_data.append({
                'id': msg.id,
                'sender': msg.sender,
                'message': msg.message,
                'created_at': msg.created_at.isoformat() if msg.created_at else None,
                'reference_word_ids': msg.reference_word_ids,
                'reference_page': msg.reference_page,
                'reference_quote': msg.reference_quote,
                'page_range': msg.page_range,
                'references': msg.references
            })
        
        session.close()
        return jsonify(messages_data)
        
    except Exception as e:
        logger.error(f"Error getting chat messages: {e}")
        return jsonify({'error': 'Failed to get chat messages'}), 500

@app.route('/api/chat/clear', methods=['POST'])
@token_required
def clear_chat(current_user):
    """Clear all chat messages for the current user"""
    try:
        session = get_db_session()
        
        # Find all chat sessions for this user
        chat_sessions = session.query(ChatSession).filter_by(user_id=current_user.id).all()
        
        # Delete all chat messages for these chat sessions
        for chat_session in chat_sessions:
            session.query(ChatMessage).filter_by(chat_session_id=chat_session.id).delete()
        
        # Keep the chat sessions but clear their messages
        session.commit()
        
        logger.info(f"Cleared all chat messages for user {current_user.id} (kept {len(chat_sessions)} chat sessions)")
        return jsonify({'message': 'Chat cleared successfully'}), 200
        
    except Exception as e:
        logger.error(f"Error clearing chat: {str(e)}")
        session.rollback()
        return jsonify({'error': 'Failed to clear chat'}), 500

# Update documents endpoints to require authentication
@app.route('/api/documents', methods=['GET'])
@token_required
def list_documents(current_user):
    """List all documents for the current user."""
    try:
        session = get_db_session()
        documents = session.query(Document).filter_by(user_id=current_user.id).all()
        
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
@token_required
@document_owner_required
def get_document(current_user, document):
    """Get detailed information about a specific document."""
    try:
        session = get_db_session()
        
        # Get additional stats
        page_count = session.query(Page).filter_by(document_id=document.id).count()
        activated_blocks = session.query(Highlight).filter_by(document_id=document.id).count()
        sentence_count = session.query(Word).join(Page).filter(Page.document_id == document.id).count()
        
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
@token_required
@document_owner_required
def delete_document(current_user, document):
    """Delete a document and all its associated data."""
    try:
        session = get_db_session()
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
@token_required
@document_owner_required
def rename_document(current_user, document):
    """Rename a document's display name."""
    try:
        data = request.get_json()
        new_name = data.get('new_name')
        
        if not new_name or not new_name.strip():
            return jsonify({'error': 'New name is required'}), 400
        
        session = get_db_session()
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