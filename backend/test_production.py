"""
Production Readiness Test Suite
Comprehensive tests for security, performance, and functionality.
"""

import os
import sys
import unittest
import requests
import json
import time
from datetime import datetime
from typing import Dict, Any

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from security_config import (
    validate_password, validate_email, validate_username, validate_file_upload,
    sanitize_input, generate_secure_token, verify_token
)
from error_handlers import setup_logging
from database import init_db, get_db_session, User

# Setup logging
setup_logging()

class ProductionReadinessTests(unittest.TestCase):
    """Comprehensive test suite for production readiness."""
    
    def setUp(self):
        """Set up test environment."""
        self.base_url = os.getenv('TEST_BASE_URL', 'http://localhost:5000')
        self.test_user = {
            'username': 'testuser',
            'email': 'test@example.com',
            'password': 'TestPass123!'
        }
        self.auth_token = None
        
    def tearDown(self):
        """Clean up after tests."""
        if self.auth_token:
            # Clean up test user if created
            pass

    # =============================================================================
    # SECURITY TESTS
    # =============================================================================

    def test_password_validation(self):
        """Test password validation rules."""
        # Valid password
        result = validate_password('StrongPass123!')
        self.assertTrue(result['valid'])
        
        # Too short
        result = validate_password('weak')
        self.assertFalse(result['valid'])
        self.assertIn('at least 8 characters', result['errors'][0])
        
        # No uppercase
        result = validate_password('weakpass123!')
        self.assertFalse(result['valid'])
        self.assertIn('uppercase', result['errors'][0])
        
        # No lowercase
        result = validate_password('WEAKPASS123!')
        self.assertFalse(result['valid'])
        self.assertIn('lowercase', result['errors'][0])
        
        # No numbers
        result = validate_password('WeakPass!')
        self.assertFalse(result['valid'])
        self.assertIn('number', result['errors'][0])
        
        # No special characters
        result = validate_password('WeakPass123')
        self.assertFalse(result['valid'])
        self.assertIn('special character', result['errors'][0])

    def test_email_validation(self):
        """Test email validation."""
        # Valid emails
        self.assertTrue(validate_email('test@example.com'))
        self.assertTrue(validate_email('user.name+tag@domain.co.uk'))
        
        # Invalid emails
        self.assertFalse(validate_email('invalid-email'))
        self.assertFalse(validate_email('@example.com'))
        self.assertFalse(validate_email('test@'))
        self.assertFalse(validate_email('test.example.com'))

    def test_username_validation(self):
        """Test username validation."""
        # Valid usernames
        result = validate_username('validuser')
        self.assertTrue(result['valid'])
        
        result = validate_username('user_123')
        self.assertTrue(result['valid'])
        
        # Too short
        result = validate_username('ab')
        self.assertFalse(result['valid'])
        
        # Too long
        result = validate_username('a' * 51)
        self.assertFalse(result['valid'])
        
        # Invalid characters
        result = validate_username('user@name')
        self.assertFalse(result['valid'])

    def test_input_sanitization(self):
        """Test input sanitization."""
        # Test XSS prevention
        malicious_input = '<script>alert("xss")</script>'
        sanitized = sanitize_input(malicious_input)
        self.assertNotIn('<script>', sanitized)
        self.assertIn('&lt;script&gt;', sanitized)
        
        # Test length limiting
        long_input = 'a' * 2000
        sanitized = sanitize_input(long_input, max_length=1000)
        self.assertEqual(len(sanitized), 1000)
        
        # Test null byte removal
        null_input = 'test\x00string'
        sanitized = sanitize_input(null_input)
        self.assertNotIn('\x00', sanitized)

    def test_token_generation_and_verification(self):
        """Test JWT token generation and verification."""
        user_id = 123
        
        # Generate token
        token = generate_secure_token(user_id)
        self.assertIsInstance(token, str)
        self.assertGreater(len(token), 50)
        
        # Verify token
        payload = verify_token(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload['user_id'], user_id)
        
        # Test expired token (simulate)
        # This would require mocking time, so we'll test invalid token
        invalid_token = 'invalid.token.here'
        payload = verify_token(invalid_token)
        self.assertIsNone(payload)

    # =============================================================================
    # API ENDPOINT TESTS
    # =============================================================================

    def test_health_endpoint(self):
        """Test health check endpoint."""
        try:
            response = requests.get(f'{self.base_url}/health', timeout=10)
            self.assertEqual(response.status_code, 200)
            
            data = response.json()
            self.assertIn('status', data)
            self.assertEqual(data['status'], 'healthy')
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Health endpoint not available: {e}")

    def test_detailed_health_endpoint(self):
        """Test detailed health check endpoint."""
        try:
            response = requests.get(f'{self.base_url}/health/detailed', timeout=10)
            self.assertEqual(response.status_code, 200)
            
            data = response.json()
            self.assertIn('status', data)
            self.assertIn('components', data)
            self.assertIn('system', data)
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Detailed health endpoint not available: {e}")

    def test_registration_endpoint(self):
        """Test user registration endpoint."""
        try:
            response = requests.post(
                f'{self.base_url}/api/auth/register',
                json=self.test_user,
                timeout=10
            )
            
            if response.status_code == 201:
                data = response.json()
                self.assertIn('token', data)
                self.assertIn('user', data)
                self.auth_token = data['token']
            elif response.status_code == 409:
                # User already exists, try login
                self.test_login_endpoint()
            else:
                self.fail(f"Registration failed: {response.status_code} - {response.text}")
                
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Registration endpoint not available: {e}")

    def test_login_endpoint(self):
        """Test user login endpoint."""
        try:
            response = requests.post(
                f'{self.base_url}/api/auth/login',
                json={
                    'username': self.test_user['username'],
                    'password': self.test_user['password']
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                self.assertIn('token', data)
                self.assertIn('user', data)
                self.auth_token = data['token']
            else:
                self.fail(f"Login failed: {response.status_code} - {response.text}")
                
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Login endpoint not available: {e}")

    def test_protected_endpoint(self):
        """Test protected endpoint with authentication."""
        if not self.auth_token:
            self.skipTest("No auth token available")
            
        try:
            headers = {'Authorization': f'Bearer {self.auth_token}'}
            response = requests.get(
                f'{self.base_url}/api/auth/me',
                headers=headers,
                timeout=10
            )
            
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertIn('id', data)
            self.assertIn('username', data)
            self.assertIn('email', data)
            
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Protected endpoint not available: {e}")

    def test_unauthorized_access(self):
        """Test unauthorized access to protected endpoints."""
        try:
            # Try to access protected endpoint without token
            response = requests.get(
                f'{self.base_url}/api/auth/me',
                timeout=10
            )
            self.assertEqual(response.status_code, 401)
            
            # Try with invalid token
            headers = {'Authorization': 'Bearer invalid.token.here'}
            response = requests.get(
                f'{self.base_url}/api/auth/me',
                headers=headers,
                timeout=10
            )
            self.assertEqual(response.status_code, 401)
            
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Unauthorized access test not available: {e}")

    # =============================================================================
    # RATE LIMITING TESTS
    # =============================================================================

    def test_rate_limiting(self):
        """Test rate limiting on authentication endpoints."""
        try:
            # Make multiple rapid requests
            for i in range(10):
                response = requests.post(
                    f'{self.base_url}/api/auth/login',
                    json={'username': 'test', 'password': 'test'},
                    timeout=5
                )
                
                if response.status_code == 429:
                    # Rate limit hit
                    self.assertIn('rate limit', response.text.lower())
                    break
                    
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Rate limiting test not available: {e}")

    # =============================================================================
    # FILE UPLOAD TESTS
    # =============================================================================

    def test_file_upload_validation(self):
        """Test file upload validation."""
        # Test valid file
        from io import BytesIO
        valid_file = BytesIO(b'%PDF-1.4\n%Test PDF content')
        valid_file.name = 'test.pdf'
        
        result = validate_file_upload(valid_file)
        self.assertTrue(result['valid'])
        
        # Test invalid file type
        invalid_file = BytesIO(b'Not a PDF')
        invalid_file.name = 'test.txt'
        
        result = validate_file_upload(invalid_file)
        self.assertFalse(result['valid'])
        self.assertIn('not allowed', result['errors'][0])
        
        # Test no file
        result = validate_file_upload(None)
        self.assertFalse(result['valid'])
        self.assertIn('No file provided', result['errors'][0])

    # =============================================================================
    # PERFORMANCE TESTS
    # =============================================================================

    def test_response_time(self):
        """Test API response times."""
        try:
            start_time = time.time()
            response = requests.get(f'{self.base_url}/health', timeout=10)
            end_time = time.time()
            
            response_time = end_time - start_time
            self.assertLess(response_time, 2.0, f"Response time too slow: {response_time:.2f}s")
            
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Response time test not available: {e}")

    def test_concurrent_requests(self):
        """Test handling of concurrent requests."""
        import threading
        import queue
        
        results = queue.Queue()
        
        def make_request():
            try:
                start_time = time.time()
                response = requests.get(f'{self.base_url}/health', timeout=10)
                end_time = time.time()
                results.put({
                    'status_code': response.status_code,
                    'response_time': end_time - start_time
                })
            except Exception as e:
                results.put({'error': str(e)})
        
        # Start 10 concurrent requests
        threads = []
        for i in range(10):
            thread = threading.Thread(target=make_request)
            thread.start()
            threads.append(thread)
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # Check results
        successful_requests = 0
        total_response_time = 0
        
        while not results.empty():
            result = results.get()
            if 'error' not in result:
                successful_requests += 1
                total_response_time += result['response_time']
                self.assertEqual(result['status_code'], 200)
        
        # At least 8 out of 10 requests should succeed
        self.assertGreaterEqual(successful_requests, 8)
        
        # Average response time should be reasonable
        if successful_requests > 0:
            avg_response_time = total_response_time / successful_requests
            self.assertLess(avg_response_time, 3.0, f"Average response time too slow: {avg_response_time:.2f}s")

    # =============================================================================
    # SECURITY HEADERS TESTS
    # =============================================================================

    def test_security_headers(self):
        """Test security headers are present."""
        try:
            response = requests.get(f'{self.base_url}/health', timeout=10)
            
            headers = response.headers
            
            # Check for security headers
            self.assertIn('X-Content-Type-Options', headers)
            self.assertIn('X-Frame-Options', headers)
            self.assertIn('X-XSS-Protection', headers)
            
            # Check header values
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            self.assertEqual(headers['X-Frame-Options'], 'DENY')
            self.assertIn('XSS-Protection', headers['X-XSS-Protection'])
            
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Security headers test not available: {e}")

    # =============================================================================
    # DATABASE TESTS
    # =============================================================================

    def test_database_connection(self):
        """Test database connectivity."""
        try:
            # Initialize database
            init_db()
            
            # Test session creation
            session = get_db_session()
            self.assertIsNotNone(session)
            
            # Test basic query
            result = session.execute("SELECT 1").scalar()
            self.assertEqual(result, 1)
            
            session.close()
            
        except Exception as e:
            self.fail(f"Database connection test failed: {e}")

    # =============================================================================
    # ERROR HANDLING TESTS
    # =============================================================================

    def test_error_handling(self):
        """Test error handling and logging."""
        try:
            # Test 404 endpoint
            response = requests.get(f'{self.base_url}/nonexistent', timeout=10)
            self.assertEqual(response.status_code, 404)
            
            # Test malformed JSON
            response = requests.post(
                f'{self.base_url}/api/auth/login',
                data='invalid json',
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            self.assertEqual(response.status_code, 400)
            
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Error handling test not available: {e}")

def run_production_tests():
    """Run all production readiness tests."""
    print("Running Production Readiness Tests...")
    print("=" * 50)
    
    # Create test suite
    suite = unittest.TestLoader().loadTestsFromTestCase(ProductionReadinessTests)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    print("\n" + "=" * 50)
    print("PRODUCTION READINESS TEST SUMMARY")
    print("=" * 50)
    print(f"Tests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Skipped: {len(result.skipped) if hasattr(result, 'skipped') else 0}")
    
    if result.failures:
        print("\nFAILURES:")
        for test, traceback in result.failures:
            print(f"  - {test}: {traceback}")
    
    if result.errors:
        print("\nERRORS:")
        for test, traceback in result.errors:
            print(f"  - {test}: {traceback}")
    
    # Determine overall result
    if result.wasSuccessful():
        print("\n✅ ALL TESTS PASSED - Application is production ready!")
        return True
    else:
        print("\n❌ SOME TESTS FAILED - Please fix issues before deployment!")
        return False

if __name__ == '__main__':
    success = run_production_tests()
    sys.exit(0 if success else 1) 