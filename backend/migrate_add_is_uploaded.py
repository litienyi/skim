#!/usr/bin/env python3
"""
Database Migration Script for SKIM2
Adds is_uploaded column to distinguish between uploaded and working directory files.
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

def check_is_uploaded_column():
    """Check if the is_uploaded column exists."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute("PRAGMA table_info(documents)")
        columns = [column[1] for column in cursor.fetchall()]
        
        has_column = 'is_uploaded' in columns
        logger.info(f"is_uploaded column exists: {has_column}")
        return has_column
        
    finally:
        conn.close()

def migrate_database():
    """Add is_uploaded column to documents table."""
    logger.info("Starting database migration to add is_uploaded column...")
    
    # Create backup
    backup_path = backup_database()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if migration is needed
        if check_is_uploaded_column():
            logger.info("is_uploaded column already exists. No migration needed.")
            return
        
        logger.info("Adding is_uploaded column...")
        
        # Add the is_uploaded column with default value 0
        cursor.execute("ALTER TABLE documents ADD COLUMN is_uploaded INTEGER DEFAULT 0")
        
        # Update existing records to set is_uploaded based on file path
        # Files with UUID prefixes are uploaded files
        cursor.execute("""
            UPDATE documents 
            SET is_uploaded = 1 
            WHERE filename LIKE '%-%-%-%-%-%'
        """)
        
        # Commit changes
        conn.commit()
        logger.info("Database migration completed successfully!")
        
        # Verify migration
        cursor.execute("SELECT COUNT(*) FROM documents WHERE is_uploaded = 1")
        uploaded_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM documents WHERE is_uploaded = 0")
        working_dir_count = cursor.fetchone()[0]
        
        logger.info(f"Migration verification:")
        logger.info(f"  Uploaded files: {uploaded_count}")
        logger.info(f"  Working directory files: {working_dir_count}")
        
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
