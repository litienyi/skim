"""
Security-Enhanced Flask Application for SKIM2
Integrates all security features, error handling, and production configurations.
"""

import os
import logging
import time
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, send_file, current_app
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF
import json
import google.generativeai as genai
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import List, Optional
import jwt
from werkzeug.security import generate_password_hash, check_password_hash

# Import our security and error handling modules
from security_config import (
    validate_password, validate_email, validate_username, validate_file_upload,
    sanitize_filename, sanitize_input, rate_limit, generate_secure_token,
    verify_token, hash_password, verify_password, add_security_headers,
    log_security_event, log_failed_login, log_successful_login,
    generate_secure_filename, is_safe_path
)
from error_handlers import (
    setup_logging, register_error_handlers, create_health_check_endpoints,
    add_request_context, handle_exceptions, validate_required_fields,
    log_api_request, log_performance_metrics, setup_graceful_shutdown
)
from database import (
    init_db, get_db_session, User, Document, Page, Word, Highlight, ChatSession, ChatMessage
)

# Load environment variables
load_dotenv()

# =============================================================================
# APPLICATION SETUP
# =============================================================================

def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__)
    
    # Configure logging
    setup_logging()
    logger = logging.getLogger(__name__)
    
    # Basic Flask configuration
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_FILE_SIZE', 52428800))  # 50MB
    
    # Security configuration
    app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'True').lower() == 'true'
    app.config['SESSION_COOKIE_HTTPONLY'] = os.getenv('SESSION_COOKIE_HTTPONLY', 'True').lower() == 'true'
    app.config['SESSION_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
    
    # CORS configuration
    cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173').split(',')
    CORS(app, origins=cors_origins, supports_credentials=True)
    
    # Security headers with Talisman
    Talisman(
        app,
        content_security_policy={
            'default-src': "'self'",
            'script-src': "'self' 'unsafe-inline'",
            'style-src': "'self' 'unsafe-inline'",
            'img-src': "'self' data: https:",
            'font-src': "'self' data:",
            'connect-src': "'self' https:",
            'frame-ancestors': "'none'"
        },
        force_https=False if os.getenv('FLASK_ENV') == 'development' else True
    )
    
    # Rate limiting
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"]
    )
    
    # Register error handlers
    register_error_handlers(app)
    
    # Create health check endpoints
    create_health_check_endpoints(app)
    
    # Setup graceful shutdown
    setup_graceful_shutdown(app)
    
    # Request context middleware
    @app.before_request
    def before_request():
        add_request_context()
        request.start_time = time.time()
    
    @app.after_request
    def after_request(response):
        return log_api_request(response)
    
    return app

# Create the application instance
app = create_app()

# =============================================================================
# JWT CONFIGURATION
# =============================================================================

JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
if not JWT_SECRET_KEY:
    raise ValueError("JWT_SECRET_KEY environment variable is required")

JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

# =============================================================================
# GEMINI AI CONFIGURATION
# =============================================================================

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    logging.error("GOOGLE_API_KEY not found in environment variables.")
    logging.error("Chat functionality will not work without a valid API key.")
else:
    logging.info("Gemini API key found and configured.")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('models/gemini-2.5-flash')

# =============================================================================
# AUTHENTICATION DECORATORS
# =============================================================================

