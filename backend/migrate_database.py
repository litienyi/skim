#!/usr/bin/env python3
"""
Database Migration Script for SKIM2
Converts from UUID-based document identification to file_path-based identification.
"""

import os
import sqlite3
import logging
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skim2_local.db')

def backup_database():
    """Create a backup of the current database."""
    backup_path = f"{DB_PATH}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    if os.path.exists(DB_PATH):
        import shutil
        shutil.copy2(DB_PATH, backup_path)
        logger.info(f"Database backed up to: {backup_path}")
        return backup_path
    return None

def check_old_schema():
    """Check if the database has the old schema."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if documents table has 'id' column as primary key
        cursor.execute("PRAGMA table_info(documents)")
        columns = cursor.fetchall()
        
        # Look for 'id' column that is primary key
        has_id_primary = any(column[1] == 'id' and column[5] == 1 for column in columns)
        has_file_path_primary = any(column[1] == 'file_path' and column[5] == 1 for column in columns)
        
        has_old_schema = has_id_primary and not has_file_path_primary
        logger.info(f"Old schema detected: {has_old_schema}")
        logger.info(f"Has 'id' as primary key: {has_id_primary}")
        logger.info(f"Has 'file_path' as primary key: {has_file_path_primary}")
        return has_old_schema
        
    finally:
        conn.close()

def migrate_database():
    """Migrate the database from old schema to new schema."""
    logger.info("Starting database migration...")
    
    # Create backup
    backup_path = backup_database()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if migration is needed
        if not check_old_schema():
            logger.info("Database already has new schema. No migration needed.")
            return
        
        logger.info("Migrating database schema...")
        
        # Step 1: Create new tables with new schema
        cursor.execute("""
            CREATE TABLE documents_new (
                file_path TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                text_content TEXT,
                pages_data TEXT,
                num_pages INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor.execute("""
            CREATE TABLE chat_sessions_new (
                id TEXT PRIMARY KEY,
                document_file_path TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (document_file_path) REFERENCES documents_new (file_path) ON DELETE CASCADE
            )
        """)
        
        cursor.execute("""
            CREATE TABLE chat_messages_new (
                id TEXT PRIMARY KEY,
                chat_session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                page_range TEXT,
                "references" TEXT,
                FOREIGN KEY (chat_session_id) REFERENCES chat_sessions_new (id) ON DELETE CASCADE
            )
        """)
        
        # Step 2: Migrate data from old tables to new tables
        logger.info("Migrating documents...")
        cursor.execute("""
            INSERT INTO documents_new (file_path, filename, text_content, pages_data, num_pages, file_size, uploaded_at)
            SELECT file_path, original_filename, text_content, pages_data, num_pages, file_size, uploaded_at
            FROM documents d1
            WHERE d1.uploaded_at = (
                SELECT MAX(d2.uploaded_at)
                FROM documents d2
                WHERE d2.file_path = d1.file_path
            )
        """)
        
        logger.info("Migrating chat sessions...")
        cursor.execute("""
            INSERT INTO chat_sessions_new (id, document_file_path, created_at)
            SELECT cs.id, d.file_path, cs.created_at
            FROM chat_sessions cs
            JOIN documents d ON cs.document_id = d.id
        """)
        
        logger.info("Migrating chat messages...")
        cursor.execute("""
            INSERT INTO chat_messages_new (id, chat_session_id, role, content, timestamp, page_range, "references")
            SELECT id, chat_session_id, role, content, timestamp, page_range, "references"
            FROM chat_messages
        """)
        
        # Step 3: Drop old tables
        logger.info("Dropping old tables...")
        cursor.execute("DROP TABLE chat_messages")
        cursor.execute("DROP TABLE chat_sessions")
        cursor.execute("DROP TABLE documents")
        
        # Step 4: Rename new tables to original names
        logger.info("Renaming new tables...")
        cursor.execute("ALTER TABLE documents_new RENAME TO documents")
        cursor.execute("ALTER TABLE chat_sessions_new RENAME TO chat_sessions")
        cursor.execute("ALTER TABLE chat_messages_new RENAME TO chat_messages")
        
        # Step 5: Create indexes
        logger.info("Creating indexes...")
        cursor.execute("CREATE INDEX idx_chat_sessions_document ON chat_sessions(document_file_path)")
        cursor.execute("CREATE INDEX idx_chat_messages_session ON chat_messages(chat_session_id)")
        
        # Commit changes
        conn.commit()
        logger.info("Database migration completed successfully!")
        
        # Verify migration
        cursor.execute("SELECT COUNT(*) FROM documents")
        doc_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM chat_sessions")
        session_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM chat_messages")
        message_count = cursor.fetchone()[0]
        
        logger.info(f"Migration verification:")
        logger.info(f"  Documents: {doc_count}")
        logger.info(f"  Chat sessions: {session_count}")
        logger.info(f"  Chat messages: {message_count}")
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        migrate_database()
        print("✅ Database migration completed successfully!")
    except Exception as e:
        print(f"❌ Database migration failed: {e}")
        exit(1)
