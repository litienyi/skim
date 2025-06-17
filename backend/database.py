import sqlite3
import os
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def get_db_connection():
    """Create a database connection with proper timeout and isolation level."""
    db_path = Path(__file__).parent / 'pdf_layout.db'
    conn = sqlite3.connect(str(db_path), timeout=30.0)  # 30 second timeout
    conn.row_factory = sqlite3.Row
    # Set isolation level to handle concurrent access better
    conn.isolation_level = 'IMMEDIATE'
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Create documents table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            original_filename TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')

        # Create pages table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page_number INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents (id)
        )
        ''')

        # Create blocks table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page_id INTEGER NOT NULL,
            block_number INTEGER NOT NULL,
            pymupdf_block_number INTEGER,  -- Made nullable
            user_order INTEGER,  -- User-defined order for activated blocks
            text TEXT NOT NULL,
            x0 REAL NOT NULL,
            y0 REAL NOT NULL,
            x1 REAL NOT NULL,
            y1 REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents (id),
            FOREIGN KEY (page_id) REFERENCES pages (id),
            UNIQUE(document_id, page_id, block_number)
        )
        ''')

        # Create words table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page_id INTEGER NOT NULL,
            block_id INTEGER NOT NULL,
            word_number INTEGER NOT NULL,
            text TEXT NOT NULL,
            x0 REAL NOT NULL,
            y0 REAL NOT NULL,
            x1 REAL NOT NULL,
            y1 REAL NOT NULL,
            is_sentence_starter BOOLEAN DEFAULT FALSE,
            sentence_number INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents (id),
            FOREIGN KEY (page_id) REFERENCES pages (id),
            FOREIGN KEY (block_id) REFERENCES blocks (id),
            UNIQUE(document_id, page_id, block_id, word_number)
        )
        ''')

        # Create sentences table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page_id INTEGER NOT NULL,
            block_id INTEGER NOT NULL,
            sentence_number INTEGER NOT NULL,
            text TEXT NOT NULL,
            rhetorical_function TEXT,
            relevance INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents (id),
            FOREIGN KEY (page_id) REFERENCES pages (id),
            FOREIGN KEY (block_id) REFERENCES blocks (id),
            UNIQUE(document_id, page_id, block_id, sentence_number)
        )
        ''')

        # Create indexes for better query performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_blocks_doc_page ON blocks(document_id, page_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_words_doc_page ON words(document_id, page_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_words_block ON words(block_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sentences_doc_page ON sentences(document_id, page_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sentences_block ON sentences(block_id)')

        conn.commit()
    except Exception as e:
        logger.error(f"Error initializing database: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def get_document_id(filename):
    """Get document ID from filename, create if doesn't exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT id FROM documents WHERE filename = ?', (filename,))
        result = cursor.fetchone()
        
        if result:
            doc_id = result['id']
        else:
            cursor.execute(
                'INSERT INTO documents (filename, original_filename) VALUES (?, ?)',
                (filename, filename)
            )
            doc_id = cursor.lastrowid
        
        conn.commit()
        return doc_id
    except Exception as e:
        logger.error(f"Error getting document ID: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def save_document(filename, original_filename):
    """Save document info and return its ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO documents (filename, original_filename)
            VALUES (?, ?)
        ''', (filename, original_filename))
        
        document_id = cursor.lastrowid
        conn.commit()
        return document_id
    except Exception as e:
        logger.error(f"Error saving document: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def save_page(document_id, page_number):
    """Save page info and return its ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO pages (document_id, page_number)
            VALUES (?, ?)
        ''', (document_id, page_number))
        
        page_id = cursor.lastrowid
        conn.commit()
        return page_id
    except Exception as e:
        logger.error(f"Error saving page: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def save_block(document_id, page_id, block_data):
    """Save a block and return its ID. If block already exists, return existing ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        logger.debug(f"Saving block for document {document_id}, page {page_id}")
        logger.debug(f"Block data: {block_data}")
        
        # Check if block already exists
        cursor.execute('''
            SELECT id FROM blocks 
            WHERE document_id = ? AND page_id = ? AND block_number = ?
        ''', (document_id, page_id, block_data['id']))
        existing_block = cursor.fetchone()
        
        if existing_block:
            logger.debug(f"Block already exists with ID: {existing_block['id']}")
            block_id = existing_block['id']
        else:
            cursor.execute('''
                INSERT INTO blocks (
                    document_id, page_id, block_number, pymupdf_block_number, user_order, text,
                    x0, y0, x1, y1
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                document_id, page_id, block_data['id'],
                block_data.get('pymupdf_block_number'),  # Made optional
                None,  # user_order is NULL by default
                block_data['text'],
                block_data['bbox']['x0'], block_data['bbox']['y0'],
                block_data['bbox']['x1'], block_data['bbox']['y1']
            ))
            block_id = cursor.lastrowid
            logger.debug(f"Saved new block with ID: {block_id}")
        
        conn.commit()
        return block_id
    except Exception as e:
        logger.error(f"Error saving block: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def save_sentence(document_id, page_id, block_id, sentence_number, text, position=None):
    """Save a sentence. If sentence already exists, update its text and position."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if sentence already exists
        cursor.execute('''
            SELECT id FROM sentences 
            WHERE document_id = ? AND page_id = ? AND block_id = ? AND sentence_number = ?
        ''', (document_id, page_id, block_id, sentence_number))
        existing_sentence = cursor.fetchone()
        
        if existing_sentence:
            # Update existing sentence
            if position:
                cursor.execute('''
                    UPDATE sentences 
                    SET text = ?, position_x0 = ?, position_y0 = ?, position_x1 = ?, position_y1 = ?
                    WHERE id = ?
                ''', (text, position['x0'], position['y0'], position['x1'], position['y1'], existing_sentence['id']))
            else:
                cursor.execute('''
                    UPDATE sentences 
                    SET text = ?
                    WHERE id = ?
                ''', (text, existing_sentence['id']))
        else:
            # Insert new sentence
            if position:
                cursor.execute('''
                    INSERT INTO sentences (
                        document_id, page_id, block_id,
                        sentence_number, text, position_x0, position_y0, position_x1, position_y1
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (document_id, page_id, block_id, sentence_number, text, 
                      position['x0'], position['y0'], position['x1'], position['y1']))
            else:
                cursor.execute('''
                    INSERT INTO sentences (
                        document_id, page_id, block_id,
                        sentence_number, text
                    ) VALUES (?, ?, ?, ?, ?)
                ''', (document_id, page_id, block_id, sentence_number, text))
        
        conn.commit()
    except Exception as e:
        logger.error(f"Error saving sentence: {str(e)}")
        conn.rollback()
        raise
    finally:
        conn.close()

def get_document_blocks(document_id):
    """Get all blocks for a document."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        logger.debug(f"Getting blocks for document {document_id}")
        
        # First check if document exists
        cursor.execute('SELECT id FROM documents WHERE id = ?', (document_id,))
        if not cursor.fetchone():
            logger.error(f"Document {document_id} not found")
            return []
        
        cursor.execute('''
            SELECT b.*, p.page_number
            FROM blocks b
            JOIN pages p ON b.page_id = p.id
            WHERE b.document_id = ?
            ORDER BY p.page_number, b.block_number
        ''', (document_id,))
        
        blocks = cursor.fetchall()
        logger.debug(f"Found {len(blocks)} blocks for document {document_id}")
        
        # Log first few blocks for debugging
        if blocks:
            logger.debug("First few blocks:")
            for block in blocks[:3]:
                logger.debug(f"Block: {dict(block)}")
        
        return blocks
    except Exception as e:
        logger.error(f"Error getting document blocks: {str(e)}")
        raise
    finally:
        conn.close()

def get_document_sentences(document_id):
    """Get all sentences for a document."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            SELECT s.*, p.page_number, b.block_number
            FROM sentences s
            JOIN pages p ON s.page_id = p.id
            JOIN blocks b ON s.block_id = b.id
            WHERE s.document_id = ?
            ORDER BY p.page_number, b.block_number, s.sentence_number
        ''', (document_id,))
        
        sentences = cursor.fetchall()
        return sentences
    except Exception as e:
        logger.error(f"Error getting document sentences: {str(e)}")
        raise
    finally:
        conn.close()

def save_words(document_id, page_id, block_id, words_data):
    """Save words for a block and return their IDs."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        logger.debug(f"=== SAVING WORDS ===")
        logger.debug(f"Document ID: {document_id}, Page ID: {page_id}, Block ID: {block_id}")
        logger.debug(f"Number of words to save: {len(words_data)}")

        # Process each word
        for word_idx, word_data in enumerate(words_data, 1):
            # Check if this word is a sentence starter
            is_starter = word_data.get('is_sentence_starter', False)
            
            logger.debug(f"Processing word {word_idx}:")
            logger.debug(f"  Text: {word_data['word']}")
            logger.debug(f"  Is sentence starter: {is_starter}")
            
            cursor.execute('''
                INSERT INTO words (
                    document_id, page_id, block_id, word_number,
                    text, x0, y0, x1, y1,
                    is_sentence_starter, sentence_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                document_id, page_id, block_id, word_idx,
                word_data['word'],
                word_data['bbox']['x0'], word_data['bbox']['y0'],
                word_data['bbox']['x1'], word_data['bbox']['y1'],
                is_starter, None  # Always set sentence_number to NULL initially
            ))
        
        conn.commit()
        logger.debug("=== WORDS SAVED SUCCESSFULLY ===")
    except Exception as e:
        logger.error(f"Error saving words: {str(e)}")
        logger.error("Error details:", exc_info=True)
        conn.rollback()
        raise
    finally:
        conn.close()

def get_block_words(document_id, page_id, block_id):
    """Get all words for a specific block."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        logger.debug(f"=== GETTING BLOCK WORDS ===")
        logger.debug(f"Document ID: {document_id}, Page ID: {page_id}, Block ID: {block_id}")
        
        cursor.execute('''
            SELECT word_number, text, x0, y0, x1, y1, is_sentence_starter, sentence_number
            FROM words
            WHERE document_id = ? AND page_id = ? AND block_id = ?
            ORDER BY word_number
        ''', (document_id, page_id, block_id))
        
        words = cursor.fetchall()
        logger.debug(f"Found {len(words)} words in block")
        
        # Log sentence starters
        sentence_starters = [w for w in words if w['is_sentence_starter']]
        logger.debug(f"Found {len(sentence_starters)} sentence starters:")
        for word in sentence_starters:
            logger.debug(f"  Word: '{word['text']}', Sentence number: {word['sentence_number']}")
        
        # Convert to list of dictionaries
        result = [{
            'word_number': word['word_number'],
            'text': word['text'],
            'bbox': {
                'x0': word['x0'],
                'y0': word['y0'],
                'x1': word['x1'],
                'y1': word['y1']
            },
            'is_sentence_starter': bool(word['is_sentence_starter']),
            'sentence_number': word['sentence_number']
        } for word in words]
        
        logger.debug("=== BLOCK WORDS RETRIEVED SUCCESSFULLY ===")
        return result
    except Exception as e:
        logger.error(f"Error getting block words: {str(e)}")
        logger.error("Error details:", exc_info=True)
        raise
    finally:
        conn.close()

def reinitialize_db():
    """Delete and recreate the database with the correct schema."""
    db_path = Path(__file__).parent / 'pdf_layout.db'
    
    # Close any existing connections
    try:
        conn = get_db_connection()
        conn.close()
    except Exception:
        pass
    
    # Delete the existing database file
    if db_path.exists():
        db_path.unlink()
    
    # Initialize new database
    init_db()
    return True

def reset_sentence_numbers(document_id, page_id, block_id):
    """Reset sentence numbers to NULL for a deactivated block."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        logger.debug(f"=== RESETTING SENTENCE NUMBERS ===")
        logger.debug(f"Document ID: {document_id}, Page ID: {page_id}, Block ID: {block_id}")
        
        # Reset sentence numbers to NULL for all sentence starters in this block
        cursor.execute('''
            UPDATE words
            SET sentence_number = NULL
            WHERE document_id = ? 
            AND page_id = ? 
            AND block_id = ? 
            AND is_sentence_starter = 1
        ''', (document_id, page_id, block_id))
        
        # Get all remaining sentence starters that have numbers
        cursor.execute('''
            SELECT id, word_number, sentence_number
            FROM words
            WHERE document_id = ? 
            AND is_sentence_starter = 1
            AND sentence_number IS NOT NULL
            ORDER BY sentence_number
        ''', (document_id,))
        
        remaining_sentence_starters = cursor.fetchall()
        logger.debug(f"Found {len(remaining_sentence_starters)} remaining sentence starters")
        
        # Reassign sentence numbers to remaining sentence starters
        for i, word in enumerate(remaining_sentence_starters, 1):
            cursor.execute('''
                UPDATE words
                SET sentence_number = ?
                WHERE id = ?
            ''', (i, word['id']))
            logger.debug(f"Reassigned sentence number {i} to word {word['word_number']}")
        
        conn.commit()
        logger.debug("=== SENTENCE NUMBERS RESET AND REASSIGNED SUCCESSFULLY ===")
        return True
    except Exception as e:
        logger.error(f"Error resetting sentence numbers: {str(e)}")
        logger.error("Error details:", exc_info=True)
        conn.rollback()
        raise
    finally:
        conn.close()

def sync_sentences(document_id):
    """Synchronize sentences between words and sentences tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        logger.debug("=== STARTING SENTENCE SYNC ===")
        logger.debug(f"Document ID: {document_id}")
        
        # First, get all activated blocks in user-defined order with their words
        cursor.execute('''
            SELECT 
                b.id as block_id,
                b.page_id,
                b.user_order,
                b.text as block_text,
                p.page_number,
                b.block_number,
                w.word_number,
                w.text as word_text,
                w.is_sentence_starter,
                w.sentence_number
            FROM blocks b
            JOIN pages p ON b.page_id = p.id
            JOIN words w ON w.block_id = b.id AND w.page_id = b.page_id
            WHERE b.document_id = ? AND b.user_order IS NOT NULL
            ORDER BY b.user_order, w.word_number
        ''', (document_id,))
        
        rows = cursor.fetchall()
        if not rows:
            logger.warning(f"No activated blocks found for document {document_id}")
            return False

        logger.debug(f"Found {len(rows)} words across all blocks")
        
        # Delete existing sentences for this document
        cursor.execute('DELETE FROM sentences WHERE document_id = ?', (document_id,))
        logger.debug("Deleted existing sentences")
        
        # Process words to build sentences across blocks
        current_sentence = []
        current_sentence_number = 1
        current_block_id = None
        current_page_id = None
        current_block_order = None
        
        logger.debug("=== PROCESSING WORDS ===")
        for i, row in enumerate(rows):
            logger.debug(f"Processing word: '{row['word_text']}' (Block {row['block_id']}, Order {row['user_order']}, Starter: {row['is_sentence_starter']})")
            
            # If this is a sentence starter and we have a current sentence, save it
            if row['is_sentence_starter'] and current_sentence:
                sentence_text = ' '.join(current_sentence)
                logger.debug(f"Saving sentence {current_sentence_number}:")
                logger.debug(f"  Text: {sentence_text}")
                logger.debug(f"  Block: {current_block_id} (Order: {current_block_order})")
                logger.debug(f"  Page: {current_page_id}")
                
                # Save the current sentence
                cursor.execute('''
                    INSERT INTO sentences (
                        document_id, page_id, block_id, sentence_number, text
                    ) VALUES (?, ?, ?, ?, ?)
                ''', (
                    document_id,
                    current_page_id,
                    current_block_id,
                    current_sentence_number,
                    sentence_text
                ))
                current_sentence_number += 1
                current_sentence = []
            
            # Add the current word to the sentence
            current_sentence.append(row['word_text'])
            current_block_id = row['block_id']
            current_page_id = row['page_id']
            current_block_order = row['user_order']
        
        # Save the last sentence if there are any remaining words
        if current_sentence:
            sentence_text = ' '.join(current_sentence)
            logger.debug(f"Saving final sentence {current_sentence_number}:")
            logger.debug(f"  Text: {sentence_text}")
            logger.debug(f"  Block: {current_block_id} (Order: {current_block_order})")
            logger.debug(f"  Page: {current_page_id}")
            
            cursor.execute('''
                INSERT INTO sentences (
                    document_id, page_id, block_id, sentence_number, text
                ) VALUES (?, ?, ?, ?, ?)
            ''', (
                document_id,
                current_page_id,
                current_block_id,
                current_sentence_number,
                sentence_text
            ))
        
        # Update sentence numbers in words table
        cursor.execute('''
            UPDATE words
            SET sentence_number = NULL
            WHERE document_id = ?
        ''', (document_id,))
        logger.debug("Reset sentence numbers in words table")
        
        # Get all sentence starters and update their sentence numbers
        cursor.execute('''
            SELECT w.id, w.word_number, w.is_sentence_starter, b.user_order, w.text
            FROM words w
            JOIN blocks b ON w.block_id = b.id
            WHERE w.document_id = ? AND b.user_order IS NOT NULL
            ORDER BY b.user_order, w.word_number
        ''', (document_id,))
        
        words = cursor.fetchall()
        current_sentence_number = 1
        
        logger.debug("=== UPDATING SENTENCE NUMBERS ===")
        for word in words:
            if word['is_sentence_starter']:
                logger.debug(f"Setting sentence number {current_sentence_number} for word: '{word['text']}' (Block order: {word['user_order']})")
                cursor.execute('''
                    UPDATE words
                    SET sentence_number = ?
                    WHERE id = ?
                ''', (current_sentence_number, word['id']))
                current_sentence_number += 1
        
        conn.commit()
        logger.debug(f"Successfully synced {current_sentence_number - 1} sentences for document {document_id}")
        
        # Verify the results
        cursor.execute('''
            SELECT s.sentence_number, s.text, b.user_order, p.page_number
            FROM sentences s
            JOIN blocks b ON s.block_id = b.id
            JOIN pages p ON s.page_id = p.id
            WHERE s.document_id = ?
            ORDER BY s.sentence_number
        ''', (document_id,))
        
        final_sentences = cursor.fetchall()
        logger.debug("=== FINAL SENTENCES ===")
        for sentence in final_sentences:
            logger.debug(f"Sentence {sentence['sentence_number']}:")
            logger.debug(f"  Text: {sentence['text']}")
            logger.debug(f"  Block Order: {sentence['user_order']}")
            logger.debug(f"  Page: {sentence['page_number']}")
        
        return True
        
    except Exception as e:
        conn.rollback()
        logger.error(f"Error syncing sentences: {str(e)}")
        return False
    finally:
        conn.close() 