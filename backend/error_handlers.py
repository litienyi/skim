"""
Error Handling and Logging System
Provides structured error handling, logging, and monitoring for the application.
"""

import os
import json
import traceback
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from functools import wraps
from flask import Flask, request, jsonify, current_app
from werkzeug.exceptions import HTTPException, BadRequest, Unauthorized, Forbidden, NotFound, InternalServerError
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration

# Configure Sentry for error monitoring
sentry_dsn = os.getenv('SENTRY_DSN')
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        integrations=[FlaskIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv('FLASK_ENV', 'development')
    )

# =============================================================================
# STRUCTURED LOGGING CONFIGURATION
# =============================================================================

class StructuredFormatter(logging.Formatter):
    """Custom formatter for structured JSON logging."""
    
    def format(self, record):
        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno
        }
        
        # Add request context if available
        if hasattr(record, 'request_id'):
            log_entry['request_id'] = record.request_id
        
        if hasattr(record, 'user_id'):
            log_entry['user_id'] = record.user_id
        
        if hasattr(record, 'ip_address'):
            log_entry['ip_address'] = record.ip_address
        
        # Add exception info if present
        if record.exc_info:
            log_entry['exception'] = {
                'type': record.exc_info[0].__name__,
                'message': str(record.exc_info[1]),
                'traceback': traceback.format_exception(*record.exc_info)
            }
        
        return json.dumps(log_entry)

def setup_logging():
    """Configure structured logging."""
    # Create logs directory if it doesn't exist
    log_dir = 'logs'
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = StructuredFormatter()
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)
    
    # File handler
    file_handler = logging.FileHandler('logs/app.log')
    file_handler.setLevel(logging.INFO)
    file_formatter = StructuredFormatter()
    file_handler.setFormatter(file_formatter)
    root_logger.addHandler(file_handler)
    
    # Error file handler
    error_handler = logging.FileHandler('logs/error.log')
    error_handler.setLevel(logging.ERROR)
    error_formatter = StructuredFormatter()
    error_handler.setFormatter(error_formatter)
    root_logger.addHandler(error_handler)

# =============================================================================
# REQUEST CONTEXT MIDDLEWARE
# =============================================================================

def add_request_context():
    """Add request context to logging."""
    import uuid
    
    # Generate unique request ID
    request_id = str(uuid.uuid4())
    request.request_id = request_id
    
    # Add request context to all log records
    def add_context(record):
        record.request_id = request_id
        record.ip_address = request.remote_addr
        record.user_agent = request.headers.get('User-Agent', '')
        record.method = request.method
        record.path = request.path
        record.query_string = request.query_string.decode('utf-8')
        
        # Add user ID if authenticated
        if hasattr(request, 'current_user') and request.current_user:
            record.user_id = request.current_user.id
    
    # Patch the logging module to add context
    original_log = logging.Logger._log
    
    def log_with_context(self, level, msg, args, exc_info=None, extra=None, stack_info=False):
        if extra is None:
            extra = {}
        add_context(extra)
        return original_log(self, level, msg, args, exc_info, extra, stack_info)
    
    logging.Logger._log = log_with_context

# =============================================================================
# ERROR HANDLERS
# =============================================================================

