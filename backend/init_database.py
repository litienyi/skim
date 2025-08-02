#!/usr/bin/env python3
"""
Database initialization script for the PDF analysis application.
This script creates all necessary tables and handles schema migrations.
"""

import os
import sys
from pathlib import Path

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, engine, Base
from sqlalchemy import text

def reset_database():
    """Reset the database by dropping all tables and recreating them."""
    print("🔄 Resetting database...")
    
    # Drop all tables
    Base.metadata.drop_all(engine)
    print("✅ Dropped all existing tables")
    
    # Create all tables
    Base.metadata.create_all(engine)
    print("✅ Created all tables with new schema")
    
    print("🎉 Database reset complete!")
    print("\nNew schema includes:")
    print("- users (with authentication)")
    print("- documents (user-specific)")
    print("- pages (with text_content)")
    print("- words (PyMuPDF extracted)")
    print("- highlights (user-specific)")
    print("- chat_sessions (user-specific)")
    print("- chat_messages (with references)")

if __name__ == "__main__":
    reset_database() 