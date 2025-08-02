"""
Security Configuration and Utilities
Handles input validation, rate limiting, security headers, and other security measures.
"""

import os
import re
import hashlib
import secrets
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from functools import wraps
from flask import request, jsonify, current_app
import jwt
from werkzeug.security import generate_password_hash, check_password_hash
import logging

logger = logging.getLogger(__name__)

# =============================================================================
# SECURITY CONSTANTS
# =============================================================================

# Password requirements
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_REQUIREMENTS = {
    'uppercase': True,
    'lowercase': True,
    'numbers': True,
    'special_chars': True
}

# File upload security
ALLOWED_EXTENSIONS = {'pdf'}
MAX_FILE_SIZE = int(os.getenv('MAX_FILE_SIZE', 52428800))  # 50MB default
MAX_FILENAME_LENGTH = 255

# Rate limiting
RATE_LIMIT_REQUESTS = int(os.getenv('RATE_LIMIT_REQUESTS', 100))
RATE_LIMIT_WINDOW = int(os.getenv('RATE_LIMIT_WINDOW', 3600))  # 1 hour

# Session security
SESSION_TIMEOUT = timedelta(hours=24)
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = timedelta(minutes=15)

# =============================================================================
# INPUT VALIDATION
# =============================================================================

def validate_password(password: str) -> Dict[str, Any]:
    """
    Validate password strength according to security requirements.
    
    Returns:
        Dict with 'valid' boolean and 'errors' list
    """
    errors = []
    
    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long")
    
    if len(password) > PASSWORD_MAX_LENGTH:
        errors.append(f"Password must be no more than {PASSWORD_MAX_LENGTH} characters long")
    
    if PASSWORD_REQUIREMENTS['uppercase'] and not re.search(r'[A-Z]', password):
        errors.append("Password must contain at least one uppercase letter")
    
    if PASSWORD_REQUIREMENTS['lowercase'] and not re.search(r'[a-z]', password):
        errors.append("Password must contain at least one lowercase letter")
    
    if PASSWORD_REQUIREMENTS['numbers'] and not re.search(r'\d', password):
        errors.append("Password must contain at least one number")
    
    if PASSWORD_REQUIREMENTS['special_chars'] and not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        errors.append("Password must contain at least one special character")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

def validate_email(email: str) -> bool:
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def validate_username(username: str) -> Dict[str, Any]:
    """Validate username format and length."""
    errors = []
    
    if len(username) < 3:
        errors.append("Username must be at least 3 characters long")
    
    if len(username) > 50:
        errors.append("Username must be no more than 50 characters long")
    
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        errors.append("Username can only contain letters, numbers, underscores, and hyphens")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks."""
    # Remove path separators and dangerous characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # Limit length
    if len(filename) > MAX_FILENAME_LENGTH:
        name, ext = os.path.splitext(filename)
        filename = name[:MAX_FILENAME_LENGTH-len(ext)] + ext
    return filename

def validate_file_upload(file) -> Dict[str, Any]:
    """Validate uploaded file for security and size."""
    errors = []
    
    if not file:
        errors.append("No file provided")
        return {'valid': False, 'errors': errors}
    
    # Check file extension
    if '.' not in file.filename:
        errors.append("File must have an extension")
    else:
        ext = file.filename.rsplit('.', 1)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"File type '{ext}' is not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}")
    
    # Check file size
    file.seek(0, 2)  # Seek to end
    file_size = file.tell()
    file.seek(0)  # Reset to beginning
    
    if file_size > MAX_FILE_SIZE:
        errors.append(f"File size ({file_size} bytes) exceeds maximum allowed size ({MAX_FILE_SIZE} bytes)")
    
    # Check filename length
    if len(file.filename) > MAX_FILENAME_LENGTH:
        errors.append(f"Filename too long (max {MAX_FILENAME_LENGTH} characters)")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

# =============================================================================
# RATE LIMITING
# =============================================================================

class RateLimiter:
    """Simple in-memory rate limiter (use Redis in production)."""
    
    def __init__(self):
        self.requests = {}
    
    def is_allowed(self, identifier: str) -> bool:
        """Check if request is allowed based on rate limits."""
        now = datetime.utcnow()
        
        # Clean old entries
        self.requests = {
            k: v for k, v in self.requests.items() 
            if now - v['timestamp'] < timedelta(seconds=RATE_LIMIT_WINDOW)
        }
        
        if identifier not in self.requests:
            self.requests[identifier] = {
                'count': 1,
                'timestamp': now
            }
            return True
        
        if self.requests[identifier]['count'] >= RATE_LIMIT_REQUESTS:
            return False
        
        self.requests[identifier]['count'] += 1
        return True

# Global rate limiter instance
rate_limiter = RateLimiter()

def rate_limit(f):
    """Decorator to apply rate limiting to endpoints."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Use IP address as identifier
        identifier = request.remote_addr
        
        if not rate_limiter.is_allowed(identifier):
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': f'Too many requests. Limit: {RATE_LIMIT_REQUESTS} per {RATE_LIMIT_WINDOW} seconds'
            }), 429
        
        return f(*args, **kwargs)
    return decorated_function