def token_required(f):
    """Enhanced token authentication decorator with security logging."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(" ")[1]  # Bearer <token>
            except IndexError:
                log_security_event('invalid_token_format', details={'ip': request.remote_addr})
                return jsonify({'error': 'Invalid token format'}), 401
        
        if not token:
            log_security_event('missing_token', details={'ip': request.remote_addr})
            return jsonify({'error': 'Token is missing'}), 401
        
        try:
            payload = verify_token(token)
            if not payload:
                log_security_event('invalid_token', details={'ip': request.remote_addr})
                return jsonify({'error': 'Invalid or expired token'}), 401
            
            session = get_db_session()
            current_user = session.query(User).filter_by(id=payload['user_id']).first()
            session.close()
            
            if not current_user:
                log_security_event('user_not_found', details={'user_id': payload['user_id']})
                return jsonify({'error': 'User not found'}), 401
            
            # Add user to request context
            request.current_user = current_user
                
        except Exception as e:
            logging.error(f"Token verification error: {e}")
            return jsonify({'error': 'Token verification failed'}), 401
        
        return f(current_user, *args, **kwargs)
    return decorated

def document_owner_required(f):
    """Enhanced document ownership verification."""
    @wraps(f)
    def decorated(current_user, document_id, *args, **kwargs):
        session = get_db_session()
        document = session.query(Document).filter_by(
            id=document_id, 
            user_id=current_user.id
        ).first()
        session.close()
        
        if not document:
            log_security_event('document_access_denied', 
                             user_id=current_user.id, 
                             details={'document_id': document_id})
            return jsonify({'error': 'Document not found or access denied'}), 404
        
        return f(current_user, document, *args, **kwargs)
    return decorated

# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class Reference(BaseModel):
    page: int = Field(..., description="Page number")
    quote: str = Field(..., description="Quoted phrase from the PDF")

class ChatResponseSchema(BaseModel):
    answer: str = Field(..., description="Markdown answer to the user's question about the PDF")
    references: List[Reference] = Field(..., description="List of references to the PDF")

class UserRegistrationSchema(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., description="Valid email address")
    password: str = Field(..., min_length=8, max_length=128)

class UserLoginSchema(BaseModel):
    username: str = Field(..., description="Username or email")
    password: str = Field(..., description="User password")

# =============================================================================
# AUTHENTICATION ENDPOINTS
# =============================================================================

@app.route('/api/auth/register', methods=['POST'])
@limiter.limit("5 per minute")
@handle_exceptions
@validate_required_fields(['username', 'email', 'password'])
def register():
    """Enhanced user registration with comprehensive validation."""
    data = request.get_json()
    
    # Validate input
    username_validation = validate_username(data['username'])
    if not username_validation['valid']:
        return jsonify({'error': 'Invalid username', 'details': username_validation['errors']}), 400
    
    if not validate_email(data['email']):
        return jsonify({'error': 'Invalid email address'}), 400
    
    password_validation = validate_password(data['password'])
    if not password_validation['valid']:
        return jsonify({'error': 'Invalid password', 'details': password_validation['errors']}), 400
    
    # Sanitize inputs
    username = sanitize_input(data['username'])
    email = sanitize_input(data['email'].lower())
    
    session = get_db_session()
    
    try:
        # Check if user already exists
        existing_user = session.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()
        
        if existing_user:
            return jsonify({'error': 'Username or email already exists'}), 409
        
        # Create new user
        password_hash = hash_password(data['password'])
        new_user = User(
            username=username,
            email=email,
            password_hash=password_hash
        )
        
        session.add(new_user)
        session.commit()
        session.refresh(new_user)
        
        # Generate token
        token = generate_secure_token(new_user.id)
        
        log_successful_login(new_user.id, username)
        
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
        session.rollback()
        logging.error(f"Registration error: {e}")
        return jsonify({'error': 'Registration failed'}), 500
    finally:
        session.close()

@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("5 per minute")
@handle_exceptions
@validate_required_fields(['username', 'password'])
def login():
    """Enhanced user login with security logging."""
    data = request.get_json()
    
    # Sanitize inputs
    username = sanitize_input(data['username'])
    password = data['password']
    
    session = get_db_session()
    
    try:
        # Find user by username or email
        user = session.query(User).filter(
            (User.username == username) | (User.email == username)
        ).first()
        
        if not user or not verify_password(password, user.password_hash):
            log_failed_login(username, request.remote_addr)
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate token
        token = generate_secure_token(user.id)
        
        log_successful_login(user.id, user.username)
        
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email
            }
        }), 200
        
    except Exception as e:
        logging.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500
    finally:
        session.close()

@app.route('/api/auth/me', methods=['GET'])
@token_required
@handle_exceptions
def get_current_user(current_user):
    """Get current user information."""
    return jsonify({
        'id': current_user.id,
        'username': current_user.username,
        'email': current_user.email,
        'created_at': current_user.created_at.isoformat() if current_user.created_at else None
    }), 200

# =============================================================================
# FILE UPLOAD ENDPOINTS
# =============================================================================

@app.route('/api/upload', methods=['POST'])
@token_required
@limiter.limit("10 per hour")
@handle_exceptions
def upload_file(current_user):
    """Enhanced file upload with comprehensive validation."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Validate file upload
    validation = validate_file_upload(file)
    if not validation['valid']:
        return jsonify({'error': 'File validation failed', 'details': validation['errors']}), 400
    
    # Generate secure filename
    original_filename = sanitize_filename(file.filename)
    secure_filename = generate_secure_filename(original_filename)
    
    # Ensure upload directory exists
    upload_folder = os.getenv('UPLOAD_FOLDER', 'backend/uploads')
    os.makedirs(upload_folder, exist_ok=True)
    
    file_path = os.path.join(upload_folder, secure_filename)
    
    # Save file
    try:
        file.save(file_path)
    except Exception as e:
        logging.error(f"File save error: {e}")
        return jsonify({'error': 'Failed to save file'}), 500
    
    # Process PDF and extract text
    try:
        doc = fitz.open(file_path)
        num_pages = len(doc)
        
        session = get_db_session()
        
        # Create document record
        document = Document(
            user_id=current_user.id,
            filename=secure_filename,
            original_filename=original_filename,
            num_pages=num_pages
        )
        
        session.add(document)
        session.flush()  # Get the document ID
        
        # Extract text from each page
        for page_num in range(num_pages):
            page = doc.load_page(page_num)
            text_content = page.get_text()
            
            page_record = Page(
                document_id=document.id,
                page_number=page_num + 1,
                text_content=text_content
            )
            
            session.add(page_record)
        
        session.commit()
        
        logging.info(f"File uploaded successfully: {secure_filename} by user {current_user.id}")
        
        return jsonify({
            'message': 'File uploaded successfully',
            'document_id': document.id,
            'filename': secure_filename,
            'original_filename': original_filename,
            'num_pages': num_pages
        }), 201
        
    except Exception as e:
        session.rollback()
        logging.error(f"PDF processing error: {e}")
        return jsonify({'error': 'Failed to process PDF'}), 500
    finally:
        session.close()
        doc.close()

