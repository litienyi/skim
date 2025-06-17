import unittest
import os
import json
from app import app
import fitz
from database import init_db, get_db_connection

class TestPDFLayoutTool(unittest.TestCase):
    def setUp(self):
        """Set up test environment before each test."""
        self.app = app.test_client()
        self.app.testing = True
        
        # Create test uploads directory
        self.upload_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
        os.makedirs(self.upload_folder, exist_ok=True)
        
        # Initialize test database
        init_db()
        
        # Create a test PDF file
        self.test_pdf_path = os.path.join(self.upload_folder, 'test.pdf')
        self.create_test_pdf()

    def tearDown(self):
        """Clean up after each test."""
        # Remove test files
        if os.path.exists(self.test_pdf_path):
            os.remove(self.test_pdf_path)
        
        # Clean up database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM sentences')
        cursor.execute('DELETE FROM blocks')
        cursor.execute('DELETE FROM pages')
        cursor.execute('DELETE FROM documents')
        conn.commit()
        conn.close()

    def create_test_pdf(self):
        """Create a simple test PDF file."""
        doc = fitz.open()
        page = doc.new_page()
        
        # Add some text blocks
        page.insert_text((100, 100), "This is block 1. It has multiple sentences. This is the third sentence.")
        page.insert_text((100, 200), "This is block 2. Another sentence here.")
        
        doc.save(self.test_pdf_path)
        doc.close()

    def test_home_endpoint(self):
        """Test the home endpoint."""
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['message'], "PDF Layout Tool API is running")

    def test_upload_endpoint(self):
        """Test the PDF upload endpoint."""
        with open(self.test_pdf_path, 'rb') as f:
            response = self.app.post('/api/upload',
                                  data={'file': (f, 'test.pdf')},
                                  content_type='multipart/form-data')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('filename', data)
        self.assertIn('document_id', data)
        
        # Verify document was created in database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM documents WHERE filename = ?', (data['filename'],))
        doc = cursor.fetchone()
        self.assertIsNotNone(doc)
        conn.close()

    def test_get_pdf_endpoint(self):
        """Test retrieving the PDF file."""
        # First upload the file
        with open(self.test_pdf_path, 'rb') as f:
            self.app.post('/api/upload',
                         data={'file': (f, 'test.pdf')},
                         content_type='multipart/form-data')
        
        # Then try to get it
        response = self.app.get('/api/pdf/test.pdf')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')

    def test_get_blocks_endpoint(self):
        """Test retrieving blocks for a document."""
        # First upload the file
        with open(self.test_pdf_path, 'rb') as f:
            upload_response = self.app.post('/api/upload',
                                          data={'file': (f, 'test.pdf')},
                                          content_type='multipart/form-data')
        
        document_id = json.loads(upload_response.data)['document_id']
        
        # Then get blocks
        response = self.app.get(f'/api/blocks/{document_id}')
        self.assertEqual(response.status_code, 200)
        blocks = json.loads(response.data)
        
        # Verify blocks data structure
        self.assertIsInstance(blocks, list)
        if blocks:  # If blocks were found
            block = blocks[0]
            self.assertIn('id', block)
            self.assertIn('text', block)
            self.assertIn('x0', block)
            self.assertIn('y0', block)
            self.assertIn('x1', block)
            self.assertIn('y1', block)
            self.assertIn('page_number', block)

    def test_get_sentences_endpoint(self):
        """Test retrieving sentences for a document."""
        # First upload the file
        with open(self.test_pdf_path, 'rb') as f:
            upload_response = self.app.post('/api/upload',
                                          data={'file': (f, 'test.pdf')},
                                          content_type='multipart/form-data')
        
        document_id = json.loads(upload_response.data)['document_id']
        
        # Then get sentences
        response = self.app.get(f'/api/sentences/{document_id}')
        self.assertEqual(response.status_code, 200)
        sentences = json.loads(response.data)
        
        # Verify sentences data structure
        self.assertIsInstance(sentences, list)
        if sentences:  # If sentences were found
            sentence = sentences[0]
            self.assertIn('id', sentence)
            self.assertIn('text', sentence)
            self.assertIn('page_number', sentence)
            self.assertIn('block_number', sentence)
            self.assertIn('sentence_number', sentence)

    def test_process_text_endpoint(self):
        """Test the text processing endpoint."""
        test_text = "This is a test text for processing."
        response = self.app.post('/api/process-text',
                               json={'text': test_text},
                               content_type='application/json')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('response', data)

    def test_database_integrity(self):
        """Test database relationships and data integrity."""
        # Upload a file
        with open(self.test_pdf_path, 'rb') as f:
            upload_response = self.app.post('/api/upload',
                                          data={'file': (f, 'test.pdf')},
                                          content_type='multipart/form-data')
        
        document_id = json.loads(upload_response.data)['document_id']
        
        # Verify database relationships
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check document exists
        cursor.execute('SELECT * FROM documents WHERE id = ?', (document_id,))
        doc = cursor.fetchone()
        self.assertIsNotNone(doc)
        
        # Check pages exist and reference document
        cursor.execute('SELECT * FROM pages WHERE document_id = ?', (document_id,))
        pages = cursor.fetchall()
        self.assertGreater(len(pages), 0)
        
        # Check blocks exist and reference pages
        for page in pages:
            cursor.execute('SELECT * FROM blocks WHERE page_id = ?', (page['id'],))
            blocks = cursor.fetchall()
            self.assertGreater(len(blocks), 0)
            
            # Check sentences exist and reference blocks
            for block in blocks:
                cursor.execute('SELECT * FROM sentences WHERE block_id = ?', (block['id'],))
                sentences = cursor.fetchall()
                self.assertGreater(len(sentences), 0)
        
        conn.close()

if __name__ == '__main__':
    unittest.main() 