# =============================================================================
# AUTHENTICATION & AUTHORIZATION
# =============================================================================

def generate_secure_token(user_id: int, expires_in: int = 86400) -> str:
    """Generate a secure JWT token."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(seconds=expires_in),
        'iat': datetime.utcnow(),
        'jti': secrets.token_urlsafe(32)  # JWT ID for token uniqueness
    }
    
    secret_key = os.getenv('JWT_SECRET_KEY')
    if not secret_key:
        raise ValueError("JWT_SECRET_KEY environment variable is required")
    
    return jwt.encode(payload, secret_key, algorithm='HS256')

def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode JWT token."""
    try:
        secret_key = os.getenv('JWT_SECRET_KEY')
        if not secret_key:
            raise ValueError("JWT_SECRET_KEY environment variable is required")
        
        payload = jwt.decode(token, secret_key, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("Token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token: {e}")
        return None

def hash_password(password: str) -> str:
    """Generate secure password hash."""
    return generate_password_hash(password, method='pbkdf2:sha256')

def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash."""
    return check_password_hash(password_hash, password)

# =============================================================================
# SECURITY HEADERS
# =============================================================================

def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    return response

# =============================================================================
# INPUT SANITIZATION
# =============================================================================

def sanitize_input(text: str, max_length: int = 1000) -> str:
    """Sanitize user input to prevent XSS and injection attacks."""
    if not text:
        return ""
    
    # Remove null bytes
    text = text.replace('\x00', '')
    
    # Limit length
    if len(text) > max_length:
        text = text[:max_length]
    
    # Basic HTML escaping (use proper HTML escaping library in production)
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    text = text.replace('"', '&quot;')
    text = text.replace("'", '&#x27;')
    
    return text.strip()

def validate_json_schema(data: Dict[str, Any], required_fields: List[str]) -> Dict[str, Any]:
    """Validate JSON request data against required fields."""
    errors = []
    
    for field in required_fields:
        if field not in data or data[field] is None:
            errors.append(f"Missing required field: {field}")
        elif isinstance(data[field], str) and not data[field].strip():
            errors.append(f"Field '{field}' cannot be empty")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

# =============================================================================
# LOGGING & MONITORING
# =============================================================================

def log_security_event(event_type: str, user_id: Optional[int] = None, details: Optional[Dict[str, Any]] = None):
    """Log security-related events."""
    log_data = {
        'timestamp': datetime.utcnow().isoformat(),
        'event_type': event_type,
        'ip_address': request.remote_addr,
        'user_agent': request.headers.get('User-Agent', ''),
        'user_id': user_id,
        'details': details or {}
    }
    
    logger.warning(f"SECURITY_EVENT: {log_data}")

def log_failed_login(username: str, ip_address: str):
    """Log failed login attempts."""
    log_security_event('failed_login', details={
        'username': username,
        'ip_address': ip_address
    })

def log_successful_login(user_id: int, username: str):
    """Log successful login."""
    log_security_event('successful_login', user_id, {
        'username': username
    })

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def generate_secure_filename(original_filename: str) -> str:
    """Generate a secure, unique filename."""
    # Get file extension
    ext = os.path.splitext(original_filename)[1].lower()
    
    # Generate random filename
    random_part = secrets.token_urlsafe(16)
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    
    return f"{timestamp}_{random_part}{ext}"

def is_safe_path(base_path: str, file_path: str) -> bool:
    """Check if file path is safe (no directory traversal)."""
    try:
        # Resolve the real path
        real_base = os.path.realpath(base_path)
        real_file = os.path.realpath(os.path.join(base_path, file_path))
        
        # Check if the resolved file path starts with the base path
        return real_file.startswith(real_base)
    except (OSError, ValueError):
        return False

def validate_csrf_token(token: str, session_token: str) -> bool:
    """Validate CSRF token."""
    if not token or not session_token:
        return False
    
    # Use constant-time comparison to prevent timing attacks
    return secrets.compare_digest(token, session_token) 