# =============================================================================
# CHAT ENDPOINTS
# =============================================================================

@app.route('/api/chat', methods=['POST'])
@token_required
@limiter.limit("100 per hour")
@handle_exceptions
@validate_required_fields(['question', 'document_id'])
def chat(current_user):
    """Enhanced chat endpoint with security and validation."""
    data = request.get_json()
    
    # Sanitize inputs
    question = sanitize_input(data['question'], max_length=2000)
    document_id = data['document_id']
    
    # Validate document ownership
    session = get_db_session()
    document = session.query(Document).filter_by(
        id=document_id, 
        user_id=current_user.id
    ).first()
    
    if not document:
        session.close()
        return jsonify({'error': 'Document not found or access denied'}), 404
    
    # Get document pages
    pages = session.query(Page).filter_by(document_id=document_id).order_by(Page.page_number).all()
    session.close()
    
    if not pages:
        return jsonify({'error': 'No content found in document'}), 400
    
    # Prepare context for AI
    context = "\n\n".join([f"Page {page.page_number}: {page.text_content}" for page in pages])
    
    try:
        # Generate response using Gemini
        prompt = f"""
        Based on the following document content, answer the user's question.
        Provide specific page references and quotes when possible.
        
        Document: {context}
        
        Question: {question}
        
        Please provide a comprehensive answer with page references.
        """
        
        response = model.generate_content(prompt)
        answer = response.text
        
        # Extract references (simplified - in production, use more sophisticated parsing)
        references = []
        for page in pages:
            if page.text_content.lower() in answer.lower():
                references.append({
                    'page': page.page_number,
                    'quote': page.text_content[:200] + "..." if len(page.text_content) > 200 else page.text_content
                })
        
        return jsonify({
            'answer': answer,
            'references': references
        }), 200
        
    except Exception as e:
        logging.error(f"Chat error: {e}")
        return jsonify({'error': 'Failed to generate response'}), 500

# =============================================================================
# DOCUMENT MANAGEMENT ENDPOINTS
# =============================================================================

@app.route('/api/documents', methods=['GET'])
@token_required
@handle_exceptions
def list_documents(current_user):
    """Get user's documents."""
    session = get_db_session()
    
    try:
        documents = session.query(Document).filter_by(user_id=current_user.id).all()
        
        return jsonify({
            'documents': [doc.to_dict() for doc in documents]
        }), 200
        
    except Exception as e:
        logging.error(f"Error listing documents: {e}")
        return jsonify({'error': 'Failed to retrieve documents'}), 500
    finally:
        session.close()

@app.route('/api/documents/<int:document_id>', methods=['DELETE'])
@token_required
@document_owner_required
@handle_exceptions
def delete_document(current_user, document):
    """Delete a document."""
    session = get_db_session()
    
    try:
        # Delete file from filesystem
        file_path = os.path.join(os.getenv('UPLOAD_FOLDER', 'backend/uploads'), document.filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Delete from database (cascade will handle related records)
        session.delete(document)
        session.commit()
        
        logging.info(f"Document deleted: {document.filename} by user {current_user.id}")
        
        return jsonify({'message': 'Document deleted successfully'}), 200
        
    except Exception as e:
        session.rollback()
        logging.error(f"Error deleting document: {e}")
        return jsonify({'error': 'Failed to delete document'}), 500
    finally:
        session.close()

# =============================================================================
# APPLICATION INITIALIZATION
# =============================================================================

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    debug_mode = os.getenv('FLASK_ENV') == 'development'
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=debug_mode
    ) 