def register_error_handlers(app: Flask):
    """Register comprehensive error handlers for the Flask app."""
    
    @app.errorhandler(400)
    def bad_request(error):
        """Handle 400 Bad Request errors."""
        logger = logging.getLogger(__name__)
        logger.warning(f"Bad request: {error.description}", extra={
            'error_code': 400,
            'error_type': 'BadRequest'
        })
        
        return jsonify({
            'error': 'Bad Request',
            'message': error.description or 'Invalid request data',
            'request_id': getattr(request, 'request_id', None)
        }), 400
    
    @app.errorhandler(401)
    def unauthorized(error):
        """Handle 401 Unauthorized errors."""
        logger = logging.getLogger(__name__)
        logger.warning(f"Unauthorized access: {error.description}", extra={
            'error_code': 401,
            'error_type': 'Unauthorized'
        })
        
        return jsonify({
            'error': 'Unauthorized',
            'message': 'Authentication required',
            'request_id': getattr(request, 'request_id', None)
        }), 401
    
    @app.errorhandler(403)
    def forbidden(error):
        """Handle 403 Forbidden errors."""
        logger = logging.getLogger(__name__)
        logger.warning(f"Forbidden access: {error.description}", extra={
            'error_code': 403,
            'error_type': 'Forbidden'
        })
        
        return jsonify({
            'error': 'Forbidden',
            'message': 'Access denied',
            'request_id': getattr(request, 'request_id', None)
        }), 403
    
    @app.errorhandler(404)
    def not_found(error):
        """Handle 404 Not Found errors."""
        logger = logging.getLogger(__name__)
        logger.info(f"Resource not found: {request.path}", extra={
            'error_code': 404,
            'error_type': 'NotFound'
        })
        
        return jsonify({
            'error': 'Not Found',
            'message': 'The requested resource was not found',
            'request_id': getattr(request, 'request_id', None)
        }), 404
    
    @app.errorhandler(413)
    def payload_too_large(error):
        """Handle 413 Payload Too Large errors."""
        logger = logging.getLogger(__name__)
        logger.warning("File upload too large", extra={
            'error_code': 413,
            'error_type': 'PayloadTooLarge'
        })
        
        return jsonify({
            'error': 'Payload Too Large',
            'message': 'File size exceeds maximum allowed limit',
            'request_id': getattr(request, 'request_id', None)
        }), 413
    
    @app.errorhandler(429)
    def too_many_requests(error):
        """Handle 429 Too Many Requests errors."""
        logger = logging.getLogger(__name__)
        logger.warning("Rate limit exceeded", extra={
            'error_code': 429,
            'error_type': 'TooManyRequests'
        })
        
        return jsonify({
            'error': 'Too Many Requests',
            'message': 'Rate limit exceeded. Please try again later.',
            'request_id': getattr(request, 'request_id', None)
        }), 429
    
    @app.errorhandler(500)
    def internal_server_error(error):
        """Handle 500 Internal Server Error."""
        logger = logging.getLogger(__name__)
        logger.error(f"Internal server error: {str(error)}", extra={
            'error_code': 500,
            'error_type': 'InternalServerError',
            'traceback': traceback.format_exc()
        })
        
        # Don't expose internal errors in production
        if os.getenv('FLASK_ENV') == 'production':
            message = 'An internal server error occurred'
        else:
            message = str(error)
        
        return jsonify({
            'error': 'Internal Server Error',
            'message': message,
            'request_id': getattr(request, 'request_id', None)
        }), 500
    
    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        """Handle unexpected errors."""
        logger = logging.getLogger(__name__)
        logger.error(f"Unexpected error: {str(error)}", extra={
            'error_type': type(error).__name__,
            'traceback': traceback.format_exc()
        })
        
        return jsonify({
            'error': 'Internal Server Error',
            'message': 'An unexpected error occurred',
            'request_id': getattr(request, 'request_id', None)
        }), 500

# =============================================================================
# EXCEPTION DECORATORS
# =============================================================================

def handle_exceptions(f):
    """Decorator to handle exceptions and provide proper logging."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except HTTPException:
            # Re-raise HTTP exceptions to be handled by Flask
            raise
        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.error(f"Unhandled exception in {f.__name__}: {str(e)}", extra={
                'function': f.__name__,
                'args': str(args),
                'kwargs': str(kwargs),
                'traceback': traceback.format_exc()
            })
            
            # Re-raise as internal server error
            raise InternalServerError("An unexpected error occurred")
    
    return decorated_function

def validate_required_fields(required_fields: list):
    """Decorator to validate required fields in request data."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            data = request.get_json() or {}
            missing_fields = [field for field in required_fields if field not in data or data[field] is None]
            
            if missing_fields:
                logger = logging.getLogger(__name__)
                logger.warning(f"Missing required fields: {missing_fields}", extra={
                    'missing_fields': missing_fields,
                    'received_data': data
                })
                
                return jsonify({
                    'error': 'Bad Request',
                    'message': f'Missing required fields: {", ".join(missing_fields)}',
                    'request_id': getattr(request, 'request_id', None)
                }), 400
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# =============================================================================
# HEALTH CHECK ENDPOINTS
# =============================================================================

