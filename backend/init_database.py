#!/usr/bin/env python3
"""
Database initialization script for Skim2
"""

import os
import sys
from database import init_db, engine, Base
from sqlalchemy import text

def main():
    print("Initializing Skim2 database...")
    
    # Create all tables
    Base.metadata.create_all(engine)
    
    # Verify the database was created correctly
    with engine.connect() as conn:
        # Check if documents table has created_at column
        result = conn.execute(text("PRAGMA table_info(documents)"))
        columns = [row[1] for row in result.fetchall()]
        
        if 'created_at' not in columns:
            print("ERROR: created_at column not found in documents table")
            print("Available columns:", columns)
            return 1
        
        print("✅ Database initialized successfully!")
        print("✅ Documents table has all required columns:", columns)
        
        # Show all tables
        result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        tables = [row[0] for row in result.fetchall()]
        print("✅ Created tables:", tables)
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 