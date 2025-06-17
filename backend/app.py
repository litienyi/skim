from flask import Flask, request, jsonify, send_file
import os
import logging
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF
import io
import json
import google.generativeai as genai
from dotenv import load_dotenv
from database import (
    init_db, get_document_id, save_page, save_block, save_sentence,
    get_document_blocks, get_document_sentences, save_words, get_block_words,
    get_db_connection, save_document, reinitialize_db, reset_sentence_numbers,
    sync_sentences
)
import time
from google.api_core import retry
from google.api_core.exceptions import ResourceExhausted
from datetime import datetime

# Load environment variables
load_dotenv()

# Configure Gemini
genai.configure(api_key=os.getenv('GOOGLE_API_KEY'))
model = genai.GenerativeModel('models/gemini-2.0-flash')

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Initialize database
init_db()

@app.route('/')
def home():
    return jsonify({"message": "PDF Layout Tool API is running"})

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:5173')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

@app.route('/api/upload', methods=['POST'])
def upload_file():
    try:
        logger.debug("=== UPLOAD REQUEST ===")
        logger.debug(f"Request method: {request.method}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        if 'file' not in request.files:
            logger.error("No file part in request")
            return jsonify({'error': 'No file part'}), 400
            
        file = request.files['file']
        if file.filename == '':
            logger.error("No selected file")
            return jsonify({'error': 'No selected file'}), 400
            
        if file and file.filename.endswith('.pdf'):
            logger.debug(f"Processing file: {file.filename}")
            
            # Save the file
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            unique_filename = f"{timestamp}_{filename}"
            input_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(input_path)
            logger.debug(f"File saved to: {input_path}")
            
            try:
                # Save document info
                document_id = save_document(unique_filename, filename)
                logger.debug(f"Document saved with ID: {document_id}")
                
                # Process PDF
                doc = fitz.open(input_path)
                logger.debug(f"PDF opened with {len(doc)} pages")
                
                # Process each page
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    logger.debug(f"Processing page {page_num + 1}")
                    
                    # Save page info
                    page_id = save_page(document_id, page_num + 1)
                    logger.debug(f"Page saved with ID: {page_id}")
                    
                    # Get blocks
                    blocks = page.get_text("blocks")
                    logger.debug(f"Found {len(blocks)} blocks on page {page_num + 1}")
                    
                    # Process each block
                    for block_idx, block in enumerate(blocks):
                        # block format: (x0, y0, x1, y1, "text", block_no, block_type)
                        block_bbox = {
                            'x0': block[0],
                            'y0': block[1],
                            'x1': block[2],
                            'y1': block[3]
                        }
                        
                        # Get words in this block
                        words = page.get_text("words", clip=block_bbox)
                        word_positions = []
                        
                        # Common capitalized words that shouldn't be considered sentence starters
                        common_caps = {
                            'I', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'St', 'Ave', 'Blvd', 'Rd', 'Ln',
                            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
                            'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
                        }
                        
                        # Track the last word's text for sentence boundary detection
                        last_word_text = ""
                        
                        for word in words:
                            word_bbox = fitz.Rect(word[:4])
                            if (word_bbox.x0 >= block_bbox['x0'] and 
                                word_bbox.y0 >= block_bbox['y0'] and 
                                word_bbox.x1 <= block_bbox['x1'] and 
                                word_bbox.y1 <= block_bbox['y1']):
                                
                                word_text = word[4] if word[4] else ""
                                
                                # Check if this word could be a sentence starter
                                is_sentence_starter = False
                                if word_text:
                                    # Must start with a capital letter
                                    if word_text[0].isupper():
                                        # Must not be a common capitalized word
                                        if word_text not in common_caps:
                                            # Must be at start of block or after sentence-ending punctuation
                                            if not last_word_text or last_word_text[-1] in '.!?':
                                                is_sentence_starter = True
                                
                                logger.debug(f"Word: '{word_text}', Is sentence starter: {is_sentence_starter}")
                                
                                word_positions.append({
                                    'word': word_text,
                                    'bbox': {
                                        'x0': word[0],
                                        'y0': word[1],
                                        'x1': word[2],
                                        'y1': word[3]
                                    },
                                    'is_sentence_starter': is_sentence_starter
                                })
                                
                                # Update last word text for next iteration
                                last_word_text = word_text
                        
                        # Create block object
                        block_obj = {
                            "id": block_idx + 1,
                            "text": block[4],  # block text
                            "bbox": block_bbox
                        }
                        
                        # Save block to database
                        block_id = save_block(document_id, page_id, block_obj)
                        logger.debug(f"Saved block {block_idx + 1} with ID: {block_id}")
                        
                        # Save words to database
                        if word_positions:
                            save_words(document_id, page_id, block_id, word_positions)
                            logger.debug(f"Saved {len(word_positions)} words for block {block_id}")
                
                doc.close()
                
                # Return success response
                return jsonify({
                    'message': 'File uploaded and processed successfully',
                    'filename': unique_filename,
                    'document_id': document_id
                }), 200
                
            except Exception as e:
                logger.error(f"Error processing PDF: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error traceback:", exc_info=True)
                return jsonify({'error': str(e)}), 500
            finally:
                # Don't clean up the uploaded file since we need it for serving
                pass
        else:
            logger.error("Invalid file type")
            return jsonify({'error': 'Invalid file type'}), 400
            
    except Exception as e:
        logger.error(f"Error handling upload: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error traceback:", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/pdf/<filename>', methods=['GET'])
def get_pdf(filename):
    logger.debug("=== GET PDF REQUEST ===")
    logger.debug(f"Requested filename: {filename}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
        logger.debug(f"Serving file from: {filepath}")
        return send_file(filepath, mimetype='application/pdf')
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': str(e)}), 404

@app.route('/api/blocks/<int:document_id>', methods=['GET'])
def get_blocks(document_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get blocks with user_order
        cursor.execute('''
            SELECT b.id, b.page_id, b.block_number, b.text, b.x0, b.y0, b.x1, b.y1, b.user_order, p.page_number
            FROM blocks b
            JOIN pages p ON b.page_id = p.id
            WHERE b.document_id = ?
            ORDER BY p.page_number, b.block_number
        ''', (document_id,))
        blocks = cursor.fetchall()

        # Get word positions
        cursor.execute('''
            SELECT w.word_number, w.page_id, w.block_id, w.text as word, w.x0, w.y0, w.x1, w.y1, w.is_sentence_starter, w.sentence_number, p.page_number, b.block_number
            FROM words w
            JOIN pages p ON w.page_id = p.id
            JOIN blocks b ON w.block_id = b.id
            WHERE w.document_id = ?
            ORDER BY p.page_number, b.block_number, w.word_number
        ''', (document_id,))
        words = cursor.fetchall()

        # Transform blocks data
        transformed_blocks = []
        current_page = None
        page_blocks = []

        for block in blocks:
            if current_page != block['page_number']:
                if page_blocks:
                    transformed_blocks.append(page_blocks)
                page_blocks = []
                current_page = block['page_number']
            
            page_blocks.append({
                'id': block['block_number'],
                'page_id': block['page_id'],
                'block_id': block['id'],
                'text': block['text'],
                'bbox': {
                    'x0': block['x0'],
                    'y0': block['y0'],
                    'x1': block['x1'],
                    'y1': block['y1']
                },
                'user_order': block['user_order']
            })
        
        if page_blocks:
            transformed_blocks.append(page_blocks)

        # Transform words data
        transformed_words = [{
            'word_number': word['word_number'],
            'text': word['word'],
            'bbox': {
                'x0': word['x0'],
                'y0': word['y0'],
                'x1': word['x1'],
                'y1': word['y1']
            },
            'is_sentence_starter': bool(word['is_sentence_starter']),
            'sentence_number': word['sentence_number'],
            'page_id': word['page_id'],
            'block_id': word['block_id']
        } for word in words]

        return jsonify({
            'blocks': transformed_blocks,
            'words': transformed_words
        })

    except Exception as e:
        logger.error(f"Error in get_blocks: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/sentences/<int:document_id>', methods=['GET'])
def get_sentences(document_id):
    logger.debug("=== GET SENTENCES REQUEST ===")
    logger.debug(f"Requested document ID: {document_id}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First get all sentences with their rhetorical functions
        cursor.execute('''
            SELECT 
                s.sentence_number,
                s.text,
                s.page_id,
                s.block_id,
                s.rhetorical_function,
                s.relevance,
                b.user_order,
                p.page_number,
                b.block_number
            FROM sentences s
            JOIN blocks b ON s.block_id = b.id
            JOIN pages p ON s.page_id = p.id
            WHERE s.document_id = ?
            ORDER BY s.sentence_number
        ''', (document_id,))
        
        sentences = cursor.fetchall()
        logger.debug(f"Found {len(sentences)} sentences in database")
        
        # Transform the sentences into the expected format
        transformed_sentences = [{
            'sentence_number': s['sentence_number'],
            'text': s['text'],
            'block_id': s['block_id'],
            'page_id': s['page_id'],
            'user_order': s['user_order'],
            'page_number': s['page_number'],
            'block_number': s['block_number'],
            'rhetorical_function': s['rhetorical_function'],
            'relevance': s['relevance']
        } for s in sentences]
        
        logger.debug("=== SENTENCES BEING RETURNED ===")
        for sentence in transformed_sentences:
            logger.debug(f"Sentence {sentence['sentence_number']}:")
            logger.debug(f"  Text: {sentence['text']}")
            logger.debug(f"  Function: {sentence['rhetorical_function']}")
            logger.debug(f"  Relevance: {sentence['relevance']}")
            logger.debug(f"  Block: {sentence['block_number']} (Order: {sentence['user_order']})")
            logger.debug(f"  Page: {sentence['page_number']}")
        
        return jsonify({'sentences': transformed_sentences})
    except Exception as e:
        logger.error(f"Error serving sentences: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/process-text', methods=['POST'])
def process_text():
    try:
        logger.debug("=== PROCESS TEXT REQUEST ===")
        logger.debug(f"Request method: {request.method}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        data = request.get_json()
        document_id = data.get('document_id')
        
        if not document_id:
            logger.error("Missing document_id in request")
            return jsonify({'error': 'Missing document_id'}), 400

        # Get sentences from database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # First check if we have any activated blocks
            cursor.execute('''
                SELECT COUNT(*) as count
                FROM blocks
                WHERE document_id = ? AND user_order IS NOT NULL
            ''', (document_id,))
            activated_blocks = cursor.fetchone()['count']
            logger.debug(f"Found {activated_blocks} activated blocks for document {document_id}")

            if activated_blocks == 0:
                logger.error(f"No activated blocks found for document {document_id}")
                return jsonify({'error': 'No activated blocks found. Please activate some blocks first.'}), 400

            # Get all sentences for the document
            cursor.execute('''
                SELECT s.id, s.sentence_number, s.text, s.page_id, s.block_id,
                       b.user_order, p.page_number
                FROM sentences s
                JOIN blocks b ON s.block_id = b.id
                JOIN pages p ON s.page_id = p.id
                WHERE s.document_id = ?
                ORDER BY b.user_order, s.sentence_number
            ''', (document_id,))
            
            sentences = cursor.fetchall()
            logger.debug(f"Found {len(sentences)} sentences in database for document {document_id}")
            
            if not sentences:
                # If no sentences found, try to sync them from words table
                logger.debug("No sentences found, attempting to sync from words table")
                if not sync_sentences(document_id):
                    # Check if there are any sentence starters
                    cursor.execute('''
                        SELECT COUNT(*) as count
                        FROM words
                        WHERE document_id = ? AND is_sentence_starter = 1
                    ''', (document_id,))
                    sentence_starters = cursor.fetchone()['count']
                    
                    if sentence_starters == 0:
                        logger.error(f"No sentence starters found for document {document_id}")
                        return jsonify({'error': 'No sentence starters found. Please mark some words as sentence starters first.'}), 400
                    else:
                        logger.error(f"Failed to sync sentences for document {document_id}")
                        return jsonify({'error': 'Failed to sync sentences. Please try resetting sentence numbers first.'}), 400
                
                # Check again after sync
                cursor.execute('''
                    SELECT s.id, s.sentence_number, s.text, s.page_id, s.block_id,
                           b.user_order, p.page_number
                    FROM sentences s
                    JOIN blocks b ON s.block_id = b.id
                    JOIN pages p ON s.page_id = p.id
                    WHERE s.document_id = ?
                    ORDER BY b.user_order, s.sentence_number
                ''', (document_id,))
                
                sentences = cursor.fetchall()
                logger.debug(f"After sync: Found {len(sentences)} sentences for document {document_id}")
                
                if not sentences:
                    logger.error(f"No sentences found after sync for document {document_id}")
                    return jsonify({'error': 'No sentences found for document'}), 404

            # Process with Gemini
            try:
                # Prepare the prompt
                sentences_data = [{'sentence_number': s['sentence_number'], 'text': s['text']} for s in sentences]
                prompt = f"""I will give you a sequence of sentences extracted from an academic article/book. Please analyze these sentences and identify their rhetorical functions in the context of the article/book. Return ONLY a JSON array of objects, where each object has:
                - sentence_number: must match the provided number
                - rhetorical_function: 1-3 keywords (e.g., Introduction, Background, Method, Results, Discussion, Conclusion) + colon (:) + 5-10 word added details
                - relevance: score from 0-100

                Example response format:
                [
                  {{
                    "sentence_number": 1,
                    "rhetorical_function": "Introduction: Establishes the context and scope of the research",
                    "relevance": 90
                  }}
                ]

                DO NOT include any explanatory text before or after the JSON array.
                DO NOT use markdown formatting.
                Return ONLY the JSON array.

                Sentences to analyze:
                {json.dumps(sentences_data, indent=2)}
                """

                logger.debug("=== GEMINI REQUEST ===")
                logger.debug(f"Number of sentences to analyze: {len(sentences)}")
                logger.debug("Raw sentences data:")
                for s in sentences_data:
                    logger.debug(f"Sentence {s['sentence_number']}: {s['text']}")
                logger.debug("Complete prompt:")
                logger.debug(prompt)

                # Get response from Gemini
                response = model.generate_content(prompt)
                response_text = response.text
                logger.debug("=== GEMINI RESPONSE ===")
                logger.debug("Raw response text:")
                logger.debug(response_text)

                # Clean the response text - remove any non-JSON text
                response_text = response_text.strip()
                # Find the first [ and last ]
                start_idx = response_text.find('[')
                end_idx = response_text.rfind(']') + 1
                if start_idx >= 0 and end_idx > start_idx:
                    response_text = response_text[start_idx:end_idx]
                    logger.debug("Cleaned response text:")
                    logger.debug(response_text)
                else:
                    logger.error("No valid JSON array found in response")
                    raise ValueError("No valid JSON array found in response")

                # Parse the cleaned response
                try:
                    results = json.loads(response_text)
                    logger.debug(f"Parsed {len(results)} results from Gemini")
                    logger.debug("Parsed results:")
                    for result in results:
                        logger.debug(f"Sentence {result['sentence_number']}:")
                        logger.debug(f"  Function: {result['rhetorical_function']}")
                        logger.debug(f"  Relevance: {result['relevance']}")
                    
                    # Verify all sentences are included in results
                    sentence_numbers = {s['sentence_number'] for s in sentences}
                    result_numbers = {r['sentence_number'] for r in results}
                    missing_numbers = sentence_numbers - result_numbers
                    
                    if missing_numbers:
                        logger.warning(f"Missing sentence numbers in Gemini response: {missing_numbers}")
                        # Add missing sentences with default values
                        for num in missing_numbers:
                            results.append({
                                'sentence_number': num,
                                'rhetorical_function': 'Unknown: Missing from analysis',
                                'relevance': 0
                            })
                        logger.debug("Updated results after adding missing sentences:")
                        for result in results:
                            logger.debug(f"Sentence {result['sentence_number']}:")
                            logger.debug(f"  Function: {result['rhetorical_function']}")
                            logger.debug(f"  Relevance: {result['relevance']}")
                    
                    # Update sentences table with analysis results
                    for result in results:
                        cursor.execute('''
                            UPDATE sentences
                            SET rhetorical_function = ?,
                                relevance = ?
                            WHERE document_id = ? AND sentence_number = ?
                        ''', (result['rhetorical_function'], result['relevance'],
                              document_id, result['sentence_number']))
                    
                    conn.commit()
                    logger.debug("Updated sentences table with Gemini results")
                    
                    # Add page_id and block_id to each result
                    for result in results:
                        sentence = next(s for s in sentences if s['sentence_number'] == result['sentence_number'])
                        result['page_id'] = sentence['page_id']
                        result['block_id'] = sentence['block_id']

                    return jsonify({'results': results})

                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse Gemini response as JSON: {str(e)}")
                    logger.error(f"Response text: {response_text}")
                    return jsonify({'error': 'Invalid response format from Gemini'}), 500

            except Exception as e:
                logger.error(f"Failed to process with Gemini: {str(e)}")
                logger.error("Error traceback:", exc_info=True)
                return jsonify({'error': str(e)}), 500

        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {str(e)}")
            return jsonify({'error': str(e)}), 500
        finally:
            conn.close()

    except Exception as e:
        logger.error(f"Error processing text: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/add-custom-sentence', methods=['POST'])
def add_custom_sentence():
    logger.debug("=== ADD CUSTOM SENTENCE REQUEST ===")
    logger.debug(f"Request method: {request.method}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        data = request.get_json()
        logger.debug("Received data:")
        logger.debug(json.dumps(data, indent=2))
        
        # Log each required field
        required_fields = ['document_id', 'page_id', 'block_id', 'word', 'position']
        logger.debug("Checking required fields:")
        for field in required_fields:
            logger.debug(f"Field '{field}': {'present' if field in data else 'missing'}")
            if field in data:
                logger.debug(f"Value: {json.dumps(data[field], indent=2)}")
        
        if not data or not all(k in data for k in required_fields):
            missing_fields = [field for field in required_fields if field not in data]
            error_msg = f"Missing required fields: {', '.join(missing_fields)}"
            logger.error(error_msg)
            return jsonify({'error': error_msg}), 400

        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        word = data['word']
        position = data['position']

        logger.debug("Processing request with:")
        logger.debug(f"document_id: {document_id}")
        logger.debug(f"page_id: {page_id}")
        logger.debug(f"block_id: {block_id}")
        logger.debug(f"word: {json.dumps(word, indent=2)}")
        logger.debug(f"position: {json.dumps(position, indent=2)}")

        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the next sentence number for this block
        cursor.execute('''
            SELECT MAX(sentence_number) 
            FROM sentences 
            WHERE document_id = ? AND page_id = ? AND block_id = ?
        ''', (document_id, page_id, block_id))
        max_sentence_num = cursor.fetchone()[0] or 0
        new_sentence_num = max_sentence_num + 1
        
        logger.debug(f"New sentence number: {new_sentence_num}")

        # Insert the new sentence
        cursor.execute('''
            INSERT INTO sentences (
                document_id, 
                page_id, 
                block_id, 
                sentence_number, 
                text
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            document_id,
            page_id,
            block_id,
            new_sentence_num,
            word['text']
        ))
        conn.commit()
        conn.close()
        
        logger.debug("Successfully added custom sentence")
        return jsonify({
            'message': 'Custom sentence added successfully',
            'sentence_number': new_sentence_num
        }), 200

    except Exception as e:
        logger.error(f"Error adding custom sentence: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/remove-custom-sentence', methods=['POST'])
def remove_custom_sentence():
    try:
        data = request.get_json()
        print("Received data:", data)
        
        # Validate required fields
        required_fields = ['document_id', 'page_id', 'block_id', 'sentence_number']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        sentence_number = data['sentence_number']
        
        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Delete the sentence
            cursor.execute('''
                DELETE FROM sentences 
                WHERE document_id = ? 
                AND page_id = ? 
                AND block_id = ? 
                AND sentence_number = ?
            ''', (document_id, page_id, block_id, sentence_number))
            
            conn.commit()
            
            return jsonify({
                'message': 'Custom sentence removed successfully',
                'document_id': document_id,
                'page_id': page_id,
                'block_id': block_id,
                'sentence_number': sentence_number
            })
            
        except Exception as e:
            print(f"Database error: {str(e)}")
            return jsonify({'error': f'Database error: {str(e)}'}), 500
        finally:
            conn.close()
            
    except Exception as e:
        print(f"Error removing custom sentence: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reinitialize-db', methods=['POST'])
def reinitialize_database():
    try:
        reinitialize_db()
        return jsonify({'message': 'Database reinitialized successfully'}), 200
    except Exception as e:
        logger.error(f"Error reinitializing database: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reset-sentence-numbers', methods=['POST'])
def reset_sentence_numbers_endpoint():
    try:
        data = request.get_json()
        if not data or 'document_id' not in data:
            return jsonify({'error': 'No document_id provided'}), 400
            
        document_id = data['document_id']
        logger.debug(f"Resetting sentence numbers for document {document_id}")
        
        # Reset all sentence numbers to NULL for the document
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            # Reset all sentence numbers to NULL
            cursor.execute('''
                UPDATE words 
                SET sentence_number = NULL 
                WHERE document_id = ?
            ''', (document_id,))
            
            # Get all activated blocks in user-defined order
            cursor.execute('''
                SELECT b.id as block_id, b.block_number, p.id as page_id, p.page_number
                FROM blocks b
                JOIN pages p ON b.page_id = p.id
                WHERE b.document_id = ? AND b.user_order IS NOT NULL
                ORDER BY b.user_order
            ''', (document_id,))
            blocks = cursor.fetchall()
            
            # Assign sequential sentence numbers
            current_sentence_number = 1
            for block in blocks:
                # Get all sentence starters in this block
                cursor.execute('''
                    SELECT id, word_number
                    FROM words
                    WHERE document_id = ? 
                    AND page_id = ? 
                    AND block_id = ? 
                    AND is_sentence_starter = 1
                    ORDER BY word_number
                ''', (document_id, block['page_id'], block['block_id']))
                sentence_starters = cursor.fetchall()
                
                # Update sentence numbers for this block
                for starter in sentence_starters:
                    cursor.execute('''
                        UPDATE words
                        SET sentence_number = ?
                        WHERE id = ?
                    ''', (current_sentence_number, starter['id']))
                    current_sentence_number += 1
            
            conn.commit()
            
            # Sync sentences table with updated sentence numbers
            sync_sentences(document_id)
            
            return jsonify({'message': 'Sentence numbers reset successfully'}), 200
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error in reset_sentence_numbers: {str(e)}")
            raise e
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error resetting sentence numbers: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/activate-block', methods=['POST'])
def activate_block():
    try:
        data = request.get_json()
        document_id = data.get('document_id')
        page_number = data.get('page_number')
        block_number = data.get('block_number')
        is_activating = data.get('is_activating')  # True for activation, False for deactivation

        conn = get_db_connection()
        cursor = conn.cursor()

        if is_activating:
            # Get the next available user_order
            cursor.execute('''
                SELECT MAX(user_order) as max_order
                FROM blocks
                WHERE document_id = ? AND user_order IS NOT NULL
            ''', (document_id,))
            result = cursor.fetchone()
            next_order = (result['max_order'] or 0) + 1

            # Update the block with the new user_order
            cursor.execute('''
                UPDATE blocks
                SET user_order = ?
                WHERE document_id = ? 
                AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                AND block_number = ?
            ''', (next_order, document_id, document_id, page_number, block_number))
        else:
            # Get the user_order of the block being deactivated
            cursor.execute('''
                SELECT user_order
                FROM blocks
                WHERE document_id = ? 
                AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                AND block_number = ?
            ''', (document_id, document_id, page_number, block_number))
            result = cursor.fetchone()
            if result and result['user_order']:
                deactivated_order = result['user_order']
                
                # Set the deactivated block's user_order to NULL
                cursor.execute('''
                    UPDATE blocks
                    SET user_order = NULL
                    WHERE document_id = ? 
                    AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                    AND block_number = ?
                ''', (document_id, document_id, page_number, block_number))

                # Decrement user_order for all blocks with higher order
                cursor.execute('''
                    UPDATE blocks
                    SET user_order = user_order - 1
                    WHERE document_id = ? AND user_order > ?
                ''', (document_id, deactivated_order))

        conn.commit()
        return jsonify({'success': True})

    except Exception as e:
        logger.error(f"Error in activate_block: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/toggle-sentence-starter', methods=['POST'])
def toggle_sentence_starter():
    try:
        data = request.get_json()
        logger.debug("=== TOGGLE SENTENCE STARTER REQUEST ===")
        logger.debug(f"Request data: {json.dumps(data, indent=2)}")
        
        # Validate required fields
        required_fields = ['document_id', 'page_id', 'block_id', 'word_number']
        if not all(field in data for field in required_fields):
            missing = [f for f in required_fields if f not in data]
            return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        word_number = data['word_number']

        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # First, verify the word exists
            cursor.execute('''
                SELECT id, word_number, text, is_sentence_starter
                FROM words
                WHERE document_id = ? 
                AND page_id = ? 
                AND block_id = ? 
                AND word_number = ?
            ''', (document_id, page_id, block_id, word_number))
            word = cursor.fetchone()
            
            if not word:
                logger.error(f"Word not found: document_id={document_id}, page_id={page_id}, block_id={block_id}, word_number={word_number}")
                return jsonify({'error': 'Word not found'}), 404
                
            logger.debug(f"Found word: {dict(word)}")
            
            # Toggle the is_sentence_starter status
            cursor.execute('''
                UPDATE words 
                SET is_sentence_starter = NOT is_sentence_starter,
                    sentence_number = CASE 
                        WHEN is_sentence_starter = 0 THEN NULL 
                        ELSE sentence_number 
                    END
                WHERE id = ?
            ''', (word['id'],))
            
            # Get all activated blocks in user-defined order
            cursor.execute('''
                SELECT b.id as block_id, b.page_id, p.page_number
                FROM blocks b
                JOIN pages p ON b.page_id = p.id
                WHERE b.document_id = ? AND b.user_order IS NOT NULL
                ORDER BY b.user_order
            ''', (document_id,))
            activated_blocks = cursor.fetchall()
            
            logger.debug(f"Found {len(activated_blocks)} activated blocks")
            
            # Get all sentence starters across all activated blocks
            cursor.execute('''
                SELECT w.id, w.word_number, w.text, w.is_sentence_starter, b.user_order, p.page_number
                FROM words w
                JOIN blocks b ON w.block_id = b.id
                JOIN pages p ON w.page_id = p.id
                WHERE w.document_id = ? 
                AND b.user_order IS NOT NULL
                AND w.is_sentence_starter = 1
                ORDER BY b.user_order, w.word_number
            ''', (document_id,))
            sentence_starters = cursor.fetchall()
            
            logger.debug(f"Found {len(sentence_starters)} sentence starters across all blocks")
            
            # First, reset all sentence numbers to NULL
            cursor.execute('''
                UPDATE words
                SET sentence_number = NULL
                WHERE document_id = ?
                AND is_sentence_starter = 1
            ''', (document_id,))
            
            # Then update sentence numbers for all sentence starters
            for idx, starter in enumerate(sentence_starters, 1):
                cursor.execute('''
                    UPDATE words
                    SET sentence_number = ?
                    WHERE id = ?
                ''', (idx, starter['id']))
            
            conn.commit()
            
            # Sync sentences table with updated sentence numbers
            sync_sentences(document_id)
            
            # Get updated word data for all activated blocks
            cursor.execute('''
                SELECT w.word_number, w.text, w.is_sentence_starter, w.sentence_number, w.x0, w.y0, w.x1, w.y1,
                       w.page_id, w.block_id
                FROM words w
                JOIN blocks b ON w.block_id = b.id
                WHERE w.document_id = ? 
                AND b.user_order IS NOT NULL
                ORDER BY b.user_order, w.word_number
            ''', (document_id,))
            updated_words = cursor.fetchall()
            
            logger.debug(f"Found {len(updated_words)} words in activated blocks")
            
            # Transform the words data to include bbox
            transformed_words = [{
                'word_number': word['word_number'],
                'text': word['text'],
                'is_sentence_starter': bool(word['is_sentence_starter']),
                'sentence_number': word['sentence_number'],
                'bbox': {
                    'x0': word['x0'],
                    'y0': word['y0'],
                    'x1': word['x1'],
                    'y1': word['y1']
                },
                'page_id': word['page_id'],
                'block_id': word['block_id']
            } for word in updated_words]
            
            logger.debug(f"Transformed {len(transformed_words)} words")
            logger.debug(f"First few transformed words: {json.dumps(transformed_words[:3], indent=2)}")
            
            return jsonify({
                'message': 'Sentence starter toggled successfully',
                'words': transformed_words
            }), 200
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {str(e)}")
            logger.error("Error traceback:", exc_info=True)
            return jsonify({'error': f'Database error: {str(e)}'}), 500
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error toggling sentence starter: {str(e)}")
        logger.error("Error traceback:", exc_info=True)
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=True, port=5001) 