def create_health_check_endpoints(app: Flask):
    """Create health check endpoints for monitoring."""
    
    @app.route('/health')
    def health_check():
        """Basic health check endpoint."""
        return jsonify({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'version': '1.0.0'
        })
    
    @app.route('/health/detailed')
    def detailed_health_check():
        """Detailed health check with system information."""
        import psutil
        
        try:
            # Check database connectivity
            from database import get_db_session
            session = get_db_session()
            session.execute("SELECT 1")
            session.close()
            db_status = 'healthy'
        except Exception as e:
            db_status = f'unhealthy: {str(e)}'
        
        # Check file system
        try:
            upload_dir = os.getenv('UPLOAD_FOLDER', 'backend/uploads')
            if os.path.exists(upload_dir) and os.access(upload_dir, os.W_OK):
                fs_status = 'healthy'
            else:
                fs_status = 'unhealthy: upload directory not writable'
        except Exception as e:
            fs_status = f'unhealthy: {str(e)}'
        
        return jsonify({
            'status': 'healthy' if db_status == 'healthy' and fs_status == 'healthy' else 'unhealthy',
            'timestamp': datetime.utcnow().isoformat(),
            'version': '1.0.0',
            'components': {
                'database': db_status,
                'filesystem': fs_status
            },
            'system': {
                'cpu_percent': psutil.cpu_percent(),
                'memory_percent': psutil.virtual_memory().percent,
                'disk_percent': psutil.disk_usage('/').percent
            }
        })

# =============================================================================
# MONITORING UTILITIES
# =============================================================================

def log_api_request(response):
    """Log API request details."""
    logger = logging.getLogger(__name__)
    
    log_data = {
        'method': request.method,
        'path': request.path,
        'status_code': response.status_code,
        'response_time': getattr(request, 'start_time', None),
        'user_agent': request.headers.get('User-Agent', ''),
        'ip_address': request.remote_addr,
        'content_length': len(response.get_data()) if response else 0
    }
    
    # Add user info if authenticated
    if hasattr(request, 'current_user') and request.current_user:
        log_data['user_id'] = request.current_user.id
    
    logger.info("API Request", extra=log_data)
    return response

def log_performance_metrics(func_name: str, duration: float, success: bool = True):
    """Log performance metrics for function execution."""
    logger = logging.getLogger(__name__)
    
    log_data = {
        'function': func_name,
        'duration_ms': round(duration * 1000, 2),
        'success': success
    }
    
    if duration > 1.0:  # Log slow operations as warnings
        logger.warning("Slow operation detected", extra=log_data)
    else:
        logger.info("Performance metric", extra=log_data)

# =============================================================================
# GRACEFUL SHUTDOWN
# =============================================================================

def setup_graceful_shutdown(app: Flask):
    """Setup graceful shutdown handling."""
    
    def shutdown_handler(signum, frame):
        """Handle shutdown signals gracefully."""
        logger = logging.getLogger(__name__)
        logger.info("Received shutdown signal, starting graceful shutdown...")
        
        # Close database connections
        try:
            from database import engine
            engine.dispose()
            logger.info("Database connections closed")
        except Exception as e:
            logger.error(f"Error closing database connections: {e}")
        
        # Close any open files
        try:
            import gc
            gc.collect()
            logger.info("Memory cleanup completed")
        except Exception as e:
            logger.error(f"Error during memory cleanup: {e}")
        
        logger.info("Graceful shutdown completed")
        exit(0)
    
    import signal
    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler) 